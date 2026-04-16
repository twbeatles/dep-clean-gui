# dep-clean-gui

English | [Korean](./README_KO.md)

Fork-based desktop extension of the original `dep-clean` CLI project.
This repository (`twbeatles/dep-clean-gui`) keeps CLI compatibility while adding a tray-resident GUI app.

## Fork Context

- This project is maintained as a **forked repository**.
- Core scanning and cleanup behavior is inherited from the upstream CLI model.
- GUI/runtime policies are extended in this fork for desktop resident usage.

## What This Fork Adds

- Electron + React desktop app
- Hybrid monitoring (periodic scan + realtime watch)
- Scan sets (batch scan for selected folders)
- Threshold alerts (global + per target)
- Approval-first cleanup flow
- Tray-resident lifecycle (close window = hide to tray)

## End User Run Model

You do not need `npm start` as an end user.

1. Install an app package (`.exe`, etc.)
2. Launch from OS app menu
3. Choose startup behavior on first GUI launch
4. Use tray menu `Quit` for full exit

## Startup and Tray Policy

- First GUI launch shows a startup choice modal.
- `Enable Auto-start`: app launches at login in tray mode.
- `Decide Later`: no auto-start yet (can change in Settings).
- Window close always minimizes to tray.

## Release Model

- Windows: automated by GitHub Actions (`v*` tags or manual dispatch)
- macOS / Linux: packaged manually with scripts

Installers are distributed through GitHub Releases.

## Packaging Footprint Policy

- `electron-builder` output directory is `release/` (not `dist/`).
- `dist/` is reserved for compiled app sources only.
- Packaging includes only runtime-required artifacts:
  - `dist/electron/**/*`
  - `dist/src/**/*`
  - `dist/gui/**/*`
  - `package.json`
- Source maps and declaration artifacts are excluded from packaged output.
- Electron locales are restricted to `en` and `ko`.
- Compression is set to `maximum`.

## CLI Compatibility

The original CLI behavior remains available.

```bash
dep-clean --help
dep-clean --dry-run
dep-clean --only node_modules,venv
dep-clean --exclude vendor,Pods
```

## Documentation and Performance Snapshot (2026-03)

- **Comprehensive UI/UX Refactoring**:
  - CSS design system redesigned (left sidebar + main content layout).
  - Dashboard metrics visual hierarchy strengthened and buttons grouped by intent.
  - Custom SVG icons and state toggle switches introduced.
  - User-friendly i18n strings in English and Korean.
  - Applied subtle animations for panel entry, hover, and state changes.
- Scanner core uses iterative traversal + bounded file stat concurrency.
- Multi-target scans run with bounded parallelism for faster watch/set runs.
- Watch engine now rebuilds watchers only when watcher-relevant settings change.
- Realtime burst events are coalesced to avoid scan queue overgrowth.
- Settings inputs in GUI use debounce + blur commit to reduce IPC/disk churn.
- Alert history and cleanup preview now use pagination for large datasets.
- CLI flags and approval-first cleanup policy remain unchanged.

## IPC Addition (Backward Compatible)

- `alerts.list(options?: { limit?: number })` now supports optional `limit`.
- Calling `alerts.list()` without options keeps existing behavior.

## Cleanup Hardening Update (2026-03-03)

- Cleanup preview now deduplicates directories by canonical path to prevent over-counted deletion metrics.
- Cleanup approvals are now time-bounded:
  - approval TTL: `15 minutes`
  - expired approvals are pruned in the background (`60s` sweep)
- New cleanup IPC/API behavior:
  - `cleanup.cancel(approvalId)` added
  - `CleanupPreview` includes `expiresAt`
  - `cleanup.confirmDelete(...)` may return `retryPreview` when partial failures remain
- Cleanup scope safety is enforced:
  - preview paths must be registered roots (`watchTargets` + `scanSets`)
  - selected delete paths must remain inside approved roots
  - root paths are rejected
- Deletion engine now prioritizes result accuracy:
  - `rm(..., force: true)` removed
  - pre-check via `lstat`
  - retry for transient filesystem errors (`EPERM`, `EBUSY`, `ENOTEMPTY`)
- Cleanup and watcher runs are coordinated to reduce I/O contention:
  - when monitor is running, cleanup uses `stop -> delete -> one rescan -> start`

## Reliability Hardening Update (2026-03-05)

- Scan notification flow is now single-sourced:
  - manual/scan-set runs emit OS notifications only via `WatchEngine` scan-completed callback
  - duplicate notifications from direct IPC handlers were removed
- Watcher failures are now fail-soft:
  - watcher `error` events are handled explicitly
  - failed watcher is detached/closed while monitor runtime remains active
  - watcher error details are logged to startup diagnostics
- Settings normalization and persistence safety were tightened:
  - boolean fields now enforce strict boolean coercion with defaults
  - watch targets are deduped by canonical path during normalization
  - corrupted `settings.json` is backed up (`settings.corrupt.<timestamp>.json`) before default recovery
- Cleanup confirmation API now rejects empty selections explicitly.
- Renderer locale consistency was improved by removing remaining hard-coded UI strings.

## Alert Accuracy + Watch Recovery Update (2026-04-16)

- Threshold evaluation now distinguishes full scans from partial scans:
  - partial scans no longer auto-resolve unrelated active alerts
  - scan-set / partial target alerts are matched by canonical path, not only transient run ids
  - global threshold evaluation is skipped for partial scans to avoid misleading resolved notifications
- Watch runtime now exposes degraded-but-recovering state:
  - watcher failures move monitor status into a visible recovery state
  - failed watcher targets are retried automatically in the background
  - renderer shows recovering target count and paths
- Alert persistence is now more resilient:
  - `alerts.json` writes use temp-file replacement
  - corrupted alert history is backed up as `alerts.corrupt.<timestamp>.json` before recovery
- Cleanup preview UX is improved:
  - when no cleanup candidates exist, the renderer shows a user-facing message instead of opening an empty confirm modal

## Windows Packaging Bridge Stability

- Preload is compiled as CommonJS (`dist/electron/preload.cjs`) for packaged builds.
- Electron main now loads `preload.cjs` explicitly to avoid sandbox preload parse failures.
- This fixes packaged startup cases that previously showed only a background with no interactive UI.

## Locale-Based UI (en/ko)

- Desktop UI now auto-selects language from OS/PC locale:
  - `ko*` -> Korean
  - others -> English
- Scope includes renderer UI, tray context menu, OS notifications, and folder picker dialog titles.
- CLI behavior and flags remain unchanged.

## Developer Commands

```bash
# install dependencies
npm ci

# tests
npm test

# build all
npm run build

# build GUI renderer only
npm run build:renderer

# run GUI in dev mode
npm run dev

# run CLI in dev mode
npm run dev:cli -- --help

# clean build/package outputs
npm run clean

# package targets
npm run package:win
npm run package:mac
npm run package:linux
```

## AI Session Handoff Docs

- [cladue.md](./cladue.md)
- [gemini.md](./gemini.md)

## License

MIT
