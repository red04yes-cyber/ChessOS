# Quality gates — Chess OS

## 3. Stabilità Windows e dati locali

Automated gate in \`.github/workflows/build.yml\`:

- Frontend unit tests and production build.
- Rust / SQLite backend tests.
- Windows NSIS clean installation and first launch.
- In-place 0.1.x upgrade with a SQLite sentinel written before upgrade.
- Verification that the SQLite file and sentinel survive upgrade and uninstallation.
- Installer SHA-256 generation before artifact upload.

Online imports additionally:

- Stream Chess.com monthly PGN archives instead of buffering the full archive.
- Limit each monthly archive to 128 MiB and each game to 5 MiB.
- Persist completed games in batches; a failed stream keeps already committed batches.
- Treat progress events as optional so a Tauri event-listener ACL issue does not block imports.
- Restrict Chess.com archive URLs to the official HTTPS host and expected path.

## 4. UX, accessibility and performance

Automated coverage:

- Each main-board square has an Italian accessible name, including the piece type, colour and coordinate.
- Keyboard focus is visible on standard interactive controls.
- CSS honours \`prefers-reduced-motion: reduce\`.

Manual Windows/WebView2 acceptance still required:

1. At 1080×720, 1440×940 and 1920×1080, check for clipped controls and horizontal overflow.
2. Use Tab / Shift+Tab through navigation, forms, board squares, dialogs and menus; ensure focus remains visible.
3. With Narrator, confirm each square is announced as an Italian piece/square name and board status changes are announced politely.
4. Check that promotions and import/FEN dialogs open, close, and return focus correctly.
5. Compare mouse, touch and keyboard board navigation; test castling, en passant, capture and all promotion choices.
6. Enable Windows reduced-motion preference and confirm board/status transitions do not animate.
7. Confirm that analysis is performed by the local worker and that the interface remains responsive while Stockfish calculates.

## 5. Stockfish and advanced study tools

Automated parser tests cover:

- Centipawn and forced-mate score lines.
- MultiPV selection of the principal line.
- UCI-to-SAN conversion for legal principal variations.
- Truncated/illegal PV handling and the engine's \`(none)\` best-move response.

Manual chess acceptance still required:

1. Analyse the initial position and a forced-mate test position; compare the displayed best move and score with the engine output.
2. Confirm depth and MultiPV limits do not allow unbounded user inputs.
3. Run Opening Explorer / Gap Finder on a small PGN sample and verify move frequencies and missing branches.
4. Confirm Tactical Trainer candidates are described as heuristic suggestions, not certified puzzles.
5. Disconnect the network and confirm the local Stockfish worker continues to operate once app assets are installed.
