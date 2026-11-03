# Chess OS

Windows-first chess repertoire, analysis and training desktop app. The repository contains a fresh MVP rebuild (0.1.0) because the old 0.7.0 source archive could not be reconstructed from the incomplete recovery fragments.

## Core features

- Interactive chessboard with legal move validation through chess.js, castling, en passant and all four promotion choices.
- PGN import/export with recursive annotation variations, a repertoire graph, branches and position transpositions.
- SQLite persistence for repertoire graphs in the Tauri desktop app; browser preview uses localStorage.
- Training, Blindfold SAN recall, automatic repertoire-error flashcards and FSRS scheduling.
- Review buttons Again / Hard / Good / Easy, per-card history and weakness heatmap.
- Opponent-preparation reports from public PGNs: openings, first moves, early move sequences, results and sample size.
- Full application JSON backup/restore for repertoires, study cards, imported PGNs, opponent report and endgame progress.
- Stockfish 19 Lite local WebAssembly engine for position analysis, best-move sparring, endgame study and tactical-candidate generation.
- Opening Explorer / Gap Finder using imported PGN samples.
- Repertoire generator that merges imported game trees, filters by observed frequency and annotates move frequencies.
- Intelligent annotations on repertoire moves: comments, plans, warnings and NAG move-quality symbols.

## Endgame Lab — 131 lessons in 10 chapters

The Endgame Lab includes a structured curriculum that progresses from foundational king-and-pawn endings to advanced practical and material-imbalance positions:

1. **King and pawn endings:** direct/distant/diagonal opposition, key squares, square rule, zugzwang, triangulation, reserve tempi, breakthroughs, connected and outside passers, rook-pawn exceptions and corresponding squares.
2. **Rook endings:** active rook, rook-behind-the-passer, king cut-offs, Lucena and bridge-building, Philidor, Vancura, lateral/rear checks, rook versus passers, multi-pawn structures and defensive counterplay.
3. **Bishop endings:** same/opposite-coloured bishops, good/bad bishops, bishop versus pawns, blockades, wrong-coloured rook-pawn, two bishops and fortress structures.
4. **Knight endings:** knight versus passer, knight versus rook-pawn, knight versus bishop, knight outposts, connected passers and two-knight limits.
5. **Queen endings:** perpetual check, queen versus rook/pawns, exposed kings, queen trades, passed pawns, queen-and-king mating technique and stalemate resources.
6. **Minor-piece endings:** bishop versus knight, bishop pair, mixed minor pieces, quality imbalances and minor-piece fortresses.
7. **Elementary mates:** queen, rook, two bishops and bishop+knight, including the correct mating corner and the non-forcing nature of two knights versus a bare king.
8. **Practical technique and defence:** fortress recognition, blockades, domination, repetition, stalemate, 50-move rule, king activity, defender exchanges, conversion and clock management.
9. **Advanced endings and studies:** quality imbalances, queen versus two rooks/minors, promotions and underpromotions, pawn structures, triangulation and complex zugzwang.
10. **Classic studies and specialist endings:** Réti, Saavedra, Troitzky, Cochrane, rook-pawn variations, rook versus multiple passers, queen versus rook/pawns, minor-piece blocks, WDL/DTZ interpretation and fortress patterns.

Every lesson includes a learning objective, positional idea, practical method, typical mistake and a study FEN. The Endgame Lab lets the user load/edit any FEN, move pieces on an interactive board, request Stockfish analysis, ask Stockfish to play a move, and query the online Syzygy tablebase.

**Important coverage boundary:** the 111 lessons are a broad educational syllabus, not a manually enumerated solution for every possible endgame position. Syzygy provides exact theoretical results for standard positions with up to seven pieces (including kings) when the online service has coverage; larger positions are analysed by Stockfish rather than described as tablebase-proven. The tablebase is online, not bundled locally, and may rate-limit requests.

## Stockfish and third-party licensing

Chess OS uses the stockfish@19.0.1 npm package and its lightweight, single-threaded WebAssembly worker. The engine runs locally after its JS/WASM assets are copied into public/stockfish. The lightweight build prioritizes compatibility and download size; it is not equivalent to a multi-threaded desktop Stockfish binary.

**Stockfish is GPL-3.0 licensed.** The repository does not currently select a project-wide licence. Before distributing installers or binaries, review the licence obligations for the exact Stockfish package/assets and choose a compatible distribution strategy. See docs/THIRD_PARTY_NOTICES.md.

## Online account imports and data scope

- **Lichess:** public user games can be downloaded in PGN.
- **Chess.com:** public profile archive endpoints are read-only and are requested sequentially.
- Account import does not ask for passwords or OAuth tokens and cannot access private games.
- Opening Explorer percentages describe only the imported sample; they are not global opening-book statistics.
- Public endpoints may return HTTP 429. Chess OS stops and asks the user to retry later rather than bypassing rate limits.
- The Tactics Trainer proposes candidate tactical mistakes from a bounded Stockfish scan. Candidates need human review; they are not presented as certified blunders.
- No cloud sync or login system is included.

## Requirements

- Node.js 20 or newer
- Rust stable with the x86_64-pc-windows-msvc target for desktop builds
- Microsoft C++ Build Tools (MSVC), Windows 10/11 SDK and WebView2 Runtime

## Run locally

Run npm install, then npm test, then npm run dev. The predev and prebuild scripts prepare the local Stockfish WebAssembly assets automatically.

To run the Tauri desktop shell, use npm run tauri:dev. To build the Windows NSIS installer, use npm run tauri:build.

## Persistence and backups

- Repertoire graphs use SQLite in desktop mode and localStorage in the browser preview.
- FSRS cards and review history use SQLite in desktop mode; browser preview uses localStorage.
- Imported PGNs, the last opponent report and Endgame lesson mastery use localStorage in the current MVP.
- Use **Esporta backup completo** to export a portable JSON archive. Restoring merges by record ID and does not delete unrelated local records.
- This JSON backup is an application-level export; it is not a raw copy of the SQLite database file.
- See docs/DATABASE.md and docs/ROADMAP.md.

## License

No project-wide licence has been selected yet. All rights remain with the project owner unless a licence is added. Review docs/THIRD_PARTY_NOTICES.md before distributing builds that include Stockfish.
