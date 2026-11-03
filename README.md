# Chess OS

Windows-first chess repertoire, analysis and training desktop app. This repository contains a fresh MVP rebuild (0.1.0); it is not a recovery of the old 0.7.0 source archive.

## Core Studio

- Interactive 8×8 chessboard with legal move validation through chess.js, castling, en passant and all four promotion choices.
- PGN import/export with recursive annotation variations (RAV), repertoire graph, branch navigation and position transpositions.
- SQLite persistence in the Tauri desktop app, with localStorage for browser preview.
- Move-by-move navigation, undo/redo, board rotation, FEN copy and game status.
- Move annotations for strategic plans, comments, warnings and PGN NAG symbols.

## Daily repertoire training

The existing FSRS-6 daily scheduler on main remains the primary repertoire review system:
- Again / Hard / Good / Easy ratings and daily sessions.
- Review history, card due dates, recall accuracy and session counters.
- Atomic SQLite persistence for daily study cards, review logs and training sessions in desktop mode.
- Browser preview uses localStorage.

The new error/concept flashcard queue is a separate FSRS deck; it does not replace or alter the existing daily FSRS-6 repertoire review model.

## Extended study modules

- **Automatic flashcards:** create recall cards when a PGN deviates from a saved repertoire continuation at a known position, and from mistakes made in Blindfold. Deviating from an opening repertoire is not automatically a chess-engine blunder.
- **Blindfold:** hide the main Studio board and notation, enter moves in SAN, and turn incorrect recalls into FSRS cards.
- **Weakness heatmap:** positions with cards are classified as weak, learning or stable using due dates and review history; positions without evidence remain unmeasured.
- **Opponent preparation:** analyse imported PGNs for opening labels, first moves and early move sequences, results and sample size.
- **Transposition explorer:** compare distinct move orders reaching the same graph node and navigate directly to each path.

## Stockfish, sparring and tactics

- Stockfish 19 Lite runs locally as a single-threaded WebAssembly worker.
- Analyse the active Studio position and show the best move and principal variation.
- Opening Sparring: play against Stockfish with selectable colour and playing strength.
- Endgame Sparring: play a selected final position against Stockfish, with automatic replies.
- Tactics Trainer: a bounded engine scan samples imported game positions and proposes candidates where the played move differs materially from the engine move. Candidates require human review; they are not certified blunders or a curated puzzle database.

## Opening preparation and repertory building

- **Chess.com and Lichess public imports:** download public user games without passwords or OAuth. Private games are not accessible.
- Chess.com monthly archives are requested sequentially; HTTP 429 stops the import rather than bypassing service limits.
- **Opening Explorer / Gap Finder:** calculate move frequencies from the user's imported sample and flag observed moves not represented in the active repertoire.
- **Repertoire generator:** merge imported game trees, filter by minimum observed frequency and depth, and annotate the resulting lines with sample frequencies. Review the generated tree before saving it.

Opening percentages are descriptive of the imported PGN collection, not global opening-book statistics.

## Endgame Lab — 131 lessons in 10 chapters

The Endgame Lab contains a broad structured curriculum:

1. **King and pawn endings:** direct/distant/diagonal opposition, key squares, square rule, zugzwang, triangulation, reserve tempi, breakthroughs, connected and outside passers, rook-pawn exceptions and corresponding squares.
2. **Rook endings:** active rook, rook-behind-the-passer, king cut-offs, Lucena and bridge-building, Philidor, Vancura, lateral/rear checks, rook versus passers and pawn majorities.
3. **Bishop endings:** same/opposite-coloured bishops, good/bad bishops, blockades, wrong-coloured rook-pawn, bishop pair and fortresses.
4. **Knight endings:** knight versus passer, rook-pawn limitations, outposts, knight versus bishop, connected passers and two-knight limits.
5. **Queen endings:** perpetual check, queen versus rook/pawns, exposed kings, queen trades, passed pawns, mating technique and stalemate resources.
6. **Minor-piece endings:** bishop versus knight, bishop pair, mixed minor pieces, quality imbalances and fortresses.
7. **Elementary mates:** queen, rook, two bishops, bishop+knight and the non-forcing nature of two knights against a bare king.
8. **Practical technique and defence:** fortresses, blockades, domination, repetition, stalemate, 50-move rule, active king, exchanges and conversion.
9. **Advanced endings and studies:** material imbalances, promotions, underpromotions, pawn structures, triangulation and complex zugzwang.
10. **Specialist endings and classic studies:** Réti, Saavedra, Troitzky, Cochrane, rook-pawn variations, advanced rook endings, queen versus rook/pawns, fortresses and WDL/DTZ interpretation.

Every lesson includes a focus, objective, practical method, typical mistake and study FEN. The lab supports:
- editable FEN input and an interactive chessboard;
- Stockfish analysis and engine moves;
- practice games against Stockfish from the selected final position;
- online Syzygy tablebase probing where the provider covers the position;
- user-marked lesson mastery;
- creating an FSRS concept card from any lesson.

**Coverage boundary:** 131 lessons form a broad curriculum, not an exhaustive catalogue of every possible endgame position. Syzygy returns theoretical results for covered standard positions with up to seven pieces total, kings included; positions outside that coverage use Stockfish evaluation, not a tablebase-proven result. Mastery is user-marked, not inferred from merely opening a lesson or querying a tablebase.

## Backup and restore

The portable JSON application backup contains:
- repertoire records and move graphs;
- the existing daily FSRS-6 cards, review logs and training sessions;
- extended error/concept flashcards and their FSRS history;
- imported PGN collections and opponent reports;
- Endgame lesson progress.

Restore validates the file and merges records by ID without deleting unrelated local records. This is an application-level backup, not a raw byte-for-byte copy of the SQLite database and its WAL files.

## Persistence

- Repertoires, daily FSRS-6 cards, review logs and training sessions use SQLite in the Tauri desktop app.
- Extended error/concept cards, imported PGNs, opponent reports and Endgame progress use the existing SQLite `app_settings` store in desktop mode.
- Browser preview uses localStorage for both groups.
- No cloud sync or account system is included.

See [docs/DATABASE.md](docs/DATABASE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Requirements and local development

- Node.js 20 or newer.
- Rust stable with the `x86_64-pc-windows-msvc` target for desktop builds.
- Microsoft C++ Build Tools (MSVC), Windows 10/11 SDK and WebView2 Runtime.

Install dependencies, run the tests and start the app:

```sh
npm install
npm test
npm run dev
```

The `predev` and `prebuild` scripts prepare Stockfish WebAssembly assets. To run the Tauri desktop shell:

```sh
npm run tauri:dev
```

To build the Windows NSIS installer:

```powershell
npm run tauri:build
```

## Third-party licensing

Stockfish 19 Lite and its WebAssembly worker are GPL-3.0 licensed. The complete license text is included at [licenses/Stockfish-GPL-3.0.txt](licenses/Stockfish-GPL-3.0.txt) and copied into the prepared engine assets. Before distributing installers, review the GPL obligations for the bundled engine and its corresponding source. See [docs/THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md).

No project-wide licence has been selected for ChessOS. All rights remain with the project owner unless a licence is added.
