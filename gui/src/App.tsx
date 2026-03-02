import { useEffect, useMemo, useState } from 'react';
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

const TAB_LABELS: Array<{ key: TabKey; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'scanSets', label: 'Scan Sets' },
  { key: 'settings', label: 'Settings' },
  { key: 'alerts', label: 'Alert History' },
];

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

function buildSetName(paths: string[]): string {
  if (paths.length === 1) {
    const tokens = paths[0].split(/[/\\]/g).filter(Boolean);
    return `Set: ${tokens[tokens.length - 1] ?? 'scan'}`;
  }

  return `Set: ${paths.length} folders (${new Date().toLocaleDateString()})`;
}

export default function App() {
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
  const [selectedDeletePaths, setSelectedDeletePaths] = useState<string[]>([]);
  const [showStartupChoiceModal, setShowStartupChoiceModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const selectedSet = useMemo(
    () => settings?.scanSets.find((scanSet) => scanSet.id === selectedSetId) ?? null,
    [settings?.scanSets, selectedSetId]
  );

  const selectedPreviewSize = useMemo(() => {
    if (!preview) return 0;
    const picked = new Set(selectedDeletePaths);
    return preview.directories.filter((dir) => picked.has(dir.path)).reduce((sum, dir) => sum + dir.size, 0);
  }, [preview, selectedDeletePaths]);

  async function bootstrap() {
    try {
      const [nextSettings, nextStatus, nextAlerts, nextScan] = await Promise.all([
        window.depClean.settings.get(),
        window.depClean.watch.status(),
        window.depClean.alerts.list(),
        window.depClean.scan.getLastResult(),
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
    void bootstrap();

    const unsubscribeProgress = window.depClean.scan.onProgress((event) => {
      setProgress(event);
    });

    const unsubscribeCompleted = window.depClean.scan.onCompleted((outcome) => {
      setProgress(null);
      setLastOutcome(outcome);
      setLastScan(outcome.scanResult);
    });

    const unsubscribeStatus = window.depClean.watch.onStatusChanged((status) => {
      setWatchStatus(status);
    });

    const unsubscribeAlerts = window.depClean.alerts.onCreated((created) => {
      setAlerts((prev) => [...created, ...prev]);
    });

    return () => {
      unsubscribeProgress();
      unsubscribeCompleted();
      unsubscribeStatus();
      unsubscribeAlerts();
    };
  }, []);

  async function updateSettings(partial: Partial<AppSettings>) {
    try {
      setBusy(true);
      const next = await window.depClean.settings.update(partial);
      setSettings(next);
      setMessage('Settings saved.');
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runManualScan(paths?: string[]) {
    try {
      setBusy(true);
      const outcome = await window.depClean.scan.runManual(paths);
      setLastOutcome(outcome);
      setLastScan(outcome.scanResult);
      const nextAlerts = await window.depClean.alerts.list();
      setAlerts(nextAlerts);
      setMessage(`Scan complete: ${outcome.scanResult.directoryCount} folders, ${bytesToText(outcome.scanResult.totalSize)}`);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runSelectedSet() {
    if (!selectedSet) return;

    try {
      setBusy(true);
      const outcome = await window.depClean.scan.runSet(selectedSet.id);
      setLastOutcome(outcome);
      setLastScan(outcome.scanResult);
      setMessage(`Scan set complete: ${selectedSet.name}`);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function startWatch() {
    try {
      setBusy(true);
      const status = await window.depClean.watch.start();
      setWatchStatus(status);
      setMessage('Hybrid monitor started.');
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopWatch() {
    try {
      setBusy(true);
      const status = await window.depClean.watch.stop();
      setWatchStatus(status);
      setMessage('Hybrid monitor stopped.');
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
      setMessage('No new folders to add.');
      return;
    }

    await updateSettings({
      watchTargets: [...settings.watchTargets, ...additions],
    });
  }

  function patchWatchTarget(targetId: string, patch: Partial<WatchTarget>) {
    if (!settings) return;
    const nextTargets = settings.watchTargets.map((target) => {
      if (target.id !== targetId) return target;
      return { ...target, ...patch };
    });
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
      name: newSetName.trim() || buildSetName(picked),
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

  async function openCleanupPreview() {
    try {
      setBusy(true);
      const paths = selectedSet ? selectedSet.paths : undefined;
      const nextPreview = await window.depClean.cleanup.preview(paths);
      setPreview(nextPreview);
      setSelectedDeletePaths(nextPreview.directories.map((dir) => dir.path));
      setMessage('Cleanup approval list generated.');
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
      const result = await window.depClean.cleanup.confirmDelete(preview.approvalId, selectedDeletePaths);
      setPreview(null);
      setSelectedDeletePaths([]);
      setMessage(`Cleanup complete: ${result.deletedCount} deleted, freed ${bytesToText(result.freedSize)}`);

      if (result.failures.length > 0) {
        setErrorMessage(`Some deletes failed: ${result.failures.length}`);
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
    setAlerts(next);
  }

  async function clearAlerts() {
    await window.depClean.alerts.clear();
    setAlerts([]);
  }

  async function completeStartupChoice(enableAutoStart: boolean) {
    try {
      setBusy(true);
      const nextSettings = await window.depClean.settings.update({
        autoStart: enableAutoStart,
        startupChoiceCompleted: true,
        runInTray: true,
      });
      setSettings(nextSettings);
      setShowStartupChoiceModal(false);
      setMessage(
        enableAutoStart
          ? 'Auto-start enabled. The app will launch to tray on sign-in.'
          : 'Auto-start kept disabled. You can change this later in Settings.'
      );
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !watchStatus) {
    return <div className="loading">Initializing app...</div>;
  }

  return (
    <div className="app-shell">
      <header className="top-header">
        <div>
          <p className="eyebrow">CLI Core + Desktop GUI</p>
          <h1>dep-clean hybrid monitor</h1>
          <p className="subtitle">Periodic scans + realtime watch + threshold alerts + approved cleanup</p>
        </div>
        <div className="status-pills">
          <span className={`pill ${watchStatus.running ? 'ok' : 'idle'}`}>
            {watchStatus.running ? 'Monitoring ON' : 'Monitoring OFF'}
          </span>
          <span className="pill neutral">Watchers {watchStatus.watcherCount}</span>
        </div>
      </header>

      <nav className="tabs">
        {TAB_LABELS.map((tab) => (
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
              <h2>Run Controls</h2>
              <div className="button-row">
                <button className="btn primary" disabled={busy} onClick={() => void runManualScan()}>
                  Manual Scan
                </button>
                <button className="btn" disabled={busy || !selectedSet} onClick={() => void runSelectedSet()}>
                  Run Scan Set
                </button>
                <button className="btn" disabled={busy} onClick={() => void openCleanupPreview()}>
                  Build Cleanup Approval
                </button>
                <button className="btn" disabled={busy || watchStatus.running} onClick={() => void startWatch()}>
                  Start Monitor
                </button>
                <button className="btn danger" disabled={busy || !watchStatus.running} onClick={() => void stopWatch()}>
                  Stop Monitor
                </button>
              </div>
            </div>

            <div className="metrics-row">
              <article className="metric-card">
                <h3>Latest Total Size</h3>
                <p>{bytesToText(lastScan?.totalSize ?? 0)}</p>
              </article>
              <article className="metric-card">
                <h3>Latest Directory Count</h3>
                <p>{lastScan?.directoryCount ?? 0}</p>
              </article>
              <article className="metric-card">
                <h3>Next Periodic Run</h3>
                <p>{watchStatus.nextRunAt ? timestampText(watchStatus.nextRunAt) : 'Disabled'}</p>
              </article>
            </div>

            {progress && (
              <div className="inline-note">
                Scan progress: {progress.current}/{progress.total} ({progress.targetPath})
              </div>
            )}

            {lastOutcome && lastOutcome.alerts.length > 0 && (
              <div className="inline-note warning">
                Last scan generated {lastOutcome.alerts.length} threshold events.
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
                    <p className="muted">+ {target.directories.length - 8} more directories</p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'scanSets' && (
          <section className="panel">
            <div className="panel-header">
              <h2>Batch Scan Sets</h2>
            </div>

            <div className="inline-form">
              <input
                placeholder="New set name (optional)"
                value={newSetName}
                onChange={(event) => setNewSetName(event.target.value)}
              />
              <button className="btn primary" disabled={busy} onClick={() => void createScanSet()}>
                Pick Folders + Save Set
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
                    <span>{scanSet.paths.length} folders</span>
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
                        void runSelectedSet();
                      }}
                    >
                      Run Set
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        setSelectedSetId(scanSet.id);
                        void openCleanupPreview();
                      }}
                    >
                      Build Cleanup
                    </button>
                    <button className="btn danger" disabled={busy} onClick={() => deleteScanSet(scanSet.id)}>
                      Delete Set
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
              <h2>System Settings</h2>
            </div>

            <div className="settings-grid">
              <label>
                <span>Auto-start on login</span>
                <input
                  type="checkbox"
                  checked={settings.autoStart}
                  onChange={(event) => void updateSettings({ autoStart: event.target.checked })}
                />
              </label>

              <label>
                <span>Enable periodic scans</span>
                <input
                  type="checkbox"
                  checked={settings.periodicEnabled}
                  onChange={(event) => void updateSettings({ periodicEnabled: event.target.checked })}
                />
              </label>

              <label>
                <span>Enable realtime watch</span>
                <input
                  type="checkbox"
                  checked={settings.realtimeEnabled}
                  onChange={(event) => void updateSettings({ realtimeEnabled: event.target.checked })}
                />
              </label>

              <label>
                <span>Periodic interval (min)</span>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={settings.periodicMinutes}
                  onChange={(event) =>
                    void updateSettings({ periodicMinutes: Number.parseInt(event.target.value || '60', 10) })
                  }
                />
              </label>

              <label>
                <span>Global threshold (MB)</span>
                <input
                  type="number"
                  min={0}
                  value={bytesToMbInput(settings.globalThresholdBytes)}
                  onChange={(event) =>
                    void updateSettings({
                      globalThresholdBytes: mbInputToBytes(Number.parseInt(event.target.value || '0', 10)),
                    })
                  }
                />
              </label>

              <label>
                <span>Alert cooldown (min)</span>
                <input
                  type="number"
                  min={0}
                  value={settings.alertCooldownMinutes}
                  onChange={(event) =>
                    void updateSettings({ alertCooldownMinutes: Number.parseInt(event.target.value || '0', 10) })
                  }
                />
              </label>
            </div>

            <div className="inline-note">
              Closing the window minimizes to tray. Quit from tray menu when needed.
            </div>

            <div className="panel-header">
              <h2>Watch Targets</h2>
              <button className="btn primary" disabled={busy} onClick={() => void addWatchTargets()}>
                Add Folders
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
                      Remove
                    </button>
                  </div>
                  <div className="target-fields">
                    <label>
                      Target threshold (MB)
                      <input
                        type="number"
                        min={0}
                        value={target.targetThresholdBytes ? bytesToMbInput(target.targetThresholdBytes) : 0}
                        onChange={(event) => {
                          const numeric = Number.parseInt(event.target.value || '0', 10);
                          patchWatchTarget(target.id, {
                            targetThresholdBytes: numeric > 0 ? mbInputToBytes(numeric) : undefined,
                          });
                        }}
                      />
                    </label>

                    <label>
                      only (comma)
                      <input
                        type="text"
                        value={target.only?.join(',') ?? ''}
                        onChange={(event) => {
                          const only = event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean);
                          patchWatchTarget(target.id, { only: only.length > 0 ? only : undefined });
                        }}
                      />
                    </label>

                    <label>
                      exclude (comma)
                      <input
                        type="text"
                        value={target.exclude?.join(',') ?? ''}
                        onChange={(event) => {
                          const exclude = event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean);
                          patchWatchTarget(target.id, {
                            exclude: exclude.length > 0 ? exclude : undefined,
                          });
                        }}
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'alerts' && (
          <section className="panel">
            <div className="panel-header">
              <h2>Alert Event History</h2>
              <div className="button-row">
                <button className="btn" onClick={() => void markAllAlertsRead()}>
                  Mark all read
                </button>
                <button className="btn danger" onClick={() => void clearAlerts()}>
                  Clear history
                </button>
              </div>
            </div>

            <div className="alert-list">
              {alerts.map((alert) => (
                <article key={alert.id} className={alert.read ? 'alert-card read' : 'alert-card'}>
                  <header>
                    <strong>{alert.status === 'exceeded' ? 'Exceeded' : 'Resolved'}</strong>
                    <span>{alert.scope === 'global' ? 'GLOBAL' : alert.targetPath ?? alert.targetId}</span>
                  </header>
                  <p>
                    {bytesToText(alert.currentBytes)} / threshold {bytesToText(alert.thresholdBytes)}
                  </p>
                  <time>{timestampText(alert.timestamp)}</time>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {(message || errorMessage) && (
        <footer className="status-bar">
          {message && <p className="ok-text">{message}</p>}
          {errorMessage && <p className="error-text">{errorMessage}</p>}
        </footer>
      )}

      {showStartupChoiceModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Choose Startup Behavior</h2>
            <p>This app runs as a tray-resident utility. Pick your login startup option.</p>
            <div className="modal-actions">
              <button className="btn primary" disabled={busy} onClick={() => void completeStartupChoice(true)}>
                Enable Auto-start
              </button>
              <button className="btn" disabled={busy} onClick={() => void completeStartupChoice(false)}>
                Decide Later
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Cleanup Approval</h2>
            <p>Preview created at: {timestampText(preview.createdAt)}</p>
            <p>
              Selected {selectedDeletePaths.length}/{preview.directories.length} directories. Estimated recovery:{' '}
              {bytesToText(selectedPreviewSize)}
            </p>

            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => setSelectedDeletePaths(preview.directories.map((dir) => dir.path))}
              >
                Select all
              </button>
              <button className="btn" onClick={() => setSelectedDeletePaths([])}>
                Clear all
              </button>
            </div>

            <div className="modal-list">
              {preview.directories.map((dir) => (
                <label key={dir.path}>
                  <input
                    type="checkbox"
                    checked={selectedDeletePaths.includes(dir.path)}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedDeletePaths((prev) => [...prev, dir.path]);
                      } else {
                        setSelectedDeletePaths((prev) => prev.filter((item) => item !== dir.path));
                      }
                    }}
                  />
                  <code>{dir.path}</code>
                  <span>{bytesToText(dir.size)}</span>
                </label>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                disabled={selectedDeletePaths.length === 0 || busy}
                onClick={() => void confirmCleanup()}
              >
                Confirm delete selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
