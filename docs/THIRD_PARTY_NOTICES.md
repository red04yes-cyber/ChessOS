# Third-party notices

## Stockfish 19 Lite

Chess OS depends on the npm package stockfish version 19.0.1 and bundles its single-threaded lightweight WebAssembly engine assets into the desktop/browser application.

- Project: https://stockfishchess.org/
- Source: https://github.com/official-stockfish/Stockfish
- NPM package: https://www.npmjs.com/package/stockfish
- License declared by the upstream Stockfish package/source: GNU General Public License v3.0 (GPL-3.0).

The engine is copied from node_modules/stockfish/bin into public/stockfish by scripts/prepare-engine.js during the predev/prebuild lifecycle. The JavaScript worker and WebAssembly binary are distributed with the application build.

Before publishing installers or binaries, review the full GPL-3.0 text, source-code offer/source availability requirements and compatibility with the intended distribution model. The Chess OS repository itself has not selected a project-wide licence. This file is an attribution notice, not legal advice and not a substitute for including all required licence texts and notices in a release package.
