# cladue.md

This file is a persistent handoff note for AI sessions in this repository.
The filename intentionally follows project request: `cladue.md`.

## Repository Identity

- Repo: `twbeatles/dep-clean-gui`
- Type: **forked repository**
- Purpose: keep `dep-clean` CLI compatibility while adding desktop GUI and tray-resident behavior

## Product Policy (Must Preserve)

1. Window close is not app exit; it hides to tray.
2. Full exit is done through tray menu `Quit`.
3. First GUI launch asks startup preference.
4. Auto-start launch should open hidden in tray mode.
5. Cleanup must remain approval-first (preview -> confirm delete).

## Runtime Architecture

- CLI entry: `bin/cli.ts`
- Shared core:
  - `src/scanner.ts`
  - `src/cleaner.ts`
  - `src/types.ts`
- Desktop runtime:
  - `electron/main.ts`
  - `electron/preload.cts`
  - `gui/src/*`

## Key Fork Extensions

- Settings store and normalization: `src/settings-store.ts`
- Monitoring engine: `src/watch-engine.ts`
- Alerts lifecycle: `src/alert-manager.ts`
- Scan runner orchestration: `src/scan-runner.ts`
- Launch mode utility: `src/electron-launch-mode.ts`

## Performance Refactor Snapshot (2026-03)

- Scanner:
  - iterative traversal + bounded stat concurrency
  - supports path-like targets such as `vendor/bundle`
- Scan runner:
  - bounded target parallelism (`TARGET_SCAN_CONCURRENCY=2`)
- Watch engine:
  - diff-based watcher rebuild and periodic timer reset
  - realtime event coalescing to prevent queue explosion
- Settings store:
  - in-memory cache
  - avoid no-op rewrite
  - single-write update path
- Alert manager:
  - `list({ limit })` support
  - history cap (`ALERT_HISTORY_MAX=5000`)
- Renderer:
  - debounced settings commit + blur flush
  - `Set<string>` cleanup selection
  - paginated alert/cleanup lists

## Windows Packaging + i18n Snapshot (2026-03)

- **Comprehensive UI/UX Refactoring**:
  - Transitioned from top-tabs to a modern left sidebar + main content layout
  - Dashboard metrics are visually distinct with SVG icons and grouped run controls
  - Replaced native checkboxes with custom CSS toggle switches
  - User-friendly English and Korean locale strings with updated terminology
  - Added subtle entry, hover, and state transition animations
- Preload bridge stability:
  - preload source is TypeScript CommonJS entry (`electron/preload.cts`)
  - packaged runtime uses `dist/electron/preload.cjs`
  - main process loads `preload.cjs` explicitly
- Locale policy:
  - `ko*` => Korean
  - otherwise English (fallback)
- i18n scope:
  - renderer UI
  - tray menu labels
  - OS notifications
  - folder picker dialog title
- Diagnostics:
  - startup log path remains `%TEMP%/dep-clean-gui-startup.log`

## Cleanup Hardening Snapshot (2026-03-03)

- Approval lifecycle is now explicit:
  - TTL is fixed to 15 minutes
  - expired approvals are pruned every 60 seconds
  - renderer can revoke approval via `cleanup.cancel(approvalId)`
- Cleanup payload contract updates:
  - `CleanupPreview` now includes `expiresAt`
  - `CleanupConfirmResult` may include `retryPreview` when partial failures remain
- Safety guardrails:
  - preview paths must belong to registered roots (`watchTargets` + `scanSets`)
  - delete selections must remain within approved roots
  - root paths are blocked
- Deletion semantics:
  - removed `force: true` deletes
  - lstat pre-check before delete
  - transient filesystem retries for `EPERM`, `EBUSY`, `ENOTEMPTY`
- Runtime coordination:
  - when monitor is running, cleanup performs `watch.stop -> delete -> one rescan -> watch.start`

## Startup / Tray Rules

- `AppSettings.startupChoiceCompleted` controls first-run modal visibility.
- `runInTray` exists for compatibility but is normalized to `true`.
- `--launch-tray` is the official hidden-start argument.
- Launch-to-tray decision uses `shouldLaunchToTray()`.

## Release and Packaging

- Windows automated release workflow:
  - `.github/workflows/release-windows.yml`
- Local packaging commands:
  - `npm run package:win`
  - `npm run package:mac`
  - `npm run package:linux`
- Packaging guardrails:
  - `electron-builder` output path: `release/` (never under `dist/`)
  - package include scope: `dist/electron`, `dist/src`, `dist/gui`, `package.json`
  - exclude: `*.map`, `*.d.ts`, `*.d.ts.map`
  - locales: `en`, `ko`
  - compression: `maximum`

## Verification Commands

```bash
npm test
npm run build
npm run build:renderer
npm run dev:cli -- --help
npm run package:win
```

## Documentation Set

- `README.md` (English)
- `README_KO.md` (Korean)
- `docs/gui-transition-prd-tech-plan.md` (PRD + technical plan)
- `cladue.md` (this AI handoff)
- `gemini.md` (parallel AI handoff format)

## Contributor Notes

- Keep CLI behavior backward-compatible.
- Do not remove tray-resident UX unless explicitly requested.
- Reflect fork context in user-facing docs when changing product direction.
- If startup/tray policy changes, update both README files and this handoff file.
