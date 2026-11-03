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
- Stockfish 19 review of game moves with quality labels (best, excellent, good, inaccuracy, mistake, blunder and conservative brilliant-sacrifice candidates), explanations and an estimated accuracy score
- Chess Lab with Lichess Opening Explorer, alternative moves and opening statistics
- Play against Stockfish from the current position or a selected repertoire variation
- One-action account sync for all public Chess.com monthly archives and the complete Lichess game export, with duplicate detection; local PGN and pasted PGN import
- Vite frontend and Tauri 2 desktop shell
- Automated JavaScript tests for chess rules, PGN/RAV round-trips, transpositions and UCI parsing; Windows CI smoke-tests Stockfish and builds the NSIS installer

## Important scope note

This is **not** the recovered 0.7.0 application and is not yet feature-complete against the original roadmap. The following are not implemented in this rebuild:

- FSRS scheduling and review history
- SQLite database backup/export and restore UI
- Dashboard, analytics, goals and exams
- Cloud sync, account system and backups

The old archive fragments remain under `recovery/` for provenance only. They are not build inputs.

The feature roadmap, including the additional training and opponent-preparation ideas, is tracked in [docs/ROADMAP.md](docs/ROADMAP.md). It also records that transposition handling is already implemented in the repertoire graph.

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

Open the local Vite URL printed in the terminal. The Vite build uses relative asset URLs so the compiled frontend also loads from the packaged Tauri WebView. To run the Tauri desktop shell on Windows (including Stockfish analysis), first install the pinned engine and run its UCI smoke test:

```powershell
npm run stockfish:install
npm run stockfish:smoke
npm run tauri:dev
```

To build the Windows NSIS installer on Windows:

```powershell
npm run tauri:build
```

The NSIS installer is configured for a per-user installation (no administrator prompt by default), creates a Start Menu entry, and downloads the small WebView2 bootstrapper if the runtime is missing. The frontend and installer are also checked by the GitHub Actions workflow on pushes and pull requests to `main`.

The latest completed Windows CI run (#134) generated the NSIS installer, installed and launched it, upgraded 0.1.0 to a test 0.1.1 build, verified SQLite data retention across upgrade and uninstall, generated a SHA-256 sidecar, and uploaded the installer/checksum as a 90-day artifact. A separate manual acceptance test on a clean Windows 10/11 VM or PC is still required.

## Stockfish analysis

The Windows desktop build bundles the official **Stockfish 19 x86-64 universal** release. It is downloaded from the official upstream release during the build (not committed to this repository), verified against a pinned SHA-256 digest, and launched as a separate process. Chess OS communicates with it over standard input/output using UCI. The analysis panel displays centipawn or mate evaluations and up to five principal variations; search depth and MultiPV count are configurable. The engine is not launched by the browser preview.

On Windows, install the frontend dependencies and fetch the pinned engine distribution before launching or building the desktop app:

```powershell
npm install
npm run stockfish:install
npm run stockfish:smoke
npm run tauri:dev
```

The CI Windows job runs the same engine smoke test, JavaScript tests, Rust tests and NSIS build. The NSIS package contains `stockfish.exe`, the NNUE network files if supplied by upstream, the GPL-3.0 license and AUTHORS notice. The upstream source is pinned to the `sf_19` tag. See [the Stockfish third-party notice](licenses/stockfish/NOTICE.md) and [GPL license text](licenses/stockfish/Copying.txt).

Stockfish is GPL-3.0. It remains an independent executable and is not linked into Chess OS. Any modified or rebuilt engine binary must be distributed with the exact corresponding source code under the applicable GPL terms.

## Data and SQLite

The Tauri desktop app stores repertoire data in `chess-os.sqlite3` inside the application data directory managed by Tauri. The database has versioned migrations (`schema_migrations`), a repertoire table, normalized position and move-edge tables (so branches and transpositions are retained), app settings, and the tables reserved for training cards and review history. Foreign keys and cascading deletes keep each repertoire graph consistent. The browser preview uses `localStorage` only as a development fallback.

On first desktop startup, Chess OS imports legacy `chess-os.repertoire.v1` entries from WebView `localStorage` that are not already in SQLite. The legacy key is removed only after all entries have imported successfully. To back up a repertoire today, export it as PGN; a full SQLite backup/restore interface is still planned. See [docs/DATABASE.md](docs/DATABASE.md) for the schema and migration details.

## Release preparation

Release checklist, clean-Windows acceptance steps, branch-protection instructions and draft 0.1.0 notes: [docs/RELEASING.md](docs/RELEASING.md) and [docs/releases/v0.1.0.md](docs/releases/v0.1.0.md). The current CI runs an installer upgrade/data-preservation smoke test and produces a SHA-256 sidecar; manual testing on a separate Windows 10/11 machine is still required.

## License

No license has been selected yet. All rights remain with the project owner unless a license is added.

## Chess Lab: account sync, game review and puzzles

Enter your Chess.com and/or Lichess usernames in the Chess Lab and choose **Sincronizza account**. The sync walks the Chess.com monthly archive list and imports public PGNs in sequence; for Lichess it streams the full user-game export (the API's `max` filter is intentionally omitted). Imported games are saved as independent repertoire entries. Repeated syncs skip games already in the archive using a fingerprint of date, players, site and mainline moves. Usernames are kept as a convenience preference in WebView local storage; a Lichess API token is optional for the export and is held only in memory for the request.

Chess.com's official PubAPI is public and read-only: private games and other logged-in-only information are not available through it. Do not enter a Chess.com password. A private Chess.com integration requires an approved authenticated integration from Chess.com; this client does not implement that approval flow. The Lichess export uses its documented user-games endpoint and supports a personal token; never commit or share the token. When the service rate-limits a request, stop and wait before retrying.

In the Windows desktop app, **Analizza archivio** reviews the latest 10, 25, 50 or all saved games. It uses Stockfish at depth 8 for up to 60 half-moves per game, can be interrupted, skips games with an existing saved report, and can be resumed later. The single-game review retains its selectable depth and its 80-half-move cap. Reports include a White-perspective evaluation graph, move-by-move labels, estimated accuracy for each side and puzzle candidates created from mistakes/blunders. When the connected username matches a PGN player header, puzzle candidates are limited to that account's moves; otherwise both sides are eligible.

The displayed accuracy is an **internal estimate** derived from average centipawn loss. It is not the official Chess.com or Lichess accuracy score, and labels such as Brilliant are conservative heuristic annotations rather than claims of equivalence with either platform. Analysis reports are cached locally in WebView storage, separately from the SQLite repertoire database. Generated puzzles open in the existing training board and ask for the best engine move from the position before the mistake.
