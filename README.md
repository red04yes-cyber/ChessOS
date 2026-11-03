# Chess OS

Windows-first desktop application for chess repertoire study, training, spaced repetition, and engine-assisted analysis.

## Current repository status

This repository currently contains project documentation and bootstrap scaffolding. The full application source tree from version 0.7.0 has **not yet been committed**. This README is not a claim that the app can already be built from this checkout.

## Planned modules

- SQLite persistence and schema migrations
- Repertoire manager with PGN import, RAV variations, and transpositions
- Interactive training board with legal move handling
- FSRS spaced-repetition scheduler
- Stockfish UCI engine integration
- Dashboard, learning analytics, goals, and exams
- Tauri desktop packaging for Windows

## Development

The source archive must first be extracted into the repository root. Then install dependencies and run the checks defined by the project's package scripts. Treat the Windows installer as unavailable until a successful Windows CI build produces and verifies the artifact.

## License

No license has been selected yet. All rights remain with the project owner unless a license is added.
