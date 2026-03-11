import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSettings } from '../src/config.js';
import { AlertManager } from '../src/alert-manager.js';
import type { AppScanResult } from '../src/types.js';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    rmSync(root, { recursive: true, force: true });
  }
});

function createScanResult(totalSize: number, targetSize: number): AppScanResult {
  return {
    runId: randomUUID(),
    source: 'manual',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    targets: [
      {
        targetId: 'target-1',
        targetPath: '/tmp/project',
        totalSize: targetSize,
        directories: [],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 5,
      },
    ],
    totalSize,
    directoryCount: 0,
  };
}

describe('AlertManager', () => {
  it('emits exceeded and resolved alerts for global + target threshold', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-alerts-'));
    tempRoots.push(root);

    const manager = new AlertManager(root);
    const settings = createDefaultSettings();

    settings.alertCooldownMinutes = 30;
    settings.globalThresholdBytes = 100;
    settings.watchTargets = [
      {
        id: 'target-1',
        path: '/tmp/project',
        enabled: true,
        targetThresholdBytes: 50,
      },
    ];

    const exceeded = await manager.evaluate(createScanResult(120, 70), settings);
    assert.equal(exceeded.length, 2);
    assert.equal(exceeded.every((item) => item.status === 'exceeded'), true);

    const cooldownSuppressed = await manager.evaluate(createScanResult(130, 80), settings);
    assert.equal(cooldownSuppressed.length, 0);

    const resolved = await manager.evaluate(createScanResult(20, 10), settings);
    assert.equal(resolved.length, 2);
    assert.equal(resolved.every((item) => item.status === 'resolved'), true);
  });

  it('supports list(limit) and caps alert history', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-alerts-cap-'));
    tempRoots.push(root);
    const alertsPath = path.join(root, 'alerts.json');
    const now = Date.now();
    const seed = Array.from({ length: 5100 }, (_, index) => ({
      id: `alert-${index}`,
      scope: 'global',
      currentBytes: index,
      thresholdBytes: 100,
      status: index % 2 === 0 ? 'exceeded' : 'resolved',
      timestamp: new Date(now + index).toISOString(),
      read: false,
    }));
    writeFileSync(alertsPath, JSON.stringify(seed, null, 2), 'utf-8');

    const manager = new AlertManager(root);

    const all = await manager.list();
    assert.equal(all.length, 5000);

    const limited = await manager.list({ limit: 100 });
    assert.equal(limited.length, 100);
  });

  it('emits resolved alerts when active thresholds are removed from settings', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-alerts-threshold-remove-'));
    tempRoots.push(root);

    const manager = new AlertManager(root);
    const settings = createDefaultSettings();
    settings.globalThresholdBytes = 100;
    settings.watchTargets = [
      {
        id: 'target-1',
        path: '/tmp/project',
        enabled: true,
        targetThresholdBytes: 50,
      },
    ];

    const exceeded = await manager.evaluate(createScanResult(120, 70), settings);
    assert.equal(exceeded.length, 2);

    settings.globalThresholdBytes = 0;
    settings.watchTargets = [];

    const resolved = await manager.evaluate(createScanResult(0, 0), settings);
    assert.equal(resolved.length, 2);
    assert.equal(resolved.every((item) => item.status === 'resolved'), true);
  });
});
