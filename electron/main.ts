import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { runScan } from '../src/scan-runner.js';
import { SettingsStore } from '../src/settings-store.js';
import { WatchEngine } from '../src/watch-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..');
const PRELOAD_FILE = path.join(__dirname, 'preload.js');
const RENDERER_INDEX = path.join(DIST_DIR, 'gui', 'index.html');
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

interface CleanupApproval {
  id: string;
  createdAt: string;
  directories: FoundDirectory[];
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const cleanupApprovals = new Map<string, CleanupApproval>();

let settingsStore: SettingsStore;
let alertManager: AlertManager;
let watchEngine: WatchEngine;
let settings: AppSettings;

function createTrayIcon() {
  const encoded = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAKklEQVR4AWNgGAWjYBSMglEwCkbBqBgFo2AUjIJRMApGwSgYBQAAANfYAhpZJYGmAAAAAElFTkSuQmCC';
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
      label: status.running ? 'Stop Monitoring' : 'Start Monitoring',
      click: () => {
        if (status.running) {
          void watchEngine.stop();
        } else {
          void watchEngine.start();
        }
      },
    },
    {
      label: 'Run Manual Scan',
      click: () => {
        void watchEngine.runManual();
      },
    },
    { type: 'separator' },
    {
      label: 'Open App',
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Open Settings File',
      click: () => {
        void shell.openPath(settingsStore.path);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
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

function createWindow(options?: { launchToTray?: boolean }): BrowserWindow {
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

  window.once('ready-to-show', () => {
    if (!launchToTray) {
      window.show();
    }
  });

  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });

  if (VITE_DEV_SERVER_URL) {
    void window.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(RENDERER_INDEX);
  }

  return window;
}

function formatThreshold(currentBytes: number, thresholdBytes: number): string {
  const mb = (value: number) => Math.round(value / (1024 * 1024));
  return `${mb(currentBytes)}MB / ${mb(thresholdBytes)}MB`;
}

async function sendOsNotifications(outcome: ScanExecutionOutcome): Promise<void> {
  for (const alert of outcome.alerts) {
    const title = alert.status === 'exceeded' ? 'dep-clean threshold exceeded' : 'dep-clean threshold resolved';
    const scope = alert.scope === 'global' ? 'Global' : alert.targetPath ?? alert.targetId ?? 'Target';

    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body: `${scope}: ${formatThreshold(alert.currentBytes, alert.thresholdBytes)}`,
      });
      notification.show();
    }
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('settings.get', async () => settings);

  ipcMain.handle('settings.update', async (_event, partial: Partial<AppSettings>) => {
    const nextSettings = await settingsStore.update(partial);
    await applySettings(nextSettings);
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
      throw new Error(`Scan set not found: ${setId}`);
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

  ipcMain.handle('alerts.list', async () => alertManager.list());
  ipcMain.handle('alerts.markRead', async (_event, ids: string[]) => alertManager.markRead(ids));
  ipcMain.handle('alerts.clear', async () => {
    await alertManager.clear();
    return [];
  });

  ipcMain.handle('folders.pick', async () => {
    if (!mainWindow) return [];

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select folders',
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
      throw new Error('Approval request expired or missing.');
    }

    const selectedSet = new Set(selectedPaths);
    const selected = approval.directories.filter((dir) => selectedSet.has(dir.path));

    const results = await deleteDirectories(selected);
    const failures = results
      .filter((result) => !result.success)
      .map((result) => ({ path: result.path, error: result.error ?? 'Unknown error' }));

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
  const singleLock = app.requestSingleInstanceLock();
  if (!singleLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  await app.whenReady();

  settingsStore = new SettingsStore(app.getPath('userData'));
  alertManager = new AlertManager(app.getPath('userData'));
  settings = await settingsStore.load();
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

  mainWindow = createWindow({ launchToTray });
  registerIpcHandlers();

  if (settings.periodicEnabled || settings.realtimeEnabled) {
    await watchEngine.start();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow({ launchToTray: false });
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    // Keep running in tray until user explicitly quits.
  });
}

void bootstrap();
