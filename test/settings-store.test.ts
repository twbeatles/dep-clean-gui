import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsStore, normalizeSettings } from '../src/settings-store.js';

const tempRoots: string[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  it('does not rewrite file for no-op load/update calls', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-settings-cache-'));
    tempRoots.push(root);

    const store = new SettingsStore(root);
    await store.load();

    const filePath = path.join(root, 'settings.json');
    const firstMtime = statSync(filePath).mtimeMs;

    await delay(20);
    await store.load();
    const secondMtime = statSync(filePath).mtimeMs;
    assert.equal(secondMtime, firstMtime);

    await delay(20);
    await store.update({});
    const thirdMtime = statSync(filePath).mtimeMs;
    assert.equal(thirdMtime, secondMtime);
  });

  it('writes once for a real update and skips repeated no-op updates', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-settings-update-'));
    tempRoots.push(root);

    const store = new SettingsStore(root);
    await store.load();

    const filePath = path.join(root, 'settings.json');
    const firstMtime = statSync(filePath).mtimeMs;

    await delay(20);
    await store.update({ alertCooldownMinutes: 15 });
    const secondMtime = statSync(filePath).mtimeMs;
    assert.equal(secondMtime > firstMtime, true);

    await delay(20);
    await store.update({ alertCooldownMinutes: 15 });
    const thirdMtime = statSync(filePath).mtimeMs;
    assert.equal(thirdMtime, secondMtime);
  });
});
