# dep-clean-gui GUI Transition PRD + Technical Plan (Fork Edition)

## 1. Background / Problem
This fork extends a CLI-first cleanup tool into a tray-resident desktop application.
The original CLI workflow is useful for manual runs, but not ideal for always-on monitoring.

Problems addressed in this fork:
- No native resident lifecycle in CLI-only mode
- Repeated multi-folder scanning is operationally expensive
- Threshold overuse is detected too late without persistent monitoring
- Safer cleanup requires explicit approval UX in a GUI

## 2. Goals / Non-goals
### Goals
- Keep CLI core compatibility
- Deliver Electron + React desktop UX
- Provide hybrid monitoring (periodic + realtime)
- Provide batch scanning via scan sets
- Provide global/target threshold alerts
- Require approval before deletion

### Non-goals
- Email/Slack/cloud integrations
- Team-shared remote settings
- Auto-delete by default

## 3. User Scenarios
1. User registers watch folders and leaves app running in tray.
2. App scans periodically and reacts to filesystem events.
3. Threshold exceed/resolved events are shown in OS notifications and in-app history.
4. User creates cleanup preview and confirms only selected paths.
5. User saves frequently used folder groups as scan sets.

## 4. Functional Requirements
### FR-1 Resident + Startup
- Tray-resident behavior is fixed.
- First GUI launch asks user startup preference.

### FR-2 Hybrid Monitoring
- Periodic scheduler + realtime watcher.
- Event debounce and serialized scan queue.

### FR-3 Batch Scan Sets
- Multi-folder picker.
- Save/edit/delete scan sets.
- Run set on demand.

### FR-4 Threshold Alerts
- Global threshold and per-target threshold.
- Alert cooldown.
- `exceeded` and `resolved` lifecycle records.

### FR-5 Approval Cleanup
- Preview first, then confirm delete.
- Partial failure reporting.

### FR-6 CLI Compatibility
- Preserve CLI options and behavior.

## 5. Information Architecture / Flow
- Dashboard: runtime controls + last scan
- Scan Sets: set management and batch execution
- Settings: monitoring + threshold controls
- Alerts: history and read/clear actions

Core flow:
1. App boot -> settings load -> monitor start
2. Scan run -> threshold evaluation -> alert emission
3. Cleanup preview -> explicit confirmation -> delete + re-scan

## 6. Architecture
- Electron main process:
  - settings store
  - monitoring engine
  - alert manager
  - IPC handlers
  - tray lifecycle
- Renderer (React):
  - UI screens and user inputs
- Preload:
  - secure `window.depClean` API
- Shared core (`src/*`):
  - scanner/cleaner/types used by CLI + GUI

## 7. Data Model / Schema
### AppSettings
- `autoStart: boolean`
- `startupChoiceCompleted: boolean`
- `runInTray: boolean` (deprecated for UI toggling; normalized to `true`)
- `periodicEnabled: boolean`
- `periodicMinutes: number`
- `realtimeEnabled: boolean`
- `globalThresholdBytes: number`
- `alertCooldownMinutes: number`
- `watchTargets: WatchTarget[]`
- `scanSets: ScanSet[]`

### Additional models
- `WatchTarget`
- `ScanSet`
- `ThresholdAlert`
- `CleanupPreview`
- `CleanupConfirmResult`

## 8. IPC / API
- Settings: `settings.get`, `settings.update`
- Scan: `scan.runManual`, `scan.runSet`, `scan.getLastResult`, progress/completed events
- Watch: `watch.start`, `watch.stop`, `watch.status`, status-changed event
- Alerts: `alerts.list`, `alerts.markRead`, `alerts.clear`, created event
- Cleanup: `cleanup.preview`, `cleanup.confirmDelete`
- Folder picker: `folders.pick`

## 9. Error Handling
- Permission-denied directories are skipped in scan.
- Missing cleanup approval token returns explicit error.
- Partial delete failures are returned per path.
- OS feature gaps (notification/login item) use graceful fallback.

## 10. Test Strategy / Acceptance
### Automated
- Scanner target filtering
- Alert lifecycle and cooldown
- Settings normalization and migration
- Launch mode decision (`--launch-tray`, login startup)

### Acceptance
- First launch startup choice appears once
- Close window minimizes to tray
- Tray `Quit` exits process
- Auto-start launch opens hidden in tray mode
- CLI options continue to work

## 11. Milestones
- M1: core + docs + tests
- M2: Electron shell + renderer baseline
- M3: monitoring engine + tray policy
- M4: threshold alerts
- M5: scan-set and cleanup refinement
- M6: packaging and release automation

## 12. Risks / Mitigation
- Watch event bursts -> debounce + queue
- OS behavior variance -> fallback + explicit state UI
- Large scans -> configurable targets and filters

## 13. CLI Compatibility Policy
- Keep CLI entrypoint and options stable.
- Reuse scanner/cleaner core in both interfaces.
- Treat CLI regressions as release blockers.

## 14. Fork Governance Notes
- Repository is maintained as a fork (`twbeatles/dep-clean-gui`).
- Fork-specific product decisions (resident UX, startup flow, release automation) are documented here.
- When syncing with upstream, preserve fork-only desktop policy unless explicitly changed.
