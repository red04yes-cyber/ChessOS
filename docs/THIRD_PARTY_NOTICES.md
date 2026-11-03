# Third-party notices

## Stockfish 19 Lite

ChessOS includes the Stockfish 19 Lite single-thread WebAssembly engine through the pinned `stockfish@19.0.1` npm dependency.

- Project: https://stockfishchess.org/
- Source repository: https://github.com/official-stockfish/Stockfish
- License: GNU General Public License v3.0 (GPL-3.0)
- Included license text: [../licenses/Stockfish-GPL-3.0.txt](../licenses/Stockfish-GPL-3.0.txt)

The engine worker and WebAssembly binary are copied from the installed npm package into `public/stockfish` by `scripts/prepare-engine.js` before local development and production builds. They run locally in the desktop WebView; ChessOS does not send analysis positions to a remote engine service.

The package's corresponding upstream source and license remain available from the links above. The Stockfish component is distributed under its own license; this notice does not grant a project-wide license to ChessOS source code.

## Lichess opening catalogue

The offline ECO opening catalogue is derived from the `lichess-org/chess-openings` project. The pinned source snapshot, dataset scope and CC0 dedication are documented in [OPENING_STUDIO.md](OPENING_STUDIO.md).
