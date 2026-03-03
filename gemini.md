# gemini.md

Cross-session assistant context for this repository.
This file mirrors `cladue.md` but is formatted for another AI workflow.

## Project Snapshot

- Name: `dep-clean-gui`
- Owner repo: `twbeatles/dep-clean-gui`
- Repository lineage: **forked from original dep-clean CLI ecosystem**
- Current objective: desktop resident cleanup monitor with CLI compatibility

## Current UX Contract

- App is tray-resident.
- Closing window hides app to tray.
- Exit must be explicit from tray `Quit`.
- First GUI launch prompts startup preference.
- Startup-at-login launch should be hidden to tray.

## Technical Contract

### Keep Stable

- CLI command surface and flags
- Shared scanner/cleaner core modules
- Approval-based deletion behavior

### Fork-Specific Behavior

- Hybrid monitor (periodic + realtime)
- Alert history + OS notifications
- Scan sets and batch runs
- Startup choice and tray lifecycle policy

## Important Files

- Core logic: `src/scanner.ts`, `src/cleaner.ts`, `src/watch-engine.ts`
- Settings: `src/config.ts`, `src/settings-store.ts`
- Alerts: `src/alert-manager.ts`
- Launch decision: `src/electron-launch-mode.ts`
- Electron shell: `electron/main.ts`, `electron/preload.cts`
- Renderer app: `gui/src/App.tsx`
- Release workflow: `.github/workflows/release-windows.yml`

## Performance Refactor Snapshot (2026-03)

- Scanner pipeline:
  - iterative traversal instead of recursive DFS
  - bounded stat concurrency for file-size aggregation
  - path-like target matching (`vendor/bundle` etc.)
- Scan orchestration:
  - bounded multi-target parallelism (`TARGET_SCAN_CONCURRENCY=2`)
- Watch engine:
  - diff-based settings application
  - watcher rebuild only on realtime/watch-target changes
  - realtime burst coalescing
- Settings persistence:
  - in-memory cache + no-op write skip
  - single-write update flow
- Alerts:
  - `alerts.list({ limit })` IPC support
  - capped history retention (`ALERT_HISTORY_MAX=5000`)
- Renderer:
  - debounced settings update (`SETTINGS_COMMIT_DEBOUNCE_MS=400`)
  - cleanup selection state uses `Set`
  - pagination for alerts and cleanup preview (`PAGE_SIZE=200`)

## Windows Preload + i18n Snapshot (2026-03)

- **Comprehensive UI/UX Refactoring**:
  - Redesigned CSS with modern left sidebar and dashboard layout
  - Grouped run controls and distinct metrics with SVG icons
  - Refactored settings inputs with custom CSS toggle switches
  - Updated renderer i18n terms to be user-friendly (ko/en)
  - Applied panel, empty-state, and button hover animations
- Packaged preload now runs as CommonJS (`dist/electron/preload.cjs`) to avoid Electron sandbox preload parse errors.
- Main process preload target is explicitly `preload.cjs`.
- Locale selection is automatic:
  - `ko*` => Korean
  - otherwise English
- Localization coverage:
  - renderer strings
  - tray menu labels
  - OS notification strings
  - folder picker dialog title
- Startup diagnostics log remains `%TEMP%/dep-clean-gui-startup.log`.

## Cleanup Hardening Snapshot (2026-03-03)

- Approval lifecycle now has explicit expiry:
  - TTL: 15 minutes
  - background prune cadence: 60 seconds
- Cleanup bridge/API updates:
  - `cleanup.cancel(approvalId)` added
  - `CleanupPreview` includes `expiresAt`
  - `cleanup.confirmDelete(...)` can return `retryPreview` for partial-failure retry
- Safety and scope policy:
  - preview paths must be registered targets (`watchTargets` + `scanSets`)
  - selected delete paths are revalidated against approved roots
  - root paths are rejected
- Deletion semantics improved:
  - removed `rm(..., force: true)`
  - `lstat` pre-check before delete
  - retries for transient delete errors (`EPERM`, `EBUSY`, `ENOTEMPTY`)
- Monitor coordination:
  - cleanup now runs as `watch stop -> delete -> single manual rescan -> watch start` when monitor is active

## Test Expectations

- Unit tests should cover:
  - scanner filtering
  - alert lifecycle
  - settings migration/normalization
  - launch mode decision
- Required checks before push:

```bash
npm test
npm run build
npm run build:renderer
npm run dev:cli -- --help
```

## Packaging Expectations

- Windows packaging path is CI-automated.
- macOS/Linux packaging remains manual script driven.
- If icon assets are added later, document them in README and workflow notes.
- Packaging guardrails:
  - Builder output directory is `release/` (do not emit package outputs under `dist/`)
  - Package only `dist/electron`, `dist/src`, `dist/gui`, and `package.json`
  - Exclude `*.map`, `*.d.ts`, `*.d.ts.map` from packaged app
  - Restrict locales to `en`, `ko` unless scope expands
  - Keep compression at `maximum`

## Documentation Consistency Rules

When behavior changes, update all of:

1. `README.md`
2. `README_KO.md`
3. `docs/gui-transition-prd-tech-plan.md`
4. `cladue.md`
5. `gemini.md`

## Guardrails for Future Sessions

- Preserve fork context in messaging and docs.
- Avoid introducing breaking CLI changes.
- Keep tray policy explicit and consistent in both code and docs.
- Keep startup modal semantics aligned with `startupChoiceCompleted`.
