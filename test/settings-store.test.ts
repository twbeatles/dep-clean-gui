import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  it('falls back to defaults for non-boolean toggle values', () => {
    const normalized = normalizeSettings({
      autoStart: 'false' as unknown as boolean,
      startupChoiceCompleted: 'true' as unknown as boolean,
      periodicEnabled: 0 as unknown as boolean,
      realtimeEnabled: 1 as unknown as boolean,
    });

    assert.equal(normalized.autoStart, false);
    assert.equal(normalized.startupChoiceCompleted, false);
    assert.equal(normalized.periodicEnabled, true);
    assert.equal(normalized.realtimeEnabled, true);
  });

  it('dedupes watch targets by canonical path', () => {
    const firstPath = path.resolve('repo-a', 'node_modules');
    const duplicatePath = path.join(firstPath, '..', 'node_modules');
    const normalized = normalizeSettings({
      watchTargets: [
        { id: 'a', path: firstPath, enabled: true },
        { id: 'b', path: duplicatePath, enabled: true },
      ],
    });

    assert.equal(normalized.watchTargets.length, 1);
    assert.equal(normalized.watchTargets[0].id, 'a');
    assert.equal(path.resolve(normalized.watchTargets[0].path), path.resolve(firstPath));
  });

  it('dedupes scan set paths by canonical path', () => {
    const firstPath = path.resolve('repo-a');
    const duplicatePath = process.platform === 'win32'
      ? firstPath.toUpperCase()
      : path.join(firstPath, '..', path.basename(firstPath));

    const normalized = normalizeSettings({
      scanSets: [
        {
          id: 'set-1',
          name: 'Set',
          paths: [firstPath, duplicatePath],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    assert.equal(normalized.scanSets.length, 1);
    assert.equal(normalized.scanSets[0].paths.length, 1);
    assert.equal(path.resolve(normalized.scanSets[0].paths[0]), path.resolve(firstPath));
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

  it('backs up corrupted settings file and recovers defaults', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dep-clean-settings-corrupt-'));
    tempRoots.push(root);

    const filePath = path.join(root, 'settings.json');
    const corruptedRaw = '{"autoStart": true';
    writeFileSync(filePath, corruptedRaw, 'utf-8');

    const store = new SettingsStore(root);
    const loaded = await store.load();

    assert.equal(loaded.autoStart, false);
    assert.equal(loaded.runInTray, true);

    const backupFiles = readdirSync(root).filter((name) => name.startsWith('settings.corrupt.'));
    assert.equal(backupFiles.length, 1);
    const backupRaw = readFileSync(path.join(root, backupFiles[0]), 'utf-8');
    assert.equal(backupRaw, corruptedRaw);

    const rewritten = JSON.parse(readFileSync(filePath, 'utf-8')) as { runInTray?: boolean };
    assert.equal(rewritten.runInTray, true);
  });
});
