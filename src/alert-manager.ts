import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AppScanResult, AppSettings, ThresholdAlert } from './types.js';

const ALERT_HISTORY_MAX = 5000;

interface EvaluatedThreshold {
  key: string;
  scope: 'global' | 'target';
  currentBytes: number;
  thresholdBytes: number;
  targetId?: string;
  targetPath?: string;
  exceeded: boolean;
}

interface AlertKeySnapshot {
  scope: 'global' | 'target';
  currentBytes: number;
  thresholdBytes: number;
  targetId?: string;
  targetPath?: string;
}

function getAlertsPath(baseDir?: string): string {
  const root = baseDir ?? path.join(os.homedir(), '.dep-clean-gui');
  return path.join(root, 'alerts.json');
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

function toTimestamp(value: string): number {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
}

export class AlertManager {
  private readonly filePath: string;
  private alerts: ThresholdAlert[] = [];
  private hydrated = false;
  private activeState = new Map<string, boolean>();
  private lastEmittedAt = new Map<string, number>();
  private lastSnapshotByKey = new Map<string, AlertKeySnapshot>();

  constructor(baseDir?: string) {
    this.filePath = getAlertsPath(baseDir);
  }

  private keyForAlert(alert: Pick<ThresholdAlert, 'scope' | 'targetId'>): string {
    return alert.scope === 'global' ? 'global' : `target:${alert.targetId ?? ''}`;
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;

    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        this.alerts = parsed.filter((item): item is ThresholdAlert => {
          return Boolean(
            item &&
              typeof item === 'object' &&
              typeof item.id === 'string' &&
              typeof item.scope === 'string' &&
              typeof item.status === 'string' &&
              typeof item.timestamp === 'string'
          );
        });
      }
    } catch {
      this.alerts = [];
    }

    // Rebuild state from chronological history.
    const sorted = [...this.alerts].sort((a, b) => toTimestamp(a.timestamp) - toTimestamp(b.timestamp));
    for (const alert of sorted) {
      const key = this.keyForAlert(alert);
      this.activeState.set(key, alert.status === 'exceeded');
      this.lastEmittedAt.set(key, toTimestamp(alert.timestamp));
      this.lastSnapshotByKey.set(key, {
        scope: alert.scope,
        currentBytes: alert.currentBytes,
        thresholdBytes: alert.thresholdBytes,
        targetId: alert.targetId,
        targetPath: alert.targetPath,
      });
    }

    if (this.trimHistory()) {
      await this.persist();
    }

    this.hydrated = true;
  }

  private async persist(): Promise<void> {
    await ensureParentDir(this.filePath);
    await fs.promises.writeFile(this.filePath, JSON.stringify(this.alerts, null, 2), 'utf-8');
  }

  async list(options?: { limit?: number }): Promise<ThresholdAlert[]> {
    await this.hydrate();
    const sorted = [...this.alerts].sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp));
    const limit = options?.limit ?? 0;

    if (limit > 0) {
      return sorted.slice(0, limit);
    }

    return sorted;
  }

  async clear(): Promise<void> {
    await this.hydrate();
    this.alerts = [];
    this.activeState.clear();
    this.lastEmittedAt.clear();
    this.lastSnapshotByKey.clear();
    await this.persist();
  }

  async markRead(ids: string[]): Promise<ThresholdAlert[]> {
    await this.hydrate();
    const idSet = new Set(ids);

    this.alerts = this.alerts.map((alert) => {
      if (!idSet.has(alert.id)) return alert;
      return { ...alert, read: true };
    });

    await this.persist();
    return this.list();
  }

  async evaluate(scanResult: AppScanResult, settings: AppSettings): Promise<ThresholdAlert[]> {
    await this.hydrate();

    const evaluated: EvaluatedThreshold[] = [];
    const watchTargetThresholdById = new Map<string, number>();

    for (const target of settings.watchTargets) {
      if (!target.targetThresholdBytes || target.targetThresholdBytes <= 0) continue;
      watchTargetThresholdById.set(target.id, target.targetThresholdBytes);
    }

    if (settings.globalThresholdBytes > 0) {
      evaluated.push({
        key: 'global',
        scope: 'global',
        currentBytes: scanResult.totalSize,
        thresholdBytes: settings.globalThresholdBytes,
        exceeded: scanResult.totalSize > settings.globalThresholdBytes,
      });
    }

    for (const target of scanResult.targets) {
      const thresholdBytes = watchTargetThresholdById.get(target.targetId);
      if (!thresholdBytes) continue;

      evaluated.push({
        key: `target:${target.targetId}`,
        scope: 'target',
        targetId: target.targetId,
        targetPath: target.targetPath,
        currentBytes: target.totalSize,
        thresholdBytes,
        exceeded: target.totalSize > thresholdBytes,
      });
    }

    const now = Date.now();
    const cooldownMs = Math.max(0, settings.alertCooldownMinutes) * 60_000;
    const created: ThresholdAlert[] = [];
    const evaluatedKeys = new Set(evaluated.map((threshold) => threshold.key));

    for (const threshold of evaluated) {
      this.lastSnapshotByKey.set(threshold.key, {
        scope: threshold.scope,
        currentBytes: threshold.currentBytes,
        thresholdBytes: threshold.thresholdBytes,
        targetId: threshold.targetId,
        targetPath: threshold.targetPath,
      });
    }

    for (const threshold of evaluated) {
      const active = this.activeState.get(threshold.key) ?? false;
      const lastAt = this.lastEmittedAt.get(threshold.key) ?? 0;

      if (threshold.exceeded) {
        const outOfCooldown = now - lastAt >= cooldownMs;

        if (!active || outOfCooldown) {
          const alert: ThresholdAlert = {
            id: randomUUID(),
            scope: threshold.scope,
            targetId: threshold.targetId,
            targetPath: threshold.targetPath,
            currentBytes: threshold.currentBytes,
            thresholdBytes: threshold.thresholdBytes,
            status: 'exceeded',
            timestamp: new Date(now).toISOString(),
            read: false,
          };
          created.push(alert);
          this.alerts.push(alert);
          this.activeState.set(threshold.key, true);
          this.lastEmittedAt.set(threshold.key, now);
        }
        continue;
      }

      if (active) {
        const alert: ThresholdAlert = {
          id: randomUUID(),
          scope: threshold.scope,
          targetId: threshold.targetId,
          targetPath: threshold.targetPath,
          currentBytes: threshold.currentBytes,
          thresholdBytes: threshold.thresholdBytes,
          status: 'resolved',
          timestamp: new Date(now).toISOString(),
          read: false,
        };

        created.push(alert);
        this.alerts.push(alert);
        this.activeState.set(threshold.key, false);
        this.lastEmittedAt.set(threshold.key, now);
      }
    }

    for (const [key, active] of [...this.activeState.entries()]) {
      if (evaluatedKeys.has(key)) continue;

      const snapshot = this.lastSnapshotByKey.get(key);
      if (active && snapshot) {
        const alert: ThresholdAlert = {
          id: randomUUID(),
          scope: snapshot.scope,
          targetId: snapshot.targetId,
          targetPath: snapshot.targetPath,
          currentBytes: 0,
          thresholdBytes: snapshot.thresholdBytes,
          status: 'resolved',
          timestamp: new Date(now).toISOString(),
          read: false,
        };

        created.push(alert);
        this.alerts.push(alert);
      }

      this.activeState.delete(key);
      this.lastEmittedAt.delete(key);
      this.lastSnapshotByKey.delete(key);
    }

    const trimmed = this.trimHistory();

    if (created.length > 0 || trimmed) {
      await this.persist();
    }

    return created;
  }

  private trimHistory(): boolean {
    if (this.alerts.length <= ALERT_HISTORY_MAX) return false;
    this.alerts = this.alerts
      .sort((a, b) => toTimestamp(a.timestamp) - toTimestamp(b.timestamp))
      .slice(-ALERT_HISTORY_MAX);
    return true;
  }
}
