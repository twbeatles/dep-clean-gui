import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSupportedLocale } from '../../src/i18n/locale';
import {
  createRendererTranslator,
  type RendererTranslator,
} from '../../src/i18n/renderer-messages';
import type { DepCleanApi } from '../../src/ipc-types';
import type {
  AppScanResult,
  AppSettings,
  CleanupPreview,
  ScanExecutionOutcome,
  ScanProgressEvent,
  ScanSet,
  ThresholdAlert,
  WatchStatus,
  WatchTarget,
} from '../../src/types';
import './styles/app.css';

type TabKey = 'dashboard' | 'scanSets' | 'settings' | 'alerts';

const SETTINGS_COMMIT_DEBOUNCE_MS = 400;
const PREVIEW_PAGE_SIZE = 200;
const ALERT_PAGE_SIZE = 200;
const ALERT_HISTORY_MAX = 5000;

function bytesToText(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value < 10 && exponent > 0 ? 2 : 1)} ${units[exponent]}`;
}

function bytesToMbInput(bytes: number): number {
  return Math.max(0, Math.round(bytes / (1024 * 1024)));
}

function mbInputToBytes(mb: number): number {
  return Math.max(0, Math.floor(mb * 1024 * 1024));
}

function timestampText(iso: string): string {
  return new Date(iso).toLocaleString();
}

function createTarget(targetPath: string): WatchTarget {
  return {
    id: crypto.randomUUID(),
    path: targetPath,
    enabled: true,
  };
}

function buildSetName(paths: string[], t: RendererTranslator): string {
  if (paths.length === 1) {
    const tokens = paths[0].split(/[/\\]/g).filter(Boolean);
    return t('setName.single', { name: tokens[tokens.length - 1] ?? 'scan' });
  }

  return t('setName.multiple', {
    count: paths.length,
    date: new Date().toLocaleDateString(),
  });
}

function mergeSettingsPatch(
  current: Partial<AppSettings>,
  patch: Partial<AppSettings>
): Partial<AppSettings> {
  return {
    ...current,
    ...patch,
    watchTargets: patch.watchTargets ?? current.watchTargets,
    scanSets: patch.scanSets ?? current.scanSets,
  };
}

function applySettingsPatch(
  current: AppSettings | null,
  patch: Partial<AppSettings>
): AppSettings | null {
  if (!current) return current;
  return {
    ...current,
    ...patch,
    watchTargets: patch.watchTargets ?? current.watchTargets,
    scanSets: patch.scanSets ?? current.scanSets,
  };
}

function getDepCleanApi(): DepCleanApi | null {
  const api = (window as unknown as { depClean?: DepCleanApi }).depClean;
  return api ?? null;
}

interface StartupChoiceModalProps {
  busy: boolean;
  t: RendererTranslator;
  onEnableAutoStart: () => void;
  onDecideLater: () => void;
}

const StartupChoiceModal = memo(function StartupChoiceModal({
  busy,
  t,
  onEnableAutoStart,
  onDecideLater,
}: StartupChoiceModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{t('startup.title')}</h2>
        <p>{t('startup.description')}</p>
        <div className="modal-actions">
          <button className="btn primary" disabled={busy} onClick={onEnableAutoStart}>
            {t('startup.enableAutoStart')}
          </button>
          <button className="btn" disabled={busy} onClick={onDecideLater}>
            {t('startup.decideLater')}
          </button>
        </div>
      </div>
    </div>
  );
});

interface AlertsSectionProps {
  alerts: ThresholdAlert[];
  alertPage: number;
  alertPageCount: number;
  t: RendererTranslator;
  onMarkAllRead: () => void;
  onClearAlerts: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

const AlertsSection = memo(function AlertsSection({
  alerts,
  alertPage,
  alertPageCount,
  t,
  onMarkAllRead,
  onClearAlerts,
  onPreviousPage,
  onNextPage,
}: AlertsSectionProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{t('alerts.title')}</h2>
        <div className="button-row">
          <button className="btn" onClick={onMarkAllRead}>
            {t('alerts.markAllRead')}
          </button>
          <button className="btn danger" onClick={onClearAlerts}>
            {t('alerts.clearHistory')}
          </button>
        </div>
      </div>

      <div className="alert-list">
        {alerts.map((alert) => (
          <article key={alert.id} className={alert.read ? 'alert-card read' : 'alert-card'}>
            <header>
              <strong>
                {alert.status === 'exceeded'
                  ? t('alerts.status.exceeded')
                  : t('alerts.status.resolved')}
              </strong>
              <span>{alert.scope === 'global' ? t('alerts.scope.global') : alert.targetPath ?? alert.targetId}</span>
            </header>
            <p>
              {bytesToText(alert.currentBytes)} {t('alerts.thresholdLabel', { value: bytesToText(alert.thresholdBytes) })}
            </p>
            <time>{timestampText(alert.timestamp)}</time>
          </article>
        ))}
      </div>

      <div className="button-row">
        <button className="btn" disabled={alertPage <= 1} onClick={onPreviousPage}>
          {t('pagination.previous')}
        </button>
        <span className="muted">{t('pagination.pageOf', { current: alertPage, total: alertPageCount })}</span>
        <button className="btn" disabled={alertPage >= alertPageCount} onClick={onNextPage}>
          {t('pagination.next')}
        </button>
      </div>
    </section>
  );
});

interface CleanupPreviewModalProps {
  preview: CleanupPreview;
  busy: boolean;
  selectedDeletePaths: Set<string>;
  selectedPreviewSize: number;
  previewPage: number;
  previewPageCount: number;
  pagedPreviewDirectories: CleanupPreview['directories'];
  t: RendererTranslator;
  onSelectAll: () => void;
  onClearAll: () => void;
  onTogglePath: (dirPath: string, checked: boolean) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const CleanupPreviewModal = memo(function CleanupPreviewModal({
  preview,
  busy,
  selectedDeletePaths,
  selectedPreviewSize,
  previewPage,
  previewPageCount,
  pagedPreviewDirectories,
  t,
  onSelectAll,
  onClearAll,
  onTogglePath,
  onPreviousPage,
  onNextPage,
  onCancel,
  onConfirm,
}: CleanupPreviewModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{t('cleanup.title')}</h2>
        <p>{t('cleanup.previewCreatedAt', { value: timestampText(preview.createdAt) })}</p>
        <p>
          {t('cleanup.selectedSummary', {
            selected: selectedDeletePaths.size,
            total: preview.directories.length,
            size: bytesToText(selectedPreviewSize),
          })}
        </p>

        <div className="modal-actions">
          <button className="btn" onClick={onSelectAll}>
            {t('cleanup.selectAll')}
          </button>
          <button className="btn" onClick={onClearAll}>
            {t('cleanup.clearAll')}
          </button>
        </div>

        <div className="modal-list">
          {pagedPreviewDirectories.map((dir) => (
            <label key={dir.path}>
              <input
                type="checkbox"
                checked={selectedDeletePaths.has(dir.path)}
                onChange={(event) => onTogglePath(dir.path, event.target.checked)}
              />
              <code>{dir.path}</code>
              <span>{bytesToText(dir.size)}</span>
            </label>
          ))}
        </div>

        <div className="button-row">
          <button className="btn" disabled={previewPage <= 1} onClick={onPreviousPage}>
            {t('pagination.previous')}
          </button>
          <span className="muted">{t('pagination.pageOf', { current: previewPage, total: previewPageCount })}</span>
          <button className="btn" disabled={previewPage >= previewPageCount} onClick={onNextPage}>
            {t('pagination.next')}
          </button>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            {t('cleanup.cancel')}
          </button>
          <button className="btn danger" disabled={selectedDeletePaths.size === 0 || busy} onClick={onConfirm}>
            {t('cleanup.confirmDeleteSelected')}
          </button>
        </div>
      </div>
    </div>
  );
});

export default function App() {
  const locale = useMemo(() => normalizeSupportedLocale(navigator.language), []);
  const t = useMemo(() => createRendererTranslator(locale), [locale]);

  const tabLabels = useMemo(
    () => [
      { key: 'dashboard' as const, label: t('tab.dashboard') },
      { key: 'scanSets' as const, label: t('tab.scanSets') },
      { key: 'settings' as const, label: t('tab.settings') },
      { key: 'alerts' as const, label: t('tab.alerts') },
    ],
    [t]
  );

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [watchStatus, setWatchStatus] = useState<WatchStatus | null>(null);
  const [alerts, setAlerts] = useState<ThresholdAlert[]>([]);
  const [lastScan, setLastScan] = useState<AppScanResult | null>(null);
  const [lastOutcome, setLastOutcome] = useState<ScanExecutionOutcome | null>(null);
  const [progress, setProgress] = useState<ScanProgressEvent | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string>('');
  const [newSetName, setNewSetName] = useState('');
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [selectedDeletePaths, setSelectedDeletePaths] = useState<Set<string>>(new Set<string>());
  const [showStartupChoiceModal, setShowStartupChoiceModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [alertPage, setAlertPage] = useState(1);
  const [previewPage, setPreviewPage] = useState(1);

  const settingsCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsPatchRef = useRef<Partial<AppSettings>>({});

  const selectedSet = useMemo(
    () => settings?.scanSets.find((scanSet) => scanSet.id === selectedSetId) ?? null,
    [settings?.scanSets, selectedSetId]
  );

  const selectedPreviewSize = useMemo(() => {
    if (!preview) return 0;
    return preview.directories
      .filter((dir) => selectedDeletePaths.has(dir.path))
      .reduce((sum, dir) => sum + dir.size, 0);
  }, [preview, selectedDeletePaths]);

  const alertPageCount = useMemo(() => Math.max(1, Math.ceil(alerts.length / ALERT_PAGE_SIZE)), [alerts.length]);

  const pagedAlerts = useMemo(() => {
    const alertPageStart = (alertPage - 1) * ALERT_PAGE_SIZE;
    return alerts.slice(alertPageStart, alertPageStart + ALERT_PAGE_SIZE);
  }, [alertPage, alerts]);

  const previewPageCount = useMemo(() => {
    if (!preview) return 1;
    return Math.max(1, Math.ceil(preview.directories.length / PREVIEW_PAGE_SIZE));
  }, [preview]);

  const pagedPreviewDirectories = useMemo(() => {
    if (!preview) return [];
    const previewPageStart = (previewPage - 1) * PREVIEW_PAGE_SIZE;
    return preview.directories.slice(previewPageStart, previewPageStart + PREVIEW_PAGE_SIZE);
  }, [preview, previewPage]);

  function clearPendingSettingsTimer(): void {
    if (!settingsCommitTimerRef.current) return;
    clearTimeout(settingsCommitTimerRef.current);
    settingsCommitTimerRef.current = null;
  }

  async function commitSettings(
    patch: Partial<AppSettings>,
    options?: { withBusy?: boolean; successMessage?: string }
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;

    const withBusy = options?.withBusy ?? false;

    try {
      if (withBusy) setBusy(true);
      const next = await window.depClean.settings.update(patch);
      setSettings(next);
      if (options?.successMessage) {
        setMessage(options.successMessage);
      }
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (withBusy) setBusy(false);
    }
  }

  async function flushPendingSettings(options?: { withBusy?: boolean; successMessage?: string }): Promise<void> {
    clearPendingSettingsTimer();
    const patch = pendingSettingsPatchRef.current;
    pendingSettingsPatchRef.current = {};
    await commitSettings(patch, options);
  }

  function queueSettingsUpdate(partial: Partial<AppSettings>): void {
    setSettings((current) => applySettingsPatch(current, partial));
    pendingSettingsPatchRef.current = mergeSettingsPatch(pendingSettingsPatchRef.current, partial);
    clearPendingSettingsTimer();
    settingsCommitTimerRef.current = setTimeout(() => {
      void flushPendingSettings();
    }, SETTINGS_COMMIT_DEBOUNCE_MS);
  }

  async function updateSettingsNow(
    partial: Partial<AppSettings>,
    successMessage = t('settings.saved')
  ): Promise<void> {
    await flushPendingSettings();
    await commitSettings(partial, { withBusy: true, successMessage });
  }

  async function bootstrap(api: DepCleanApi) {
    try {
      const [nextSettings, nextStatus, nextAlerts, nextScan] = await Promise.all([
        api.settings.get(),
        api.watch.status(),
        api.alerts.list({ limit: ALERT_HISTORY_MAX }),
        api.scan.getLastResult(),
      ]);

      setSettings(nextSettings);
      setWatchStatus(nextStatus);
      setAlerts(nextAlerts);
      setLastScan(nextScan);
      setShowStartupChoiceModal(!nextSettings.startupChoiceCompleted);

      if (nextSettings.scanSets.length > 0) {
        setSelectedSetId(nextSettings.scanSets[0].id);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const api = getDepCleanApi();
    if (!api) {
      setErrorMessage(t('error.ipcUnavailable'));
      return () => {
        clearPendingSettingsTimer();
      };
    }

    void bootstrap(api);

    const unsubscribeProgress = api.scan.onProgress((event) => {
      setProgress(event);
    });

    const unsubscribeCompleted = api.scan.onCompleted((outcome) => {
      setProgress(null);
      setLastOutcome(outcome);
      setLastScan(outcome.scanResult);
    });

    const unsubscribeStatus = api.watch.onStatusChanged((status) => {
      setWatchStatus(status);
    });

    const unsubscribeAlerts = api.alerts.onCreated((created) => {
      setAlerts((prev) => [...created, ...prev].slice(0, ALERT_HISTORY_MAX));
      setAlertPage(1);
    });

    return () => {
      unsubscribeProgress();
      unsubscribeCompleted();
      unsubscribeStatus();
      unsubscribeAlerts();
      clearPendingSettingsTimer();
    };
  }, [t]);

  useEffect(() => {
    setAlertPage((current) => Math.min(current, alertPageCount));
  }, [alertPageCount]);

  useEffect(() => {
    setPreviewPage(1);
  }, [preview?.approvalId]);

  useEffect(() => {
    setPreviewPage((current) => Math.min(current, previewPageCount));
  }, [previewPageCount]);

  async function updateSettings(partial: Partial<AppSettings>) {
    await updateSettingsNow(partial);
  }

  async function runManualScan(paths?: string[]) {
    try {
      await flushPendingSettings();
      setBusy(true);
      const outcome = await window.depClean.scan.runManual(paths);
      setLastOutcome(outcome);
      setLastScan(outcome.scanResult);
      const nextAlerts = await window.depClean.alerts.list({ limit: ALERT_HISTORY_MAX });
      setAlerts(nextAlerts);
      setMessage(
        t('message.scanComplete', {
          count: outcome.scanResult.directoryCount,
          size: bytesToText(outcome.scanResult.totalSize),
        })
      );
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runSelectedSet(setId?: string) {
    const targetSet = setId
      ? settings?.scanSets.find((scanSet) => scanSet.id === setId) ?? null
      : selectedSet;
    if (!targetSet) return;

    try {
      await flushPendingSettings();
      setBusy(true);
      const outcome = await window.depClean.scan.runSet(targetSet.id);
      setLastOutcome(outcome);
      setLastScan(outcome.scanResult);
      const nextAlerts = await window.depClean.alerts.list({ limit: ALERT_HISTORY_MAX });
      setAlerts(nextAlerts);
      setMessage(t('message.scanSetComplete', { name: targetSet.name }));
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function startWatch() {
    try {
      await flushPendingSettings();
      setBusy(true);
      const status = await window.depClean.watch.start();
      setWatchStatus(status);
      setMessage(t('message.monitorStarted'));
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopWatch() {
    try {
      await flushPendingSettings();
      setBusy(true);
      const status = await window.depClean.watch.stop();
      setWatchStatus(status);
      setMessage(t('message.monitorStopped'));
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addWatchTargets() {
    if (!settings) return;

    const picked = await window.depClean.folders.pickMany();
    if (picked.length === 0) return;

    const existing = new Set(settings.watchTargets.map((target) => target.path));
    const additions = picked.filter((item) => !existing.has(item)).map((item) => createTarget(item));

    if (additions.length === 0) {
      setMessage(t('message.noNewFolders'));
      return;
    }

    await updateSettings({
      watchTargets: [...settings.watchTargets, ...additions],
    });
  }

  function patchWatchTarget(
    targetId: string,
    patch: Partial<WatchTarget>,
    mode: 'immediate' | 'debounced' = 'immediate'
  ) {
    if (!settings) return;
    const nextTargets = settings.watchTargets.map((target) => {
      if (target.id !== targetId) return target;
      return { ...target, ...patch };
    });
    if (mode === 'debounced') {
      queueSettingsUpdate({ watchTargets: nextTargets });
      return;
    }
    void updateSettings({ watchTargets: nextTargets });
  }

  function removeWatchTarget(targetId: string) {
    if (!settings) return;
    const nextTargets = settings.watchTargets.filter((target) => target.id !== targetId);
    void updateSettings({ watchTargets: nextTargets });
  }

  async function createScanSet() {
    if (!settings) return;
    const picked = await window.depClean.folders.pickMany();
    if (picked.length === 0) return;

    const now = new Date().toISOString();
    const scanSet: ScanSet = {
      id: crypto.randomUUID(),
      name: newSetName.trim() || buildSetName(picked, t),
      paths: [...new Set(picked)],
      createdAt: now,
      updatedAt: now,
    };

    const nextSets = [...settings.scanSets, scanSet];
    await updateSettings({ scanSets: nextSets });

    setNewSetName('');
    setSelectedSetId(scanSet.id);
  }

  function deleteScanSet(setId: string) {
    if (!settings) return;
    const nextSets = settings.scanSets.filter((scanSet) => scanSet.id !== setId);
    void updateSettings({ scanSets: nextSets });

    if (selectedSetId === setId) {
      setSelectedSetId(nextSets[0]?.id ?? '');
    }
  }

  async function openCleanupPreview(paths?: string[]) {
    try {
      await flushPendingSettings();
      setBusy(true);
      const nextPreview = await window.depClean.cleanup.preview(paths ?? selectedSet?.paths);
      setPreview(nextPreview);
      setSelectedDeletePaths(new Set(nextPreview.directories.map((dir) => dir.path)));
      setMessage(t('message.cleanupPreviewGenerated'));
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCleanup() {
    if (!preview) return;

    try {
      setBusy(true);
      const result = await window.depClean.cleanup.confirmDelete(
        preview.approvalId,
        Array.from(selectedDeletePaths)
      );
      setPreview(null);
      setSelectedDeletePaths(new Set());
      setMessage(
        t('message.cleanupComplete', {
          count: result.deletedCount,
          size: bytesToText(result.freedSize),
        })
      );

      if (result.failures.length > 0) {
        setErrorMessage(t('error.someDeletesFailed', { count: result.failures.length }));
      } else {
        setErrorMessage('');
      }

      await runManualScan(selectedSet?.paths);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function markAllAlertsRead() {
    const unreadIds = alerts.filter((alert) => !alert.read).map((alert) => alert.id);
    if (unreadIds.length === 0) return;
    const next = await window.depClean.alerts.markRead(unreadIds);
    setAlerts(next.slice(0, ALERT_HISTORY_MAX));
  }

  async function clearAlerts() {
    await window.depClean.alerts.clear();
    setAlerts([]);
    setAlertPage(1);
  }

  async function completeStartupChoice(enableAutoStart: boolean) {
    const successMessage = enableAutoStart
      ? t('message.startupAutoStartEnabled')
      : t('message.startupAutoStartDisabled');

    await updateSettingsNow(
      {
        autoStart: enableAutoStart,
        startupChoiceCompleted: true,
        runInTray: true,
      },
      successMessage
    );

    setShowStartupChoiceModal(false);
  }
  if (!settings || !watchStatus) {
    return (
      <div className="loading">
        <div>
          <p>{t('loading.initializing')}</p>
          {errorMessage && <p className="error-text">{errorMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-header">
        <div>
          <p className="eyebrow">{t('header.eyebrow')}</p>
          <h1>{t('header.title')}</h1>
          <p className="subtitle">{t('header.subtitle')}</p>
        </div>
        <div className="status-pills">
          <span className={`pill ${watchStatus.running ? 'ok' : 'idle'}`}>
            {watchStatus.running ? t('header.monitoringOn') : t('header.monitoringOff')}
          </span>
          <span className="pill neutral">{t('header.watchers', { count: watchStatus.watcherCount })}</span>
        </div>
      </header>

      <nav className="tabs">
        {tabLabels.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? 'tab active' : 'tab'}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="content-grid">
        {activeTab === 'dashboard' && (
          <section className="panel">
            <div className="panel-header">
              <h2>{t('dashboard.runControls')}</h2>
              <div className="button-row">
                <button className="btn primary" disabled={busy} onClick={() => void runManualScan()}>
                  {t('dashboard.manualScan')}
                </button>
                <button className="btn" disabled={busy || !selectedSet} onClick={() => void runSelectedSet()}>
                  {t('dashboard.runScanSet')}
                </button>
                <button className="btn" disabled={busy} onClick={() => void openCleanupPreview()}>
                  {t('dashboard.buildCleanupApproval')}
                </button>
                <button className="btn" disabled={busy || watchStatus.running} onClick={() => void startWatch()}>
                  {t('dashboard.startMonitor')}
                </button>
                <button className="btn danger" disabled={busy || !watchStatus.running} onClick={() => void stopWatch()}>
                  {t('dashboard.stopMonitor')}
                </button>
              </div>
            </div>

            <div className="metrics-row">
              <article className="metric-card">
                <h3>{t('dashboard.latestTotalSize')}</h3>
                <p>{bytesToText(lastScan?.totalSize ?? 0)}</p>
              </article>
              <article className="metric-card">
                <h3>{t('dashboard.latestDirectoryCount')}</h3>
                <p>{lastScan?.directoryCount ?? 0}</p>
              </article>
              <article className="metric-card">
                <h3>{t('dashboard.nextPeriodicRun')}</h3>
                <p>{watchStatus.nextRunAt ? timestampText(watchStatus.nextRunAt) : t('dashboard.disabled')}</p>
              </article>
            </div>

            {progress && (
              <div className="inline-note">
                {t('dashboard.scanProgress', {
                  current: progress.current,
                  total: progress.total,
                  path: progress.targetPath,
                })}
              </div>
            )}

            {lastOutcome && lastOutcome.alerts.length > 0 && (
              <div className="inline-note warning">
                {t('dashboard.lastScanAlertCount', { count: lastOutcome.alerts.length })}
              </div>
            )}

            <div className="scan-results">
              {(lastScan?.targets ?? []).map((target) => (
                <article key={target.targetId} className="result-card">
                  <header>
                    <h3>{target.targetPath}</h3>
                    <span>{bytesToText(target.totalSize)}</span>
                  </header>
                  <ul>
                    {target.directories.slice(0, 8).map((dir) => (
                      <li key={dir.path}>
                        <code>{dir.relativePath}</code>
                        <span>{bytesToText(dir.size)}</span>
                      </li>
                    ))}
                  </ul>
                  {target.directories.length > 8 && (
                    <p className="muted">
                      {t('dashboard.moreDirectories', { count: target.directories.length - 8 })}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'scanSets' && (
          <section className="panel">
            <div className="panel-header">
              <h2>{t('scanSets.title')}</h2>
            </div>

            <div className="inline-form">
              <input
                placeholder={t('scanSets.newSetPlaceholder')}
                value={newSetName}
                onChange={(event) => setNewSetName(event.target.value)}
              />
              <button className="btn primary" disabled={busy} onClick={() => void createScanSet()}>
                {t('scanSets.pickFoldersSave')}
              </button>
            </div>

            <div className="set-list">
              {settings.scanSets.map((scanSet) => (
                <article key={scanSet.id} className={selectedSetId === scanSet.id ? 'set-card active' : 'set-card'}>
                  <header>
                    <label>
                      <input
                        type="radio"
                        checked={selectedSetId === scanSet.id}
                        onChange={() => setSelectedSetId(scanSet.id)}
                      />
                      <strong>{scanSet.name}</strong>
                    </label>
                    <span>{t('scanSets.folderCount', { count: scanSet.paths.length })}</span>
                  </header>
                  <ul>
                    {scanSet.paths.map((targetPath) => (
                      <li key={targetPath}>
                        <code>{targetPath}</code>
                      </li>
                    ))}
                  </ul>
                  <div className="button-row">
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        setSelectedSetId(scanSet.id);
                        void runSelectedSet(scanSet.id);
                      }}
                    >
                      {t('scanSets.runSet')}
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        setSelectedSetId(scanSet.id);
                        void openCleanupPreview(scanSet.paths);
                      }}
                    >
                      {t('scanSets.buildCleanup')}
                    </button>
                    <button className="btn danger" disabled={busy} onClick={() => deleteScanSet(scanSet.id)}>
                      {t('scanSets.deleteSet')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'settings' && (
          <section className="panel">
            <div className="panel-header">
              <h2>{t('settings.title')}</h2>
            </div>

            <div className="settings-grid">
              <label>
                <span>{t('settings.autoStartOnLogin')}</span>
                <input
                  type="checkbox"
                  checked={settings.autoStart}
                  onChange={(event) => void updateSettings({ autoStart: event.target.checked })}
                />
              </label>

              <label>
                <span>{t('settings.enablePeriodicScans')}</span>
                <input
                  type="checkbox"
                  checked={settings.periodicEnabled}
                  onChange={(event) => void updateSettings({ periodicEnabled: event.target.checked })}
                />
              </label>

              <label>
                <span>{t('settings.enableRealtimeWatch')}</span>
                <input
                  type="checkbox"
                  checked={settings.realtimeEnabled}
                  onChange={(event) => void updateSettings({ realtimeEnabled: event.target.checked })}
                />
              </label>

              <label>
                <span>{t('settings.periodicIntervalMin')}</span>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={settings.periodicMinutes}
                  onChange={(event) =>
                    queueSettingsUpdate({ periodicMinutes: Number.parseInt(event.target.value || '60', 10) })
                  }
                  onBlur={() => void flushPendingSettings()}
                />
              </label>

              <label>
                <span>{t('settings.globalThresholdMb')}</span>
                <input
                  type="number"
                  min={0}
                  value={bytesToMbInput(settings.globalThresholdBytes)}
                  onChange={(event) =>
                    queueSettingsUpdate({
                      globalThresholdBytes: mbInputToBytes(Number.parseInt(event.target.value || '0', 10)),
                    })
                  }
                  onBlur={() => void flushPendingSettings()}
                />
              </label>

              <label>
                <span>{t('settings.alertCooldownMin')}</span>
                <input
                  type="number"
                  min={0}
                  value={settings.alertCooldownMinutes}
                  onChange={(event) =>
                    queueSettingsUpdate({ alertCooldownMinutes: Number.parseInt(event.target.value || '0', 10) })
                  }
                  onBlur={() => void flushPendingSettings()}
                />
              </label>
            </div>

            <div className="inline-note">{t('settings.trayPolicyNote')}</div>

            <div className="panel-header">
              <h2>{t('settings.watchTargets')}</h2>
              <button className="btn primary" disabled={busy} onClick={() => void addWatchTargets()}>
                {t('settings.addFolders')}
              </button>
            </div>

            <div className="target-list">
              {settings.watchTargets.map((target) => (
                <article key={target.id} className="target-card">
                  <div className="target-top">
                    <label>
                      <input
                        type="checkbox"
                        checked={target.enabled}
                        onChange={(event) => patchWatchTarget(target.id, { enabled: event.target.checked })}
                      />
                      <code>{target.path}</code>
                    </label>
                    <button className="btn danger" onClick={() => removeWatchTarget(target.id)}>
                      {t('settings.remove')}
                    </button>
                  </div>
                  <div className="target-fields">
                    <label>
                      {t('settings.targetThresholdMb')}
                      <input
                        type="number"
                        min={0}
                        value={target.targetThresholdBytes ? bytesToMbInput(target.targetThresholdBytes) : 0}
                        onChange={(event) => {
                          const numeric = Number.parseInt(event.target.value || '0', 10);
                          patchWatchTarget(
                            target.id,
                            {
                              targetThresholdBytes: numeric > 0 ? mbInputToBytes(numeric) : undefined,
                            },
                            'debounced'
                          );
                        }}
                        onBlur={() => void flushPendingSettings()}
                      />
                    </label>

                    <label>
                      {t('settings.onlyComma')}
                      <input
                        type="text"
                        value={target.only?.join(',') ?? ''}
                        onChange={(event) => {
                          const only = event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean);
                          patchWatchTarget(target.id, { only: only.length > 0 ? only : undefined }, 'debounced');
                        }}
                        onBlur={() => void flushPendingSettings()}
                      />
                    </label>

                    <label>
                      {t('settings.excludeComma')}
                      <input
                        type="text"
                        value={target.exclude?.join(',') ?? ''}
                        onChange={(event) => {
                          const exclude = event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean);
                          patchWatchTarget(
                            target.id,
                            {
                              exclude: exclude.length > 0 ? exclude : undefined,
                            },
                            'debounced'
                          );
                        }}
                        onBlur={() => void flushPendingSettings()}
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'alerts' && (
          <AlertsSection
            alerts={pagedAlerts}
            alertPage={alertPage}
            alertPageCount={alertPageCount}
            t={t}
            onMarkAllRead={() => void markAllAlertsRead()}
            onClearAlerts={() => void clearAlerts()}
            onPreviousPage={() => setAlertPage((page) => page - 1)}
            onNextPage={() => setAlertPage((page) => page + 1)}
          />
        )}
      </main>

      {(message || errorMessage) && (
        <footer className="status-bar">
          {message && <p className="ok-text">{message}</p>}
          {errorMessage && <p className="error-text">{errorMessage}</p>}
        </footer>
      )}

      {showStartupChoiceModal && (
        <StartupChoiceModal
          busy={busy}
          t={t}
          onEnableAutoStart={() => void completeStartupChoice(true)}
          onDecideLater={() => void completeStartupChoice(false)}
        />
      )}

      {preview && (
        <CleanupPreviewModal
          preview={preview}
          busy={busy}
          selectedDeletePaths={selectedDeletePaths}
          selectedPreviewSize={selectedPreviewSize}
          previewPage={previewPage}
          previewPageCount={previewPageCount}
          pagedPreviewDirectories={pagedPreviewDirectories}
          t={t}
          onSelectAll={() => setSelectedDeletePaths(new Set(preview.directories.map((dir) => dir.path)))}
          onClearAll={() => setSelectedDeletePaths(new Set())}
          onTogglePath={(dirPath, checked) => {
            setSelectedDeletePaths((current) => {
              const next = new Set(current);
              if (checked) {
                next.add(dirPath);
              } else {
                next.delete(dirPath);
              }
              return next;
            });
          }}
          onPreviousPage={() => setPreviewPage((page) => page - 1)}
          onNextPage={() => setPreviewPage((page) => page + 1)}
          onCancel={() => setPreview(null)}
          onConfirm={() => void confirmCleanup()}
        />
      )}
    </div>
  );
}
