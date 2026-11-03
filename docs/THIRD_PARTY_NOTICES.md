# Third-party notices

## Stockfish 19 Lite / stockfish.js

Chess OS depends on the npm package stockfish version 19.0.1 and bundles its single-threaded lightweight WebAssembly engine assets.

- Engine project: https://stockfishchess.org/
- WebAssembly port: https://github.com/nmrugg/stockfish.js
- Upstream engine source: https://github.com/official-stockfish/Stockfish
- Pinned npm package: https://www.npmjs.com/package/stockfish/v/19.0.1
- Engine files: stockfish-19-lite-single.js and stockfish-19-lite-single.wasm
- Licence: GNU General Public License v3.0 (GPL-3.0).

The engine worker and matching WASM file are copied from node_modules/stockfish/bin by scripts/prepare-engine.js into public/stockfish. The complete GPL-3.0 text is included in licenses/Stockfish-GPL-3.0.txt and copied to public/stockfish/COPYING.txt so it is shipped with frontend and desktop builds.

The Stockfish engine assets are third-party binaries generated from the stockfish.js and Stockfish source projects. Before publishing installers or binaries, review the full GPL-3.0 terms, including the requirements for providing Corresponding Source and installation information where applicable. The source repositories and pinned npm package above identify the code used to prepare the bundled engine. This notice is attribution and documentation, not legal advice.

## Other dependencies

The project also uses chess.js, ts-fsrs, Vite and Tauri. Refer to the installed package metadata and their upstream repositories for the applicable licences.
