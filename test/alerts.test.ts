import { mkdtempSync, rmSync } from 'node:fs';
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
});
