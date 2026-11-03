# Chess OS — implementation plan

This plan tracks the fresh **0.1.0 rebuild**. It is intentionally separate from the unrecovered 0.7.0 archive; files in `recovery/` are provenance material and are not build inputs.

## Delivery checklist

- [x] Verify the current repository tree, application entry point, Tauri configuration, tests, and latest GitHub Actions runs.
- [x] Preserve custom PGN starting positions when starting a training session.
- [x] Add regression tests for standard and custom-FEN training sessions.
- [ ] Make frontend tests and Vite production build pass in GitHub Actions.
- [ ] Make the Windows NSIS installer build pass and publish a verified artifact.
- [ ] Complete board interaction: promotion choice, keyboard navigation, and accessible move feedback.
- [ ] Improve repertoire management: edit metadata, duplicate lines, search/filter, and safe deletion.
- [ ] Improve PGN handling: multiple games, validation feedback, annotations, and file import.
- [ ] Complete training: side selection, hints, progress, mistakes, and persisted review history.
- [ ] Add durable local data storage, schema versioning, and export/backup.
- [ ] Add Stockfish UCI integration and analysis controls.
- [ ] Add opening tree/variation navigation and transposition handling.
- [ ] Add analytics, goals, and study dashboard.
- [ ] Add end-to-end tests for the desktop app and Windows packaging.
- [ ] Document installation, troubleshooting, data location, limitations, and release process.

## Current verified baseline

- The repository contains a Vite frontend, a Tauri 2 shell, `chess.js`, and a small Node test suite.
- The current UI supports legal moves, repertoire CRUD in localStorage, PGN text import/export, undo/reset, and line-replay training.
- The latest inspected GitHub Actions run failed in both the frontend and Windows installer jobs. The failure logs were not retrievable through the connected GitHub endpoint, so the root cause is still open.
- A successful Windows installer has **not** yet been verified.
- The original 0.7.0 archive remains incomplete and unrecovered.

## Acceptance rule

A checklist item is marked complete only after its implementation is committed and the relevant automated check or manual verification has a recorded successful result. A workflow being configured is not evidence that the build passes.
