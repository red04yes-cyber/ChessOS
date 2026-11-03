# Chess OS

Windows-first chess repertoire and training desktop app. This repository now contains a **fresh MVP rebuild (0.1.0)** because the old 0.7.0 source archive could not be reconstructed from the incomplete recovery fragments.

## What works in this rebuild

- Interactive 8×8 chessboard with legal move validation through `chess.js`
- Check, checkmate, stalemate and draw status
- Create, rename, save, open and delete repertoire lines
- Local persistence in browser/Tauri WebView storage
- PGN import and export
- Undo and reset in Studio mode
- Training mode that asks the user to replay every move in a saved or current line
- Vite frontend and Tauri 2 desktop shell
- Automated JavaScript tests and a Windows NSIS installer workflow

## Important scope note

This is **not** the recovered 0.7.0 application and is not yet feature-complete against the original roadmap. The following are not implemented in this rebuild:

- FSRS scheduling and review history
- SQLite database and schema migrations
- Stockfish analysis / evaluation
- Repertoire tree editor, transpositions and advanced RAV variation editing
- Dashboard, analytics, goals and exams
- Cloud sync, account system and backups

The old archive fragments remain under `recovery/` for provenance only. They are not build inputs.

## Requirements

- Node.js 20 or newer
- Rust stable with the `x86_64-pc-windows-msvc` target
- Microsoft C++ Build Tools (MSVC) and the Windows 10/11 SDK
- WebView2 Runtime (normally already present on supported Windows 10/11 systems)

For local Windows development, install the **Desktop development with C++** workload in Visual Studio Build Tools, then install Rust using the MSVC toolchain. Tauri's Windows installer uses the WebView2 bootstrapper so a missing runtime can be installed during setup.

## Run locally

```sh
npm install
npm test
npm run dev
```

Open the local Vite URL printed in the terminal. The Vite build uses relative asset URLs so the compiled frontend also loads from the packaged Tauri WebView. To run the Tauri desktop shell:

```sh
npm run tauri:dev
```

To build the Windows NSIS installer on Windows:

```powershell
npm run tauri:build
```

The NSIS installer is configured for a per-user installation (no administrator prompt by default), creates a Start Menu entry, and downloads the small WebView2 bootstrapper if the runtime is missing. The frontend and installer are also checked by the GitHub Actions workflow on pushes and pull requests to `main`.

The installer, when a successful CI run produces it, is uploaded as the `chess-os-windows-installer` workflow artifact. A successful build has not yet been independently verified.

## Data

Repertoire lines are stored locally in the WebView/browser `localStorage`. Export important lines to PGN for backup. Clearing application/browser data will remove locally stored repertoire data.

## License

No license has been selected yet. All rights remain with the project owner unless a license is added.