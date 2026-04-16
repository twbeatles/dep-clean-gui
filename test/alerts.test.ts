import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

function createScanResult(
  totalSize: number,
  targetSize: number,
  options: Partial<AppScanResult> & {
    targetId?: string;
    targetPath?: string;
  } = {}
): AppScanResult {
  const now = new Date().toISOString();
  return {
    runId: options.runId ?? randomUUID(),
    source: options.source ?? 'manual',
    setId: options.setId,
    startedAt: options.startedAt ?? now,
    finishedAt: options.finishedAt ?? now,
    targets: [
      {
        targetId: options.targetId ?? 'target-1',
        targetPath: options.targetPath ?? '/tmp/project',
        totalSize: targetSize,
        directories: [],
        startedAt: now,
        finishedAt: now,
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

  it('does not resolve active alerts for configured targets omitted from a partial scan', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-alerts-partial-'));
    tempRoots.push(root);

    const manager = new AlertManager(root);
    const settings = createDefaultSettings();
    settings.globalThresholdBytes = 0;
    settings.watchTargets = [
      {
        id: 'target-a',
        path: '/tmp/project-a',
        enabled: true,
        targetThresholdBytes: 100,
      },
      {
        id: 'target-b',
        path: '/tmp/project-b',
        enabled: true,
        targetThresholdBytes: 100,
      },
    ];

    const exceeded = await manager.evaluate(createScanResult(150, 150, {
      targetId: 'target-a',
      targetPath: '/tmp/project-a',
    }), settings, {
      includeGlobalThreshold: false,
    });
    assert.equal(exceeded.length, 1);
    assert.equal(exceeded[0].status, 'exceeded');

    const partial = await manager.evaluate(createScanResult(10, 10, {
      source: 'scan-set',
      setId: 'set-1',
      targetId: 'set-1-0',
      targetPath: '/tmp/project-b',
    }), settings, {
      includeGlobalThreshold: false,
    });
    assert.equal(partial.length, 0);

    const alerts = await manager.list();
    assert.equal(alerts.filter((alert) => alert.status === 'resolved').length, 0);
  });

  it('keeps active global alerts during partial scans when global evaluation is skipped', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-alerts-global-partial-'));
    tempRoots.push(root);

    const manager = new AlertManager(root);
    const settings = createDefaultSettings();
    settings.globalThresholdBytes = 100;

    const exceeded = await manager.evaluate(createScanResult(150, 0), settings, {
      includeGlobalThreshold: true,
    });
    assert.equal(exceeded.length, 1);
    assert.equal(exceeded[0].scope, 'global');
    assert.equal(exceeded[0].status, 'exceeded');

    const partial = await manager.evaluate(createScanResult(10, 0, {
      source: 'watch-realtime',
    }), settings, {
      includeGlobalThreshold: false,
    });
    assert.equal(partial.length, 0);

    const alerts = await manager.list();
    assert.equal(alerts.filter((alert) => alert.scope === 'global' && alert.status === 'resolved').length, 0);
  });

  it('matches target thresholds by canonical path for scan set and partial scans', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-alerts-scan-set-path-'));
    tempRoots.push(root);

    const manager = new AlertManager(root);
    const settings = createDefaultSettings();
    settings.globalThresholdBytes = 0;
    settings.watchTargets = [
      {
        id: 'target-1',
        path: '/tmp/project',
        enabled: true,
        targetThresholdBytes: 50,
      },
    ];

    const alerts = await manager.evaluate(createScanResult(120, 120, {
      source: 'scan-set',
      setId: 'set-1',
      targetId: 'set-1-0',
      targetPath: '/tmp/project',
    }), settings, {
      includeGlobalThreshold: false,
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].status, 'exceeded');
    assert.equal(alerts[0].targetId, 'target-1');
    assert.equal(alerts[0].targetPath, '/tmp/project');
  });

  it('backs up corrupted alerts history before recovery', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-alerts-corrupt-'));
    tempRoots.push(root);

    writeFileSync(path.join(root, 'alerts.json'), '{"broken"', 'utf-8');

    const manager = new AlertManager(root);
    const alerts = await manager.list();
    assert.equal(alerts.length, 0);

    const files = readdirSync(root);
    assert.equal(files.includes('alerts.json'), true);
    assert.equal(files.some((file) => file.startsWith('alerts.corrupt.')), true);
  });
});
