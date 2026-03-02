import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldLaunchToTray } from '../src/electron-launch-mode.js';

describe('shouldLaunchToTray', () => {
  it('returns true when launch arg is present', () => {
    const result = shouldLaunchToTray({
      argv: ['app.exe', '--launch-tray'],
      wasOpenedAtLogin: false,
    });

    assert.equal(result, true);
  });

  it('returns true when opened at login', () => {
    const result = shouldLaunchToTray({
      argv: ['app.exe'],
      wasOpenedAtLogin: true,
    });

    assert.equal(result, true);
  });

  it('returns false for normal launch', () => {
    const result = shouldLaunchToTray({
      argv: ['app.exe'],
      wasOpenedAtLogin: false,
    });

    assert.equal(result, false);
  });
});
