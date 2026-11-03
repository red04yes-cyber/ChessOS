# Chess OS — MVP implementation roadmap

This roadmap describes the current **0.1.0 rebuild**. It does not claim that the incomplete historical 0.7.0 archive has been recovered; files under `recovery/` are provenance material only.

## Current MVP baseline

- [x] Legal chess moves and position validation through `chess.js`.
- [x] Board interaction, promotion choice, move navigation, board rotation and FEN copy.
- [x] Repertoire graph with variations, transpositions, PGN import/export and SQLite persistence in the Tauri app.
- [x] Training replay from the repertoire's actual root FEN, including custom PGN `SetUp`/`FEN` positions.
- [x] Regression tests for standard and custom-position training sessions.
- [x] Versioned SQLite schema and localStorage-to-SQLite migration.
- [ ] Verified Windows NSIS installer artifact and end-to-end install/launch/uninstall test.
- [ ] Public GitHub Release with checksums and release notes.

## Next product milestones

### Repertoire workflow
- [ ] Edit repertoire metadata and duplicate lines.
- [ ] Search and filter saved repertoires.
- [ ] Confirm destructive actions and improve recovery from malformed imports.
- [ ] Support multi-game PGN import with per-game validation feedback.

### Training
- [ ] Choose training side and support both sides / full-line replay.
- [ ] Add hints, progress feedback and mistake tracking.
- [ ] Persist training history and review scheduling (FSRS).
- [ ] Add training tests covering promotions, black-to-move custom FENs, variations and interrupted sessions.

### Analysis and study
- [ ] Integrate Stockfish UCI analysis and evaluation controls.
- [ ] Add opening explorer / opening-tree data and richer variation navigation.
- [ ] Add dashboard, study goals, analytics and exams.

### Reliability and delivery
- [ ] Complete Windows installer CI, inspect uploaded artifacts and publish SHA-256 checksums.
- [ ] Test install, first launch, WebView2 bootstrapper behavior, upgrade and uninstall on a clean Windows environment.
- [ ] Configure Authenticode signing when a certificate and GitHub secrets are available.
- [ ] Add end-to-end desktop tests and documented backup / restore procedures.
- [ ] Document installation, troubleshooting, local data paths, limitations and release process.

## Verification policy

A checkbox is marked complete only when the feature is implemented and the relevant automated or manual verification has a recorded successful result. A configured workflow is not evidence of a successful build. CI status and release availability must be checked from the current GitHub Actions run and release page before claiming success.

## Known scope limits

The rebuild is a fresh 0.1.0 application, not a feature-complete replacement for the unrecovered 0.7.0 release. Cloud sync, accounts, remote backups and the full historical feature set are not currently implemented.
