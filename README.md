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
