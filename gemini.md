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
- Electron shell: `electron/main.ts`, `electron/preload.ts`
- Renderer app: `gui/src/App.tsx`
- Release workflow: `.github/workflows/release-windows.yml`

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
