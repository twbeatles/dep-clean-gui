import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSettings } from '../src/config.js';
import { AlertManager } from '../src/alert-manager.js';
import { WatchEngine } from '../src/watch-engine.js';
import type { ScanExecutionOutcome } from '../src/types.js';

const tempRoots: string[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeOutcome(): ScanExecutionOutcome {
  const now = new Date().toISOString();
  return {
    scanResult: {
      runId: randomUUID(),
      source: 'watch-realtime',
      startedAt: now,
      finishedAt: now,
      targets: [],
      totalSize: 0,
      directoryCount: 0,
    },
    alerts: [],
  };
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    rmSync(root, { recursive: true, force: true });
  }
});

describe('WatchEngine', () => {
  it('does not rebuild watchers when only non-watcher settings change', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-watch-diff-'));
    tempRoots.push(root);

    const settings = createDefaultSettings();
    settings.periodicEnabled = false;
    settings.realtimeEnabled = false;

    const engine = new WatchEngine(settings, new AlertManager(root));
    const engineInternal = engine as unknown as {
      rebuildWatchers: () => Promise<void>;
    };

    let rebuildCalls = 0;
    const originalRebuild = engineInternal.rebuildWatchers.bind(engine);
    engineInternal.rebuildWatchers = async () => {
      rebuildCalls += 1;
      return originalRebuild();
    };

    await engine.start();
    rebuildCalls = 0;

    engine.updateSettings({
      ...settings,
      alertCooldownMinutes: settings.alertCooldownMinutes + 1,
    });

    await delay(60);
    assert.equal(rebuildCalls, 0);

    engine.updateSettings({
      ...settings,
      realtimeEnabled: true,
    });

    await delay(60);
    assert.equal(rebuildCalls > 0, true);

    await engine.stop();
  });

  it('coalesces realtime bursts into bounded scan enqueue calls', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-watch-coalesce-'));
    tempRoots.push(root);

    const watchPath = path.join(root, 'watch');
    mkdirSync(watchPath, { recursive: true });

    const settings = createDefaultSettings();
    settings.periodicEnabled = false;
    settings.realtimeEnabled = true;
    settings.watchTargets = [
      {
        id: 'target-1',
        path: watchPath,
        enabled: true,
      },
    ];

    const engine = new WatchEngine(settings, new AlertManager(root));
    const engineInternal = engine as unknown as {
      enqueueScan: (...args: unknown[]) => Promise<ScanExecutionOutcome>;
    };

    let enqueueCalls = 0;
    engineInternal.enqueueScan = async () => {
      enqueueCalls += 1;
      await delay(900);
      return createFakeOutcome();
    };

    await engine.start();

    for (let i = 0; i < 5; i++) {
      await engine.runRealtimeForTarget('target-1');
    }

    await delay(2100);

    for (let i = 0; i < 5; i++) {
      await engine.runRealtimeForTarget('target-1');
    }

    await delay(2600);
    assert.equal(enqueueCalls, 2);

    await engine.stop();
  });

  it('recovers watcher state after stop and restart', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-watch-restart-'));
    tempRoots.push(root);

    const watchPath = path.join(root, 'watch');
    mkdirSync(watchPath, { recursive: true });

    const settings = createDefaultSettings();
    settings.periodicEnabled = false;
    settings.realtimeEnabled = true;
    settings.watchTargets = [
      {
        id: 'target-1',
        path: watchPath,
        enabled: true,
      },
    ];

    const engine = new WatchEngine(settings, new AlertManager(root));

    await engine.start();
    const started = engine.getStatus();
    assert.equal(started.running, true);
    assert.equal(started.watcherCount > 0, true);

    await engine.stop();
    const stopped = engine.getStatus();
    assert.equal(stopped.running, false);
    assert.equal(stopped.watcherCount, 0);

    await engine.start();
    const restarted = engine.getStatus();
    assert.equal(restarted.running, true);
    assert.equal(restarted.watcherCount > 0, true);

    await engine.stop();
  });

  it('keeps monitoring active after watcher error and removes failed watcher', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-watch-error-soft-'));
    tempRoots.push(root);

    const watchPath = path.join(root, 'watch');
    mkdirSync(watchPath, { recursive: true });

    const settings = createDefaultSettings();
    settings.periodicEnabled = false;
    settings.realtimeEnabled = true;
    settings.watchTargets = [
      {
        id: 'target-1',
        path: watchPath,
        enabled: true,
      },
    ];

    const watcherErrors: Array<{ targetId: string; targetPath: string; error: unknown }> = [];
    const engine = new WatchEngine(settings, new AlertManager(root), {
      onWatcherError: (event) => {
        watcherErrors.push(event);
      },
    });

    await engine.start();
    const started = engine.getStatus();
    assert.equal(started.running, true);
    assert.equal(started.watcherCount > 0, true);

    const engineInternal = engine as unknown as {
      watchers: Array<{ watcher: { emit: (event: string, error: unknown) => boolean } }>;
    };
    const failedWatcher = engineInternal.watchers[0];
    assert.ok(failedWatcher);

    const simulatedError = new Error('simulated watcher failure');
    failedWatcher.watcher.emit('error', simulatedError);
    await delay(60);

    const afterError = engine.getStatus();
    assert.equal(afterError.running, true);
    assert.equal(afterError.watcherCount, 0);
    assert.equal(watcherErrors.length, 1);
    assert.equal(watcherErrors[0].targetId, 'target-1');
    assert.equal(watcherErrors[0].targetPath, watchPath);
    assert.equal(watcherErrors[0].error, simulatedError);

    await engine.stop();
  });
});
