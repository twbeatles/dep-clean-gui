import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AppScanResult, AppSettings, ThresholdAlert } from './types.js';

interface EvaluatedThreshold {
  key: string;
  scope: 'global' | 'target';
  currentBytes: number;
  thresholdBytes: number;
  targetId?: string;
  targetPath?: string;
  exceeded: boolean;
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

  constructor(baseDir?: string) {
    this.filePath = getAlertsPath(baseDir);
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
      const key = alert.scope === 'global' ? 'global' : `target:${alert.targetId ?? ''}`;
      this.activeState.set(key, alert.status === 'exceeded');
      this.lastEmittedAt.set(key, toTimestamp(alert.timestamp));
    }

    this.hydrated = true;
  }

  private async persist(): Promise<void> {
    await ensureParentDir(this.filePath);
    await fs.promises.writeFile(this.filePath, JSON.stringify(this.alerts, null, 2), 'utf-8');
  }

  async list(): Promise<ThresholdAlert[]> {
    await this.hydrate();
    return [...this.alerts].sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp));
  }

  async clear(): Promise<void> {
    await this.hydrate();
    this.alerts = [];
    this.activeState.clear();
    this.lastEmittedAt.clear();
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
      const sourceTarget = settings.watchTargets.find((item) => item.id === target.targetId);
      const thresholdBytes = sourceTarget?.targetThresholdBytes;
      if (!thresholdBytes || thresholdBytes <= 0) continue;

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

    if (created.length > 0) {
      await this.persist();
    }

    return created;
  }
}
