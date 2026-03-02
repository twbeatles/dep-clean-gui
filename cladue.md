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
  - `electron/preload.ts`
  - `gui/src/*`

## Key Fork Extensions

- Settings store and normalization: `src/settings-store.ts`
- Monitoring engine: `src/watch-engine.ts`
- Alerts lifecycle: `src/alert-manager.ts`
- Scan runner orchestration: `src/scan-runner.ts`
- Launch mode utility: `src/electron-launch-mode.ts`

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

## Verification Commands

```bash
npm test
npm run build
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
