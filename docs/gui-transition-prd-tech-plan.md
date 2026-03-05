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
- Notification emission must be single-delivery per scan completion.

### FR-5 Approval Cleanup
- Preview first, then confirm delete.
- Partial failure reporting.
- Approval is time-bounded (TTL) and can be explicitly canceled.
- Cleanup preview/delete must stay within approved roots.
- Partial failures must support retry without rebuilding the entire preview.

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

Cleanup model requirements:
- `CleanupPreview` includes `expiresAt`.
- `CleanupConfirmResult` may include `retryPreview` for failed-path retry UX.

## 8. IPC / API
- Settings: `settings.get`, `settings.update`
- Scan: `scan.runManual`, `scan.runSet`, `scan.getLastResult`, progress/completed events
- Watch: `watch.start`, `watch.stop`, `watch.status`, status-changed event
- Alerts: `alerts.list`, `alerts.markRead`, `alerts.clear`, created event
- Cleanup: `cleanup.preview`, `cleanup.confirmDelete`, `cleanup.cancel`
- Folder picker: `folders.pick`

## 9. Error Handling
- Permission-denied directories are skipped in scan.
- Missing cleanup approval token returns explicit error.
- Expired cleanup approvals return explicit error.
- Empty cleanup selection returns explicit error.
- Cleanup path-out-of-scope and root-path requests are rejected.
- Partial delete failures are returned per path.
- OS feature gaps (notification/login item) use graceful fallback.
- Watcher runtime errors are fail-soft handled and must not crash monitoring runtime.

## 10. Test Strategy / Acceptance
### Automated
- Scanner target filtering
- Alert lifecycle and cooldown
- Settings normalization and migration
- Launch mode decision (`--launch-tray`, login startup)
- Cleanup policy guardrails (dedupe/root/out-of-scope/registered roots)
- Cleanup approval lifecycle (TTL/cancel/retry preview)
- Cleaner retry + missing-path semantics
- Watcher `error` fail-soft behavior
- Settings boolean normalization hardening + corrupted settings backup recovery
- Empty cleanup selection error contract

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

## 15. Packaging Guardrails (Size + Recursion Safety)
- Package output directory must be `release/` and must not be nested under `dist/`.
- `dist/` should contain only compiled app runtime sources.
- Package include scope is restricted to:
  - `dist/electron/**/*`
  - `dist/src/**/*`
  - `dist/gui/**/*`
  - `package.json`
- Exclude development-only artifacts (`*.map`, `*.d.ts`, `*.d.ts.map`) from packaged app.
- Restrict Electron locales to required set (`en`, `ko`) unless product requirements change.
- Keep package compression at `maximum` for distribution builds.
- Regression rule:
  - If installer size grows unexpectedly, first inspect `app.asar` for recursive build-output inclusion.

## 16. Performance Refactor Notes (2026-03)
- Scanner implementation is optimized for large trees:
  - iterative traversal (non-recursive)
  - bounded file stat concurrency
  - path-like target matching support (example: `vendor/bundle`)
- Scan runner now executes targets with bounded parallelism (`TARGET_SCAN_CONCURRENCY=2`).
- Watch engine applies settings diffs:
  - periodic timer reset only on periodic setting changes
  - watcher rebuild only on realtime/watch-target relevant changes
  - realtime event bursts are coalesced into bounded queued runs
- Settings store now uses in-memory caching and single-write update path to reduce repeated disk I/O.
- Alert manager adds:
  - `alerts.list({ limit })` optional pagination-friendly query
  - capped history retention (`ALERT_HISTORY_MAX=5000`)
- Renderer optimizations:
  - debounced settings commit (`SETTINGS_COMMIT_DEBOUNCE_MS=400`) + blur flush
  - cleanup selection uses `Set<string>` state
  - alert and cleanup preview pagination (`PAGE_SIZE=200`)
  - modal/alert section split into memoized components
- Compatibility contract remains unchanged:
  - tray-resident lifecycle policy
  - approval-first cleanup
  - CLI option/behavior stability

## 17. Windows Preload Bridge + Localization Update (2026-03)

- Packaged preload runtime is fixed to CommonJS (`preload.cjs`) to satisfy Electron sandbox preload parsing.
- Main process now references `dist/electron/preload.cjs` directly.
- Startup diagnostics continue writing to `%TEMP%/dep-clean-gui-startup.log` for packaged troubleshooting.
- Localization policy is now locale-driven (`ko*` -> Korean, otherwise English) with fallback to English.
- Localization scope:
  - renderer UI strings
  - tray context menu labels
  - OS notification title/body
  - folder picker dialog title
- Compatibility remains unchanged:
  - CLI surface/flags
  - tray-resident lifecycle policy
  - approval-first cleanup flow

## 18. Cleanup Hardening Update (2026-03-03)

- New cleanup path policy module:
  - canonical path dedupe
  - root-path blocking
  - approved-root scope enforcement
  - registered-root collection from `watchTargets + scanSets`
- New cleanup approval store:
  - TTL-based approval lifecycle (15 minutes)
  - background expiry sweep (60 seconds)
  - explicit cancel support
  - partial-failure retry state (`retryPreview`)
- Cleaner behavior updates:
  - removed force-delete semantics (`force: true`)
  - lstat pre-check before delete
  - retry for transient delete errors (`EPERM`, `EBUSY`, `ENOTEMPTY`)
  - missing path is treated as explicit failure signal, not silent success
- Runtime coordination updates:
  - when watch mode is running, cleanup is serialized as:
    - `watch.stop -> delete -> one manual rescan -> watch.start`
- Added tests:
  - `test/cleanup-policy.test.ts`
  - `test/cleanup-approval-store.test.ts`
  - `test/cleaner.test.ts`
  - watch stop/start recovery case in `test/watch-engine.test.ts`

## 19. Reliability Hardening Update (2026-03-05)

- Notification flow now guarantees single OS notification emission per scan completion:
  - delivery path is centralized in scan-completed callback handling.
- Watch engine now handles watcher errors fail-soft:
  - failing watcher is removed/closed
  - monitor runtime remains active
  - watcher error details are logged for diagnostics.
- Settings safety and migration hardening:
  - strict boolean normalization fallback is applied to toggle fields
  - watch targets are deduplicated by canonical path
  - malformed settings JSON is backed up before default recovery.
- Cleanup confirmation contract tightened:
  - empty selected-path payload is rejected explicitly.
- Renderer locale consistency:
  - remaining hard-coded labels in empty states/monitor section were moved to i18n keys.
