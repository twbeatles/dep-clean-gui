import * as fs from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  AppScanResult,
  AppSettings,
  ScanExecutionOutcome,
  ScanProgressEvent,
  ScanSet,
  WatchStatus,
  WatchTarget,
} from './types.js';
import { AlertManager } from './alert-manager.js';
import { createTargetsFromWatchTargets, runScan, type ScanTargetInput } from './scan-runner.js';

interface ManagedWatcher {
  targetId: string;
  targetPath: string;
  watcher: FSWatcher;
}

interface WatcherErrorEvent {
  targetId: string;
  targetPath: string;
  error: unknown;
}

interface WatchEngineCallbacks {
  onProgress?: (event: ScanProgressEvent) => void;
  onScanCompleted?: (outcome: ScanExecutionOutcome) => void;
  onStatusChanged?: (status: WatchStatus) => void;
  onWatcherError?: (event: WatcherErrorEvent) => void;
}

function normalizeTokenList(value?: string[]): string {
  return (value ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

function watcherTargetSignature(target: WatchTarget): string {
  return [
    target.id,
    target.path.trim(),
    target.enabled ? '1' : '0',
    normalizeTokenList(target.only),
    normalizeTokenList(target.exclude),
  ].join('|');
}

function watcherSettingsSignature(settings: AppSettings): string {
  return settings.watchTargets
    .map((target) => watcherTargetSignature(target))
    .sort()
    .join('||');
}

function hasWatcherRelevantSettingsChanges(previous: AppSettings, next: AppSettings): boolean {
  if (previous.realtimeEnabled !== next.realtimeEnabled) return true;
  return watcherSettingsSignature(previous) !== watcherSettingsSignature(next);
}

function hasPeriodicSettingsChanges(previous: AppSettings, next: AppSettings): boolean {
  return (
    previous.periodicEnabled !== next.periodicEnabled ||
    previous.periodicMinutes !== next.periodicMinutes
  );
}

export class WatchEngine {
  private running = false;
  private settings: AppSettings;
  private watchers: ManagedWatcher[] = [];
  private periodicTimer?: NodeJS.Timeout;
  private realtimeTimer?: NodeJS.Timeout;
  private pendingRealtimeTargetIds = new Set<string>();
  private realtimeScanEnqueued = false;
  private scanQueue: Promise<ScanExecutionOutcome | null> = Promise.resolve(null);
  private nextRunAt?: string;
  private lastRunAt?: string;
  private lastResult?: AppScanResult;

  constructor(
    initialSettings: AppSettings,
    private readonly alertManager: AlertManager,
    private readonly callbacks: WatchEngineCallbacks = {}
  ) {
    this.settings = initialSettings;
  }

  getStatus(): WatchStatus {
    return {
      running: this.running,
      periodicEnabled: this.settings.periodicEnabled,
      realtimeEnabled: this.settings.realtimeEnabled,
      watcherCount: this.watchers.length,
      nextRunAt: this.nextRunAt,
      lastRunAt: this.lastRunAt,
    };
  }

  getLastResult(): AppScanResult | undefined {
    return this.lastResult;
  }

  updateSettings(settings: AppSettings): void {
    const previousSettings = this.settings;
    this.settings = settings;

    if (!this.running) {
      this.emitStatus();
      return;
    }

    if (hasPeriodicSettingsChanges(previousSettings, settings)) {
      this.resetPeriodicTimer();
    }

    if (hasWatcherRelevantSettingsChanges(previousSettings, settings)) {
      void this.rebuildWatchers();
    }

    this.emitStatus();
  }

  async start(): Promise<WatchStatus> {
    if (this.running) return this.getStatus();

    this.running = true;
    await this.rebuildWatchers();
    this.resetPeriodicTimer();
    this.emitStatus();
    return this.getStatus();
  }

  async stop(): Promise<WatchStatus> {
    if (!this.running) return this.getStatus();

    this.running = false;

    if (this.periodicTimer) {
      clearTimeout(this.periodicTimer);
      this.periodicTimer = undefined;
    }

    if (this.realtimeTimer) {
      clearTimeout(this.realtimeTimer);
      this.realtimeTimer = undefined;
    }

    this.pendingRealtimeTargetIds.clear();
    this.realtimeScanEnqueued = false;

    await this.closeAllWatchers();

    this.nextRunAt = undefined;
    this.emitStatus();
    return this.getStatus();
  }

  async runManual(paths?: string[]): Promise<ScanExecutionOutcome> {
    const targets = paths && paths.length > 0
      ? paths.map((targetPath, index) => ({ id: `manual-${index}`, path: targetPath }))
      : createTargetsFromWatchTargets(this.settings.watchTargets);

    return this.enqueueScan('manual', targets);
  }

  async runScanSet(scanSet: ScanSet): Promise<ScanExecutionOutcome> {
    const targets: ScanTargetInput[] = scanSet.paths.map((targetPath, index) => ({
      id: `${scanSet.id}-${index}`,
      path: targetPath,
    }));

    return this.enqueueScan('scan-set', targets, scanSet.id);
  }

  async runRealtimeForTarget(targetId: string): Promise<void> {
    if (!this.running || !this.settings.realtimeEnabled) return;

    this.pendingRealtimeTargetIds.add(targetId);

    if (this.realtimeTimer) {
      clearTimeout(this.realtimeTimer);
    }

    this.realtimeTimer = setTimeout(() => {
      this.realtimeTimer = undefined;
      this.flushRealtimeQueue();
    }, 2000);
  }

  private async rebuildWatchers(): Promise<void> {
    await this.closeAllWatchers();

    if (!this.running || !this.settings.realtimeEnabled) {
      this.emitStatus();
      return;
    }

    const enabledTargets = this.settings.watchTargets.filter((target) => target.enabled);

    for (const target of enabledTargets) {
      if (!fs.existsSync(target.path)) continue;

      const watcher = chokidar.watch(target.path, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 800,
          pollInterval: 100,
        },
      });

      const listener = () => {
        void this.runRealtimeForTarget(target.id);
      };
      const managedWatcher: ManagedWatcher = {
        targetId: target.id,
        targetPath: target.path,
        watcher,
      };

      watcher.on('add', listener);
      watcher.on('addDir', listener);
      watcher.on('unlink', listener);
      watcher.on('unlinkDir', listener);
      watcher.on('change', listener);
      watcher.on('error', (error) => {
        this.handleWatcherError(managedWatcher, error);
      });

      this.watchers.push(managedWatcher);
    }

    this.emitStatus();
  }

  private async closeAllWatchers(): Promise<void> {
    if (this.watchers.length === 0) return;

    const closingWatchers = this.watchers;
    this.watchers = [];
    await Promise.all(closingWatchers.map((entry) => this.closeWatcher(entry)));
  }

  private async closeWatcher(entry: ManagedWatcher): Promise<void> {
    try {
      await entry.watcher.close();
    } catch {
      // Keep watcher shutdown resilient during rebuild/stop flows.
    }
  }

  private handleWatcherError(entry: ManagedWatcher, error: unknown): void {
    const index = this.watchers.indexOf(entry);
    if (index < 0) return;

    this.watchers.splice(index, 1);
    this.callbacks.onWatcherError?.({
      targetId: entry.targetId,
      targetPath: entry.targetPath,
      error,
    });

    void this.closeWatcher(entry).finally(() => {
      this.emitStatus();
    });
  }

  private flushRealtimeQueue(): void {
    if (!this.running || !this.settings.realtimeEnabled) {
      this.pendingRealtimeTargetIds.clear();
      this.realtimeScanEnqueued = false;
      return;
    }

    if (this.realtimeScanEnqueued || this.pendingRealtimeTargetIds.size === 0) {
      return;
    }

    const pendingIds = this.pendingRealtimeTargetIds;
    this.pendingRealtimeTargetIds = new Set<string>();

    const targets = this.settings.watchTargets
      .filter((target) => target.enabled && pendingIds.has(target.id))
      .map((target) => ({
        id: target.id,
        path: target.path,
        only: target.only,
        exclude: target.exclude,
      }));

    if (targets.length === 0) {
      return;
    }

    this.realtimeScanEnqueued = true;
    void this.enqueueScan('watch-realtime', targets)
      .catch(() => null)
      .finally(() => {
        this.realtimeScanEnqueued = false;
        if (this.pendingRealtimeTargetIds.size > 0) {
          this.flushRealtimeQueue();
        }
      });
  }

  private resetPeriodicTimer(): void {
    if (this.periodicTimer) {
      clearTimeout(this.periodicTimer);
      this.periodicTimer = undefined;
    }

    this.nextRunAt = undefined;

    if (!this.running || !this.settings.periodicEnabled) {
      this.emitStatus();
      return;
    }

    const intervalMs = Math.max(5, this.settings.periodicMinutes) * 60_000;
    const runAt = Date.now() + intervalMs;
    this.nextRunAt = new Date(runAt).toISOString();

    this.periodicTimer = setTimeout(() => {
      const targets = createTargetsFromWatchTargets(this.settings.watchTargets);
      if (targets.length > 0) {
        void this.enqueueScan('watch-periodic', targets);
      }
      this.resetPeriodicTimer();
    }, intervalMs);

    this.emitStatus();
  }

  private enqueueScan(
    source: AppScanResult['source'],
    targets: ScanTargetInput[],
    setId?: string
  ): Promise<ScanExecutionOutcome> {
    this.scanQueue = this.scanQueue
      .catch(() => null)
      .then(async () => {
        const filteredTargets = targets.filter((target) => target.path.trim());

        const scanResult = await runScan({
          source,
          setId,
          targets: filteredTargets,
          onProgress: (event) => this.callbacks.onProgress?.(event),
        });

        this.lastRunAt = new Date().toISOString();
        this.lastResult = scanResult;

        const alerts = await this.alertManager.evaluate(scanResult, this.settings);
        const outcome = { scanResult, alerts };

        this.callbacks.onScanCompleted?.(outcome);
        this.emitStatus();

        return outcome;
      });

    return this.scanQueue.then((result) => {
      if (!result) {
        throw new Error('Scan could not be executed.');
      }
      return result;
    });
  }

  private emitStatus(): void {
    this.callbacks.onStatusChanged?.(this.getStatus());
  }
}

export function watchTargetToScanInput(target: WatchTarget): ScanTargetInput {
  return {
    id: target.id,
    path: target.path,
    only: target.only,
    exclude: target.exclude,
  };
}
