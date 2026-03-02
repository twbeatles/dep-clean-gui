import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsStore, normalizeSettings } from '../src/settings-store.js';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    rmSync(root, { recursive: true, force: true });
  }
});

describe('normalizeSettings', () => {
  it('applies startupChoiceCompleted=false when missing', () => {
    const normalized = normalizeSettings({ autoStart: true });
    assert.equal(normalized.startupChoiceCompleted, false);
  });

  it('forces runInTray to true even when input false', () => {
    const normalized = normalizeSettings({ runInTray: false });
    assert.equal(normalized.runInTray, true);
  });
});

describe('SettingsStore', () => {
  it('migrates legacy settings on load', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-settings-'));
    tempRoots.push(root);

    writeFileSync(
      path.join(root, 'settings.json'),
      JSON.stringify(
        {
          autoStart: false,
          runInTray: false,
          periodicEnabled: true,
          periodicMinutes: 30,
          realtimeEnabled: true,
          globalThresholdBytes: 1024,
          alertCooldownMinutes: 10,
          watchTargets: [],
          scanSets: [],
        },
        null,
        2
      ),
      'utf-8'
    );

    const store = new SettingsStore(root);
    const loaded = await store.load();

    assert.equal(loaded.startupChoiceCompleted, false);
    assert.equal(loaded.runInTray, true);
  });
});
