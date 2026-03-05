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

/* ─── Utility Functions ─────────────────────────────────────── */
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

/* ─── SVG Icons ──────────────────────────────────────────────── */
const IconDashboard = () => (
  <svg className="nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="7" height="7" rx="1.5" />
    <rect x="10" y="1" width="7" height="7" rx="1.5" />
    <rect x="1" y="10" width="7" height="7" rx="1.5" />
    <rect x="10" y="10" width="7" height="7" rx="1.5" />
  </svg>
);
const IconScanSets = () => (
  <svg className="nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2v4M9 12v4M2 9h4M12 9h4" />
    <circle cx="9" cy="9" r="3" />
  </svg>
);
const IconSettings = () => (
  <svg className="nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="9" r="2.5" />
    <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.3 3.3l1.4 1.4M13.3 13.3l1.4 1.4M3.3 14.7l1.4-1.4M13.3 4.7l1.4-1.4" />
  </svg>
);
const IconAlerts = () => (
  <svg className="nav-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 1.5L2 13.5h14L9 1.5z" />
    <path d="M9 7v3M9 12.5v.5" />
  </svg>
);
const IconFolder = () => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 4.5A1.5 1.5 0 012.5 3h4l1.5 2H15.5A1.5 1.5 0 0117 6.5v7A1.5 1.5 0 0115.5 15h-13A1.5 1.5 0 011 13.5v-9z" />
  </svg>
);
const IconSize = () => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="9" r="7" />
    <path d="M6 9h6M9 6v6" />
  </svg>
);
const IconClock = () => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="9" r="7" />
    <path d="M9 5v4l2.5 2.5" />
  </svg>
);
const IconEmpty = () => (
  <svg className="empty-state-icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="10" width="28" height="24" rx="3" />
    <path d="M6 16h28M14 10V6M26 10V6" />
    <path d="M14 24l4 4 8-8" opacity="0.5" />
  </svg>
);

/* ─── Toggle Switch Component ────────────────────────────────── */
interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const ToggleRow = memo(function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="toggle-row">
      <div className="toggle-label-group">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-description">{description}</span>}
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" />
      </label>
    </div>
  );
});

/* ─── Startup Choice Modal ───────────────────────────────────── */
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

/* ─── Alerts Section ─────────────────────────────────────────── */
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
        <h2 className="panel-title">{t('alerts.title')}</h2>
        <div className="button-row">
          <button className="btn" onClick={onMarkAllRead}>
            {t('alerts.markAllRead')}
          </button>
          <button className="btn danger" onClick={onClearAlerts}>
            {t('alerts.clearHistory')}
          </button>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="empty-state">
          <IconEmpty />
          <p>{t('alerts.empty')}</p>
        </div>
      ) : (
        <div className="alert-list">
          {alerts.map((alert) => (
            <article
              key={alert.id}
              className={`alert-card ${alert.status} ${alert.read ? 'read' : ''}`}
            >
              <div className="alert-card-header">
                <span className={`alert-badge ${alert.status}`}>
                  {alert.status === 'exceeded'
                    ? t('alerts.status.exceeded')
                    : t('alerts.status.resolved')}
                </span>
                <span className="alert-scope">
                  {alert.scope === 'global' ? t('alerts.scope.global') : (alert.targetPath ?? alert.targetId)}
                </span>
              </div>
              <p className="alert-detail">
                {bytesToText(alert.currentBytes)} {t('alerts.thresholdLabel', { value: bytesToText(alert.thresholdBytes) })}
              </p>
              <time className="alert-time">{timestampText(alert.timestamp)}</time>
            </article>
          ))}
        </div>
      )}

      {alertPageCount > 1 && (
        <div className="pagination-row">
          <button className="btn" disabled={alertPage <= 1} onClick={onPreviousPage}>
            {t('pagination.previous')}
          </button>
          <span className="pagination-label">{t('pagination.pageOf', { current: alertPage, total: alertPageCount })}</span>
          <button className="btn" disabled={alertPage >= alertPageCount} onClick={onNextPage}>
            {t('pagination.next')}
          </button>
        </div>
      )}
    </section>
  );
});

/* ─── Cleanup Preview Modal ──────────────────────────────────── */
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
        <p>{t('cleanup.previewExpiresAt', { value: timestampText(preview.expiresAt) })}</p>

        <div className="modal-summary">
          {t('cleanup.selectedSummary', {
            selected: selectedDeletePaths.size,
            total: preview.directories.length,
            size: bytesToText(selectedPreviewSize),
          })}
        </div>

        <div className="modal-actions">
          <button className="btn" disabled={busy} onClick={onSelectAll}>
            {t('cleanup.selectAll')}
          </button>
          <button className="btn" disabled={busy} onClick={onClearAll}>
            {t('cleanup.clearAll')}
          </button>
        </div>

        <div className="modal-list">
          {pagedPreviewDirectories.map((dir) => (
            <label key={dir.path}>
              <input
                type="checkbox"
                checked={selectedDeletePaths.has(dir.path)}
                disabled={busy}
                onChange={(event) => onTogglePath(dir.path, event.target.checked)}
              />
              <code>{dir.path}</code>
              <span>{bytesToText(dir.size)}</span>
            </label>
          ))}
        </div>

        {previewPageCount > 1 && (
          <div className="pagination-row">
            <button className="btn" disabled={previewPage <= 1} onClick={onPreviousPage}>
              {t('pagination.previous')}
            </button>
            <span className="pagination-label">{t('pagination.pageOf', { current: previewPage, total: previewPageCount })}</span>
            <button className="btn" disabled={previewPage >= previewPageCount} onClick={onNextPage}>
              {t('pagination.next')}
            </button>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" disabled={busy} onClick={onCancel}>
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

/* ─── Main App ───────────────────────────────────────────────── */
export default function App() {
  const locale = useMemo(() => normalizeSupportedLocale(navigator.language), []);
  const t = useMemo(() => createRendererTranslator(locale), [locale]);

  const NAV_ITEMS: { key: TabKey; label: string; Icon: () => JSX.Element }[] = useMemo(
    () => [
      { key: 'dashboard', label: t('tab.dashboard'), Icon: IconDashboard },
      { key: 'scanSets', label: t('tab.scanSets'), Icon: IconScanSets },
      { key: 'settings', label: t('tab.settings'), Icon: IconSettings },
      { key: 'alerts', label: t('tab.alerts'), Icon: IconAlerts },
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
      if (options?.successMessage) setMessage(options.successMessage);
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
      return () => { clearPendingSettingsTimer(); };
    }
    void bootstrap(api);
    const unsubscribeProgress = api.scan.onProgress((event) => { setProgress(event); });
    const unsubscribeCompleted = api.scan.onCompleted((outcome) => {
      setProgress(null);
      setLastOutcome(outcome);
      setLastScan(outcome.scanResult);
    });
    const unsubscribeStatus = api.watch.onStatusChanged((status) => { setWatchStatus(status); });
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

  useEffect(() => { setPreviewPage(1); }, [preview?.approvalId]);
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
      setMessage(t('message.scanComplete', {
        count: outcome.scanResult.directoryCount,
        size: bytesToText(outcome.scanResult.totalSize),
      }));
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
    if (additions.length === 0) { setMessage(t('message.noNewFolders')); return; }
    await updateSettings({ watchTargets: [...settings.watchTargets, ...additions] });
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
    if (mode === 'debounced') { queueSettingsUpdate({ watchTargets: nextTargets }); return; }
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
    if (selectedSetId === setId) setSelectedSetId(nextSets[0]?.id ?? '');
  }

  async function openCleanupPreview(paths?: string[]) {
    try {
      await flushPendingSettings();
      setBusy(true);
      if (preview) {
        await window.depClean.cleanup.cancel(preview.approvalId);
      }
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

  async function cancelCleanupPreview() {
    if (!preview) return;
    try {
      setBusy(true);
      await window.depClean.cleanup.cancel(preview.approvalId);
      setPreview(null);
      setSelectedDeletePaths(new Set());
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
      setMessage(t('message.cleanupComplete', {
        count: result.deletedCount,
        size: bytesToText(result.freedSize),
      }));

      if (result.retryPreview) {
        setPreview(result.retryPreview);
        setSelectedDeletePaths(new Set(result.retryPreview.directories.map((dir) => dir.path)));
        setErrorMessage(t('message.cleanupRetryPending', { count: result.failures.length }));
      } else {
        setPreview(null);
        setSelectedDeletePaths(new Set());
      }

      if (result.failures.length > 0 && !result.retryPreview) {
        setErrorMessage(t('error.someDeletesFailed', { count: result.failures.length }));
      } else if (result.failures.length === 0) {
        setErrorMessage('');
      }
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
    await updateSettingsNow({ autoStart: enableAutoStart, startupChoiceCompleted: true, runInTray: true }, successMessage);
    setShowStartupChoiceModal(false);
  }

  /* ─── Loading State ─────────────────────────────────────────── */
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

  const isMonitoring = watchStatus.running;
  const unreadCount = alerts.filter((a) => !a.read).length;

  /* ─── Progress percentage ─────────────────────────────────── */
  const progressPct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="app-shell">
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <p className="sidebar-eyebrow">{t('header.eyebrow')}</p>
          <h1 className="sidebar-title">{t('header.title')}</h1>
          <p className="sidebar-subtitle">{t('header.subtitle')}</p>
        </div>

        <div className="sidebar-status">
          <span className={`pill ${isMonitoring ? 'ok' : 'idle'}`}>
            {isMonitoring ? t('header.monitoringOn') : t('header.monitoringOff')}
          </span>
          {watchStatus.watcherCount > 0 && (
            <span className="pill neutral">{t('header.watchers', { count: watchStatus.watcherCount })}</span>
          )}
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`nav-item ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              <Icon />
              <span>{label}</span>
              {key === 'alerts' && unreadCount > 0 && (
                <span className="tag" style={{ marginLeft: 'auto', fontSize: '0.68rem' }}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          dep-clean-gui
        </div>
      </aside>

      {/* ── Main Area ─────────────────────────────────────────── */}
      <div className="main-area">
        {/* Status Banner */}
        {(message || errorMessage) && (
          <div className={`status-banner ${errorMessage ? 'has-error' : 'has-ok'}`}>
            {message && <p className="ok-text">{message}</p>}
            {errorMessage && <p className="error-text">{errorMessage}</p>}
          </div>
        )}

        <div className="main-content">
          {/* ── Dashboard Tab ───────────────────────────────── */}
          {activeTab === 'dashboard' && (
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">{t('tab.dashboard')}</h2>
              </div>

              {/* Metrics */}
              <div className="metrics-row">
                <article className="metric-card">
                  <div className="metric-icon"><IconSize /></div>
                  <div className="metric-label">{t('dashboard.latestTotalSize')}</div>
                  <div className="metric-value">{bytesToText(lastScan?.totalSize ?? 0)}</div>
                </article>
                <article className="metric-card">
                  <div className="metric-icon"><IconFolder /></div>
                  <div className="metric-label">{t('dashboard.latestDirectoryCount')}</div>
                  <div className="metric-value">{lastScan?.directoryCount ?? 0}</div>
                </article>
                <article className="metric-card">
                  <div className="metric-icon"><IconClock /></div>
                  <div className="metric-label">{t('dashboard.nextPeriodicRun')}</div>
                  <div className="metric-value" style={{ fontSize: '0.9rem' }}>
                    {watchStatus.nextRunAt ? timestampText(watchStatus.nextRunAt) : t('dashboard.disabled')}
                  </div>
                </article>
              </div>

              <div className="panel-divider" />

              {/* Scan Section */}
              <div className="section-block">
                <div className="section-block-title">{t('dashboard.runControls')}</div>
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
                </div>
              </div>

              {/* Monitor Section */}
              <div className="section-block">
                <div className="section-block-title">{t('dashboard.monitorSectionTitle')}</div>
                <div className="button-row">
                  <button className="btn primary" disabled={busy || isMonitoring} onClick={() => void startWatch()}>
                    {t('dashboard.startMonitor')}
                  </button>
                  <button className="btn danger" disabled={busy || !isMonitoring} onClick={() => void stopWatch()}>
                    {t('dashboard.stopMonitor')}
                  </button>
                </div>
              </div>

              {/* Progress */}
              {progress && (
                <div className="inline-note">
                  <div style={{ marginBottom: 6 }}>
                    {t('dashboard.scanProgress', {
                      current: progress.current,
                      total: progress.total,
                      path: progress.targetPath,
                    })}
                  </div>
                  <div className="progress-bar-wrap">
                    <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}

              {lastOutcome && lastOutcome.alerts.length > 0 && (
                <div className="inline-note warning">
                  {t('dashboard.lastScanAlertCount', { count: lastOutcome.alerts.length })}
                </div>
              )}

              {/* Scan Results */}
              {(lastScan?.targets ?? []).length > 0 && (
                <>
                  <div className="panel-divider" />
                  <div className="scan-results">
                    {(lastScan?.targets ?? []).map((target) => (
                      <article key={target.targetId} className="result-card">
                        <div className="result-card-header">
                          <h3 className="result-card-path">{target.targetPath}</h3>
                          <span className="result-card-size">{bytesToText(target.totalSize)}</span>
                        </div>
                        <ul>
                          {target.directories.slice(0, 8).map((dir) => (
                            <li key={dir.path}>
                              <code>{dir.relativePath}</code>
                              <span>{bytesToText(dir.size)}</span>
                            </li>
                          ))}
                        </ul>
                        {target.directories.length > 8 && (
                          <p className="more-label">
                            {t('dashboard.moreDirectories', { count: target.directories.length - 8 })}
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {/* ── Scan Sets Tab ────────────────────────────────── */}
          {activeTab === 'scanSets' && (
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">{t('scanSets.title')}</h2>
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

              {settings.scanSets.length === 0 ? (
                <div className="empty-state">
                  <IconEmpty />
                  <p>{t('scanSets.empty')}</p>
                </div>
              ) : (
                <div className="set-list">
                  {settings.scanSets.map((scanSet) => (
                    <article key={scanSet.id} className={selectedSetId === scanSet.id ? 'set-card active' : 'set-card'}>
                      <div className="set-card-header">
                        <label>
                          <input
                            type="radio"
                            checked={selectedSetId === scanSet.id}
                            onChange={() => setSelectedSetId(scanSet.id)}
                          />
                          <strong>{scanSet.name}</strong>
                        </label>
                        <span className="tag">{t('scanSets.folderCount', { count: scanSet.paths.length })}</span>
                      </div>
                      <ul>
                        {scanSet.paths.map((targetPath) => (
                          <li key={targetPath}><code>{targetPath}</code></li>
                        ))}
                      </ul>
                      <div className="button-row">
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => { setSelectedSetId(scanSet.id); void runSelectedSet(scanSet.id); }}
                        >
                          {t('scanSets.runSet')}
                        </button>
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => { setSelectedSetId(scanSet.id); void openCleanupPreview(scanSet.paths); }}
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
              )}
            </section>
          )}

          {/* ── Settings Tab ─────────────────────────────────── */}
          {activeTab === 'settings' && (
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">{t('settings.title')}</h2>
              </div>

              {/* General toggles */}
              <div className="settings-general">
                <ToggleRow
                  label={t('settings.autoStartOnLogin')}
                  checked={settings.autoStart}
                  onChange={(checked) => void updateSettings({ autoStart: checked })}
                />
                <ToggleRow
                  label={t('settings.enablePeriodicScans')}
                  checked={settings.periodicEnabled}
                  onChange={(checked) => void updateSettings({ periodicEnabled: checked })}
                />
                <ToggleRow
                  label={t('settings.enableRealtimeWatch')}
                  checked={settings.realtimeEnabled}
                  onChange={(checked) => void updateSettings({ realtimeEnabled: checked })}
                />
              </div>

              {/* Numeric settings */}
              <div className="settings-numbers">
                <label className="field-label">
                  {t('settings.periodicIntervalMin')}
                  <div className="field-with-unit">
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
                    <span className="field-unit">min</span>
                  </div>
                </label>

                <label className="field-label">
                  {t('settings.globalThresholdMb')}
                  <div className="field-with-unit">
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
                    <span className="field-unit">MB</span>
                  </div>
                </label>

                <label className="field-label">
                  {t('settings.alertCooldownMin')}
                  <div className="field-with-unit">
                    <input
                      type="number"
                      min={0}
                      value={settings.alertCooldownMinutes}
                      onChange={(event) =>
                        queueSettingsUpdate({ alertCooldownMinutes: Number.parseInt(event.target.value || '0', 10) })
                      }
                      onBlur={() => void flushPendingSettings()}
                    />
                    <span className="field-unit">min</span>
                  </div>
                </label>
              </div>

              <div className="inline-note">{t('settings.trayPolicyNote')}</div>

              {/* Watch Targets */}
              <div className="panel-header">
                <h2 className="panel-title">{t('settings.watchTargets')}</h2>
                <button className="btn primary" disabled={busy} onClick={() => void addWatchTargets()}>
                  {t('settings.addFolders')}
                </button>
              </div>

              {settings.watchTargets.length === 0 ? (
                <div className="empty-state">
                  <IconEmpty />
                  <p>{t('settings.watchTargetsEmpty')}</p>
                </div>
              ) : (
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
                        <label className="field-label">
                          {t('settings.targetThresholdMb')}
                          <div className="field-with-unit">
                            <input
                              type="number"
                              min={0}
                              value={target.targetThresholdBytes ? bytesToMbInput(target.targetThresholdBytes) : 0}
                              onChange={(event) => {
                                const numeric = Number.parseInt(event.target.value || '0', 10);
                                patchWatchTarget(
                                  target.id,
                                  { targetThresholdBytes: numeric > 0 ? mbInputToBytes(numeric) : undefined },
                                  'debounced'
                                );
                              }}
                              onBlur={() => void flushPendingSettings()}
                            />
                            <span className="field-unit">MB</span>
                          </div>
                        </label>

                        <label className="field-label">
                          {t('settings.onlyComma')}
                          <input
                            type="text"
                            value={target.only?.join(',') ?? ''}
                            onChange={(event) => {
                              const only = event.target.value.split(',').map((item) => item.trim()).filter(Boolean);
                              patchWatchTarget(target.id, { only: only.length > 0 ? only : undefined }, 'debounced');
                            }}
                            onBlur={() => void flushPendingSettings()}
                          />
                        </label>

                        <label className="field-label">
                          {t('settings.excludeComma')}
                          <input
                            type="text"
                            value={target.exclude?.join(',') ?? ''}
                            onChange={(event) => {
                              const exclude = event.target.value.split(',').map((item) => item.trim()).filter(Boolean);
                              patchWatchTarget(
                                target.id,
                                { exclude: exclude.length > 0 ? exclude : undefined },
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
              )}
            </section>
          )}

          {/* ── Alerts Tab ───────────────────────────────────── */}
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
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────── */}
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
              if (checked) { next.add(dirPath); } else { next.delete(dirPath); }
              return next;
            });
          }}
          onPreviousPage={() => setPreviewPage((page) => page - 1)}
          onNextPage={() => setPreviewPage((page) => page + 1)}
          onCancel={() => void cancelCleanupPreview()}
          onConfirm={() => void confirmCleanup()}
        />
      )}
    </div>
  );
}
