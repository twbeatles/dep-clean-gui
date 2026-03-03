import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  shell,
} from 'electron';
import { deleteDirectories } from '../src/cleaner.js';
import type {
  AppSettings,
  CleanupConfirmResult,
  CleanupPreview,
  FoundDirectory,
  ScanExecutionOutcome,
} from '../src/types.js';
import { AlertManager } from '../src/alert-manager.js';
import { shouldLaunchToTray } from '../src/electron-launch-mode.js';
import { normalizeSupportedLocale, type SupportedLocale } from '../src/i18n/locale.js';
import { translateMainMessage, type MainMessageKey } from '../src/i18n/main-messages.js';
import { runScan } from '../src/scan-runner.js';
import { SettingsStore } from '../src/settings-store.js';
import { WatchEngine } from '../src/watch-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..');
const PRELOAD_FILE = path.join(__dirname, 'preload.cjs');
const RENDERER_INDEX = path.join(DIST_DIR, 'gui', 'index.html');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DEBUG_RENDERER_LOGS = process.env.DEP_CLEAN_DEBUG_LOG === '1';
const STARTUP_LOG_FILE = process.env.DEP_CLEAN_STARTUP_LOG_PATH
  ?? path.join(os.tmpdir(), 'dep-clean-gui-startup.log');
const ENABLE_FILE_DEBUG_LOG = app.isPackaged || DEBUG_RENDERER_LOGS;

function serializeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendDebugLog(message: string, details?: unknown): void {
  if (!ENABLE_FILE_DEBUG_LOG) return;

  const line = details === undefined
    ? `[${new Date().toISOString()}] ${message}\n`
    : `[${new Date().toISOString()}] ${message} ${serializeUnknown(details)}\n`;

  try {
    fs.appendFileSync(STARTUP_LOG_FILE, line, 'utf8');
  } catch {
    // Keep startup resilient even when debug file write fails.
  }
}

process.on('uncaughtException', (error) => {
  appendDebugLog('process.uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  appendDebugLog('process.unhandledRejection', reason);
});

interface CleanupApproval {
  id: string;
  createdAt: string;
  directories: FoundDirectory[];
}

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let tray: InstanceType<typeof Tray> | null = null;
let quitting = false;

const cleanupApprovals = new Map<string, CleanupApproval>();

let settingsStore: SettingsStore;
let alertManager: AlertManager;
let watchEngine: WatchEngine;
let settings: AppSettings;
let uiLocale: SupportedLocale = 'en';

function tMain(key: MainMessageKey, params?: Record<string, string | number>): string {
  return translateMainMessage(uiLocale, key, params);
}

function createTrayIcon() {
  const encoded = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFE0lEQVR4AbXBXWyddR0A4Of3f99zunYMGO1Wx2S4XYyPIUaJCGJCwgWK0WAcxhtD3KU3XmDilVEMhBiUe++IxpgYiMaYoIkxRGOMfKULCQZR2fgoQTrCkK2jPee8P8/Z27O2aweC43ni0v3XpKGwIpAkEqGVWoFAWhWBdFoiUZBWJQoSgUSihFVpKJ0WCK1AQSC0EoEwlKRVBamVSK1EotEK1IZCK6wX1gurivVCK7RCK5AI6yUKSlovvR/pnYRVYVWiNpQIrcxGf+ltTb/vfCp1rdqyRVGkVqIONAg0Gv23T2l6PefbYHlZZupMTglhrKRWY6hpNL2+D0rT78umEUgkShhLmYl0vuTHZ+Tl25yRSTZSCq2SxpJM50vumtLcepnma/utlUlKqVXSSDqnyUlLX73D4OqrvJvlz92qd8vNRgaHrpSvLYrfHLVeWquEFIYSaYPFB+4XU1vFWye8m7KwoPf52/S/8DHmTzI7pTz9ug0SkUg1gSRShg1yZkb3wZ8YyUt3ye4EzUB56WUyrVU/NaeeO6x39yc51qgffNbZEsVQkkItGjJEhncyuPEG/RtvEEdfoNth70eUP//FWCwtqZ540uBLe5W5BTkzKbdfLo4fYWnJ2VIaqTOJdE6pldPTOo/8ljeO0+1oXn5ZMztrrNm3V144Ia9cpCo6989pZi/V+8pBnZ/93AaBpKYgbaquyTQ2+PSNBhddJObnSQTSaeXoC/LASeUf/9Fsm5a79yjPH9HfudNmIkMKNWkzecEFFu+7R/ehh431r7vOlru+JZaWnS13bzX48j6DA5eofnXKye9/19R3vif7A2dLY6kWSJtIJCWcMTkhlpatNbh22uDAdvmZXXKy1n3gsOzuIZwx+NSHVI+9aiy0UiqkzcSJk7be9W3LBw9qpTzygrXyki36d16hfvp1cext0WvEM29YuuOgyXt/oLz4Et2OMn/C5kKJDCNpE/0+EcY6c3POKKH3zY8qT/xb//a9Oj9+Rvn7cXZOyomuWFzUu/2LyrOPGdyy29nSSKqtCENpg9Aqc4ctH/q6Zv9+9VOPaW5a1vn1ETF3jK213qGrNFdvF8eXTTz0S83MjGbXLmXHq6of/stYpNMiyQh1IpxbljBS5l+x5d775BXb9b5xQP3wvKwrZWZSHjul/sU/9Xup2TGrDAaaia7S+av444KowliGVhBJEWkkbS6OvW7p0J2aPZcZieeOizeXDW7ezcyE/rXTTFSaz+5Rnl82uGK/PPG85rZUfv+iuHiCQRqL1EpEqi6c3nm3oUA2jabfs1bnD48a7NunvPmmsrBgpPrTK5oD2w0+sUMEsTgwuPJicewtedmy6miqHjnK7inVo/P0G2NVtyNKkREI1bbp2bszQkjZNJp+z1rR76uf+ZuysOCMpHpyQXnphP71Ow1umpU7JjVXXaz7o8Oay7eLpm9w/QwRyquLxqq6QylEINSplYjwnpRnj5u45yk5VWuuuUTz4a1yW5eZ5LlTOj99zmYCqVVbEUEaCqT3JBb7qsdfUz3utOp3L9pUIKwIIyWsyECIUvmgRKmEQCCNlLQiiAhVpyNKIYLw/wmtIEpRdTqUkGEojNQFDRJRiqKmGzIHskkpkN6viBCIUilVRRSEkUBtRQgRQaEEsjgtEWRakQj/iwgkgogiosgIaVVtKBBWRCFCSDIkilbaKLXCeomwIgyFkbBebSisCoRAEIRVYaOwuXBuYdV/ARFFBDGHk/+yAAAAAElFTkSuQmCC';
  const image = nativeImage.createFromDataURL(`data:image/png;base64,${encoded}`);
  if (image.isEmpty()) return nativeImage.createEmpty();
  return image;
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function updateLoginItemSetting(nextSettings: AppSettings): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: nextSettings.autoStart,
      args: nextSettings.autoStart ? ['--launch-tray'] : [],
    });
  } catch {
    // Some Linux environments may not support this.
  }
}

function updateTrayMenu(): void {
  if (!tray) return;

  const status = watchEngine.getStatus();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: status.running ? tMain('tray.monitor.stop') : tMain('tray.monitor.start'),
      click: () => {
        if (status.running) {
          void watchEngine.stop();
        } else {
          void watchEngine.start();
        }
      },
    },
    {
      label: tMain('tray.runManualScan'),
      click: () => {
        void watchEngine.runManual();
      },
    },
    { type: 'separator' },
    {
      label: tMain('tray.openApp'),
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: tMain('tray.openSettingsFile'),
      click: () => {
        void shell.openPath(settingsStore.path);
      },
    },
    { type: 'separator' },
    {
      label: tMain('tray.quit'),
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('dep-clean-gui');
  tray.setContextMenu(contextMenu);
}

function ensureTray(): void {
  if (tray) return;

  tray = new Tray(createTrayIcon());
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  updateTrayMenu();
}

async function applySettings(nextSettings: AppSettings): Promise<void> {
  settings = nextSettings;
  updateLoginItemSetting(nextSettings);
  watchEngine.updateSettings(nextSettings);
  ensureTray();

  updateTrayMenu();
}

function createWindow(options?: { launchToTray?: boolean }): InstanceType<typeof BrowserWindow> {
  const launchToTray = options?.launchToTray ?? false;
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#11151f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_FILE,
    },
  });

  window.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    appendDebugLog('renderer.did-fail-load', { code, description, validatedURL });
    if (DEBUG_RENDERER_LOGS) {
      console.error('[renderer] did-fail-load', { code, description, validatedURL });
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    appendDebugLog('renderer.render-process-gone', details);
    if (DEBUG_RENDERER_LOGS) {
      console.error('[renderer] render-process-gone', details);
    }
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    appendDebugLog('renderer.preload-error', {
      preloadPath,
      error: serializeUnknown(error),
    });
    if (DEBUG_RENDERER_LOGS) {
      console.error('[renderer] preload-error', { preloadPath, error });
    }
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      appendDebugLog('renderer.console-error', { level, message, line, sourceId });
      if (DEBUG_RENDERER_LOGS) {
        console.error('[renderer] console-error', { level, message, line, sourceId });
      }
    }
  });

  if (DEBUG_RENDERER_LOGS) {
    window.webContents.on('did-start-loading', () => {
      console.log('[renderer] did-start-loading');
      appendDebugLog('renderer.did-start-loading');
    });
    window.webContents.on('did-finish-load', () => {
      console.log('[renderer] did-finish-load');
      appendDebugLog('renderer.did-finish-load');
    });
  }

  window.once('ready-to-show', () => {
    appendDebugLog('window.ready-to-show', { launchToTray });
    if (!launchToTray) {
      window.show();
    }
  });

  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    appendDebugLog('window.close->hide');
    window.hide();
  });

  if (VITE_DEV_SERVER_URL) {
    void window.loadURL(VITE_DEV_SERVER_URL).catch((error) => {
      appendDebugLog('window.loadURL.failed', error);
    });
  } else {
    void window.loadFile(RENDERER_INDEX).catch((error) => {
      appendDebugLog('window.loadFile.failed', error);
    });
  }

  return window;
}

function formatThreshold(currentBytes: number, thresholdBytes: number): string {
  const mb = (value: number) => Math.round(value / (1024 * 1024));
  return `${mb(currentBytes)}MB / ${mb(thresholdBytes)}MB`;
}

async function sendOsNotifications(outcome: ScanExecutionOutcome): Promise<void> {
  for (const alert of outcome.alerts) {
    const title = alert.status === 'exceeded'
      ? tMain('notification.title.exceeded')
      : tMain('notification.title.resolved');
    const scope = alert.scope === 'global'
      ? tMain('notification.scope.global')
      : alert.targetPath ?? alert.targetId ?? tMain('notification.scope.target');

    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body: tMain('notification.body', {
          scope,
          value: formatThreshold(alert.currentBytes, alert.thresholdBytes),
        }),
      });
      notification.show();
    }
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('settings.get', async () => settings);

  ipcMain.handle('settings.update', async (_event, partial: Partial<AppSettings>) => {
    const nextSettings = await settingsStore.update(partial);
    if (!isDeepStrictEqual(settings, nextSettings)) {
      await applySettings(nextSettings);
    }
    return settings;
  });

  ipcMain.handle('scan.runManual', async (_event, paths?: string[]) => {
    const outcome = await watchEngine.runManual(paths);
    await sendOsNotifications(outcome);
    return outcome;
  });

  ipcMain.handle('scan.runSet', async (_event, setId: string) => {
    const scanSet = settings.scanSets.find((item) => item.id === setId);
    if (!scanSet) {
      throw new Error(tMain('error.scanSetNotFound', { setId }));
    }

    const outcome = await watchEngine.runScanSet(scanSet);
    await sendOsNotifications(outcome);
    return outcome;
  });

  ipcMain.handle('scan.getLastResult', async () => {
    return watchEngine.getLastResult() ?? null;
  });

  ipcMain.handle('watch.start', async () => watchEngine.start());
  ipcMain.handle('watch.stop', async () => watchEngine.stop());
  ipcMain.handle('watch.status', async () => watchEngine.getStatus());

  ipcMain.handle('alerts.list', async (_event, options?: { limit?: number }) => alertManager.list(options));
  ipcMain.handle('alerts.markRead', async (_event, ids: string[]) => alertManager.markRead(ids));
  ipcMain.handle('alerts.clear', async () => {
    await alertManager.clear();
    return [];
  });

  ipcMain.handle('folders.pick', async () => {
    if (!mainWindow) return [];

    const result = await dialog.showOpenDialog(mainWindow, {
      title: tMain('dialog.selectFoldersTitle'),
      properties: ['openDirectory', 'multiSelections', 'createDirectory'],
    });

    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('cleanup.preview', async (_event, paths?: string[]) => {
    const targets = paths && paths.length > 0
      ? paths.map((targetPath, index) => ({ id: `preview-${index}`, path: targetPath }))
      : settings.watchTargets
          .filter((target) => target.enabled)
          .map((target) => ({
            id: target.id,
            path: target.path,
            only: target.only,
            exclude: target.exclude,
          }));

    const scanResult = await runScan({
      source: 'manual',
      targets,
    });

    const directories = scanResult.targets.flatMap((target) => target.directories);

    const approval: CleanupApproval = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      directories,
    };

    cleanupApprovals.set(approval.id, approval);

    const preview: CleanupPreview = {
      approvalId: approval.id,
      createdAt: approval.createdAt,
      directories,
      totalSize: directories.reduce((sum, dir) => sum + dir.size, 0),
    };

    return preview;
  });

  ipcMain.handle('cleanup.confirmDelete', async (_event, approvalId: string, selectedPaths: string[]) => {
    const approval = cleanupApprovals.get(approvalId);
    if (!approval) {
      throw new Error(tMain('error.cleanupApprovalMissing'));
    }

    const selectedSet = new Set(selectedPaths);
    const selected = approval.directories.filter((dir) => selectedSet.has(dir.path));

    const results = await deleteDirectories(selected);
    const failures = results
      .filter((result) => !result.success)
      .map((result) => ({ path: result.path, error: result.error ?? tMain('error.unknownCleanup') }));

    const deletedCount = results.filter((result) => result.success).length;
    const successPaths = new Set(results.filter((result) => result.success).map((result) => result.path));
    const freedSize = selected
      .filter((dir) => successPaths.has(dir.path))
      .reduce((sum, dir) => sum + dir.size, 0);

    cleanupApprovals.delete(approvalId);

    const response: CleanupConfirmResult = {
      deletedCount,
      freedSize,
      failures,
    };

    return response;
  });
}

async function bootstrap(): Promise<void> {
  appendDebugLog('bootstrap.start', {
    isPackaged: app.isPackaged,
    platform: process.platform,
    versions: process.versions,
    argv: process.argv,
    preloadFile: PRELOAD_FILE,
    preloadExists: fs.existsSync(PRELOAD_FILE),
    rendererIndex: RENDERER_INDEX,
    rendererExists: fs.existsSync(RENDERER_INDEX),
  });

  try {
    const singleLock = app.requestSingleInstanceLock();
    appendDebugLog('bootstrap.single-instance-lock', { acquired: singleLock });
    if (!singleLock) {
      app.quit();
      return;
    }

    app.on('second-instance', () => {
      appendDebugLog('app.second-instance');
      if (!mainWindow) return;
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    });

    await app.whenReady();
    appendDebugLog('bootstrap.whenReady');
    uiLocale = normalizeSupportedLocale(app.getLocale());
    appendDebugLog('bootstrap.locale', { appLocale: app.getLocale(), resolvedLocale: uiLocale });

    settingsStore = new SettingsStore(app.getPath('userData'));
    alertManager = new AlertManager(app.getPath('userData'));
    settings = await settingsStore.load();
    appendDebugLog('bootstrap.settings-loaded', {
      watchTargetCount: settings.watchTargets.length,
      scanSetCount: settings.scanSets.length,
      periodicEnabled: settings.periodicEnabled,
      realtimeEnabled: settings.realtimeEnabled,
    });

    const loginItemSettings = (() => {
      try {
        return app.getLoginItemSettings();
      } catch {
        return { wasOpenedAtLogin: false };
      }
    })();
    const launchToTray = shouldLaunchToTray({
      argv: process.argv,
      wasOpenedAtLogin: Boolean(loginItemSettings.wasOpenedAtLogin),
    });
    appendDebugLog('bootstrap.launch-mode', { launchToTray });

    watchEngine = new WatchEngine(settings, alertManager, {
      onProgress: (event) => {
        sendToRenderer('scan.progress', event);
      },
      onScanCompleted: async (outcome) => {
        sendToRenderer('scan.completed', outcome);
        if (outcome.alerts.length > 0) {
          sendToRenderer('alerts.created', outcome.alerts);
        }
        await sendOsNotifications(outcome);
      },
      onStatusChanged: (status) => {
        updateTrayMenu();
        sendToRenderer('watch.status.changed', status);
      },
    });

    updateLoginItemSetting(settings);
    ensureTray();
    appendDebugLog('bootstrap.tray-ready');

    registerIpcHandlers();
    appendDebugLog('bootstrap.ipc-registered');
    mainWindow = createWindow({ launchToTray });
    appendDebugLog('bootstrap.window-created');

    if (settings.periodicEnabled || settings.realtimeEnabled) {
      await watchEngine.start();
      appendDebugLog('bootstrap.watch-started');
    }

    app.on('activate', () => {
      appendDebugLog('app.activate');
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow({ launchToTray: false });
      } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app.on('before-quit', () => {
      quitting = true;
      appendDebugLog('app.before-quit');
    });

    app.on('window-all-closed', () => {
      appendDebugLog('app.window-all-closed');
      // Keep running in tray until user explicitly quits.
    });
  } catch (error) {
    appendDebugLog('bootstrap.error', error);
    if (app.isReady()) {
      dialog.showErrorBox(tMain('error.startupFailedTitle'), String(error));
    }
    app.quit();
  }
}

void bootstrap();
