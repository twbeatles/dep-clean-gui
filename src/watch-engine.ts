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

const WATCHER_RECOVERY_RETRY_MS = 15_000;

interface ManagedWatcher {
  targetId: string;
  targetPath: string;
  watcher: FSWatcher;
}

interface FailedWatcherTarget {
  targetId: string;
  targetPath: string;
  lastErrorAt: string;
  errorMessage: string;
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

interface WatchEngineOptions {
  watcherRecoveryDelayMs?: number;
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
  private watcherRecoveryTimer?: NodeJS.Timeout;
  private pendingRealtimeTargetIds = new Set<string>();
  private realtimeScanEnqueued = false;
  private scanQueue: Promise<ScanExecutionOutcome | null> = Promise.resolve(null);
  private nextRunAt?: string;
  private lastRunAt?: string;
  private lastResult?: AppScanResult;
  private readonly watcherRecoveryDelayMs: number;
  private readonly failedWatchTargets = new Map<string, FailedWatcherTarget>();

  constructor(
    initialSettings: AppSettings,
    private readonly alertManager: AlertManager,
    private readonly callbacks: WatchEngineCallbacks = {},
    options: WatchEngineOptions = {}
  ) {
    this.settings = initialSettings;
    this.watcherRecoveryDelayMs = Math.max(25, options.watcherRecoveryDelayMs ?? WATCHER_RECOVERY_RETRY_MS);
  }

  getStatus(): WatchStatus {
    return {
      running: this.running,
      periodicEnabled: this.settings.periodicEnabled,
      realtimeEnabled: this.settings.realtimeEnabled,
      watcherCount: this.watchers.length,
      failedWatcherCount: this.failedWatchTargets.size,
      degraded: this.failedWatchTargets.size > 0,
      failedWatchTargets: [...this.failedWatchTargets.values()].map((entry) => entry.targetPath),
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

    this.clearWatcherRecoveryTimer();
    this.pendingRealtimeTargetIds.clear();
    this.realtimeScanEnqueued = false;
    this.failedWatchTargets.clear();

    await this.closeAllWatchers();

    this.nextRunAt = undefined;
    this.emitStatus();
    return this.getStatus();
  }

  async runManual(paths?: string[]): Promise<ScanExecutionOutcome> {
    const targets = paths && paths.length > 0
      ? paths.map((targetPath, index) => ({ id: `manual-${index}`, path: targetPath }))
      : createTargetsFromWatchTargets(this.settings.watchTargets);

    return this.enqueueScan('manual', targets, undefined, {
      includeGlobalThreshold: !paths || paths.length === 0,
    });
  }

  async runScanSet(scanSet: ScanSet): Promise<ScanExecutionOutcome> {
    const targets: ScanTargetInput[] = scanSet.paths.map((targetPath, index) => ({
      id: `${scanSet.id}-${index}`,
      path: targetPath,
    }));

    return this.enqueueScan('scan-set', targets, scanSet.id, {
      includeGlobalThreshold: false,
    });
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
      this.failedWatchTargets.clear();
      this.clearWatcherRecoveryTimer();
      this.emitStatus();
      return;
    }

    const enabledTargets = this.settings.watchTargets.filter((target) => target.enabled);
    const enabledTargetIds = new Set(enabledTargets.map((target) => target.id));

    for (const targetId of [...this.failedWatchTargets.keys()]) {
      if (!enabledTargetIds.has(targetId)) {
        this.failedWatchTargets.delete(targetId);
      }
    }

    for (const target of enabledTargets) {
      if (!fs.existsSync(target.path)) continue;

      try {
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

        this.failedWatchTargets.delete(target.id);
        this.watchers.push(managedWatcher);
      } catch (error) {
        this.failedWatchTargets.set(target.id, {
          targetId: target.id,
          targetPath: target.path,
          lastErrorAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        this.callbacks.onWatcherError?.({
          targetId: target.id,
          targetPath: target.path,
          error,
        });
      }
    }

    if (this.failedWatchTargets.size > 0) {
      this.scheduleWatcherRecoveryRetry();
    } else {
      this.clearWatcherRecoveryTimer();
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
    this.failedWatchTargets.set(entry.targetId, {
      targetId: entry.targetId,
      targetPath: entry.targetPath,
      lastErrorAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    this.callbacks.onWatcherError?.({
      targetId: entry.targetId,
      targetPath: entry.targetPath,
      error,
    });

    void this.closeWatcher(entry).finally(() => {
      this.scheduleWatcherRecoveryRetry();
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
    void this.enqueueScan('watch-realtime', targets, undefined, {
      includeGlobalThreshold: false,
    })
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
        void this.enqueueScan('watch-periodic', targets, undefined, {
          includeGlobalThreshold: true,
        });
      }
      this.resetPeriodicTimer();
    }, intervalMs);

    this.emitStatus();
  }

  private enqueueScan(
    source: AppScanResult['source'],
    targets: ScanTargetInput[],
    setId?: string,
    alertOptions?: { includeGlobalThreshold?: boolean }
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

        const alerts = await this.alertManager.evaluate(scanResult, this.settings, alertOptions);
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

  private scheduleWatcherRecoveryRetry(): void {
    if (!this.running || !this.settings.realtimeEnabled || this.failedWatchTargets.size === 0) {
      this.clearWatcherRecoveryTimer();
      return;
    }

    if (this.watcherRecoveryTimer) return;

    this.watcherRecoveryTimer = setTimeout(() => {
      this.watcherRecoveryTimer = undefined;
      void this.rebuildWatchers().catch(() => {
        this.scheduleWatcherRecoveryRetry();
      });
    }, this.watcherRecoveryDelayMs);
    this.watcherRecoveryTimer.unref?.();
  }

  private clearWatcherRecoveryTimer(): void {
    if (!this.watcherRecoveryTimer) return;
    clearTimeout(this.watcherRecoveryTimer);
    this.watcherRecoveryTimer = undefined;
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
