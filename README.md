# Chess OS

Windows-first chess repertoire and training desktop app. This repository now contains a **fresh MVP rebuild (0.1.0)** because the old 0.7.0 source archive could not be reconstructed from the incomplete recovery fragments.

## What works in this rebuild

- Interactive 8×8 chessboard with legal move validation through `chess.js`
- Castling, en passant and promotion chooser (queen, rook, bishop or knight)
- Last-move and check highlights; selectable legal destinations
- Move-by-move position navigation, back/forward controls and arrow-key navigation
- Board rotation and current-position FEN copy
- Check, checkmate, stalemate and draw status
- Create, rename, save, open and delete repertoire lines
- SQLite persistence in the Windows desktop app, with localStorage fallback for browser preview
- Versioned SQLite migrations, normalized position/move tables and localStorage-to-SQLite import
- PGN import and export, including recursive annotation variations (RAV)
- Repertoire graph with move nodes/edges, branch navigation and in-place variation editing
- Position transposition detection so equivalent positions reached by different move orders converge on one node
- PGN variation export with round-trip regression tests
- Undo/redo by navigating the complete move timeline and reset in Studio mode
- Training mode that asks the user to replay every move in a saved or current line
- Blindfold training with SAN input, hidden pieces and move notation, and automatic error capture
- Automatic repertoire-miss flashcards from imported game PGNs and mistakes in training
- FSRS scheduling (Again / Hard / Good / Easy) with per-card review history via `ts-fsrs`
- Weakness heatmap that distinguishes weak, learning, stable and not-yet-measured positions
- Opponent preparation from one or more PGNs: opening frequencies, first moves, results and sample size
- Transposition explorer showing distinct move sequences that converge on the same graph position
- Vite frontend and Tauri 2 desktop shell
- Automated JavaScript tests for legal moves, castling, en passant, promotion, PGN and terminal positions; Windows NSIS installer workflow

## Important scope note

This is **not** the recovered 0.7.0 application and is not yet feature-complete against the original roadmap. The following are not implemented in this rebuild:

- Stockfish engine evaluation and tactical blunder detection (automatic cards currently detect departures from the saved repertoire, not engine-proven mistakes)
- Full SQLite backup/export and restore UI
- Full dashboard, goals and exams
- Cloud sync, account system and backups

The old archive fragments remain under `recovery/` for provenance only. They are not build inputs.

The feature roadmap and implementation boundaries are tracked in [docs/ROADMAP.md](docs/ROADMAP.md).

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

The latest completed Windows CI run (#134) generated the NSIS installer, installed and launched it, upgraded 0.1.0 to a test 0.1.1 build, verified SQLite data retention across upgrade and uninstall, generated a SHA-256 sidecar, and uploaded the installer/checksum as a 90-day artifact. A separate manual acceptance test on a clean Windows 10/11 VM or PC is still required.

## Data and SQLite

The Tauri desktop app stores repertoire data in `chess-os.sqlite3` inside the application data directory managed by Tauri. The database has versioned migrations (`schema_migrations`), a repertoire table, normalized position and move-edge tables (so branches and transpositions are retained), app settings, and tables reserved for training cards and review history. Repertoire graphs use SQLite in desktop mode. FSRS cards, their review history and the latest opponent report are currently stored in WebView/browser `localStorage`; moving these records into the existing SQLite training tables is a follow-up persistence task.

On first desktop startup, Chess OS imports legacy `chess-os.repertoire.v1` entries from WebView `localStorage` that are not already in SQLite. The legacy key is removed only after all entries have imported successfully. To back up a repertoire today, export it as PGN; a full SQLite backup/restore interface is still planned. See [docs/DATABASE.md](docs/DATABASE.md) for the schema and migration details.

## Release preparation

Release checklist, clean-Windows acceptance steps, branch-protection instructions and draft 0.1.0 notes: [docs/RELEASING.md](docs/RELEASING.md) and [docs/releases/v0.1.0.md](docs/releases/v0.1.0.md). The current CI runs an installer upgrade/data-preservation smoke test and produces a SHA-256 sidecar; manual testing on a separate Windows 10/11 machine is still required.

## License

No license has been selected yet. All rights remain with the project owner unless a license is added.