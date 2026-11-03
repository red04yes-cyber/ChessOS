# Release and repository administration checklist

This document describes the remaining owner-controlled steps for a public Chess OS release.

## Current status

- [x] JavaScript tests and production frontend build pass on GitHub Actions.
- [x] Rust/SQLite tests pass on Windows CI.
- [x] NSIS installer builds and is uploaded by GitHub Actions.
- [x] CI actions are pinned to Node 24-compatible releases.
- [ ] Windows installer smoke test is automated: baseline install, app launch, test-only patch upgrade, SQLite sentinel preservation, uninstall and data-retention check; first run pending.
- [ ] Verify the 90-day installer artifact and separate SHA-256 file on the next successful CI run.
- [ ] Re-run and confirm the new install/upgrade/uninstall smoke test on the latest `main`.
- [ ] Test on a separate clean Windows 10/11 VM or physical PC, including WebView2 bootstrapper behavior.
- [ ] Choose and add the project licence.
- [ ] Configure branch protection for `main`.
- [ ] Publish GitHub Release with the installer and checksum.
- [ ] Confirm a backup copy of the release assets is stored outside the 90-day Actions artifact.

## Manual clean-Windows acceptance

Use a fresh Windows 10/11 VM or PC that has not been used for development:
1. Download the installer and the matching `.sha256` file from the release.
2. Verify the installer checksum before running it.
3. Install as a standard user, without administrator privileges.
4. Launch Chess OS and create/save a repertoire.
5. Close and reopen the app; confirm the repertoire is still present.
6. Install the next version over the existing installation; confirm the repertoire remains.
7. Uninstall Chess OS; confirm the user database remains in the Tauri application-data directory.
8. Reinstall and confirm the repertoire can still be opened.

The GitHub-hosted Windows runner is an ephemeral CI image, but it is not a substitute for this separate end-user acceptance test.

## Protecting the `main` branch

The repository's `main` branch currently reports `protected: false`. The connected GitHub integration can inspect settings but does not expose a write operation for branch protection/rulesets. An owner/admin must enable this in GitHub:

1. Open **Settings → Rules → Rulesets → New branch ruleset** (or **Settings → Branches → Add branch protection rule**).
2. Target branch `main`, set enforcement to **Active**.
3. Require a pull request before merging. Keep required approving reviews at 0 if this is a single-maintainer project; add approvals when collaborators are available.
4. Require these status checks:
   - `Frontend tests and production build`
   - `Windows NSIS installer`
5. Require the branch to be up to date before merging.
6. Block force pushes and branch deletion.
7. Save, then open a small test PR and verify that merging is blocked until both checks pass.

Do not mark this item complete based only on saving the settings; verify the checks are enforced on a test PR.

## Choosing the project licence

No licence file currently exists. The repository is public, but visibility alone does not grant permission to reuse, modify or redistribute its code.

- **MIT**: short and permissive; allows reuse and redistribution with the copyright and licence notice.
- **Apache-2.0**: permissive with an explicit patent grant and additional notice requirements.
- **GPL-3.0-or-later**: copyleft; distributed derivative works must comply with the GPL.

The owner must select the intended model before a `LICENSE` file is added. Stockfish, if distributed in a future build, remains a separately licensed component with its own notices and obligations.

## Publishing the GitHub Release

1. Confirm the latest `main` workflow is green and its artifact includes both `.exe` and `.sha256`.
2. Run the clean-Windows manual acceptance test.
3. Add the selected `LICENSE` file and verify all third-party notices.
4. Create tag `v0.1.0` on the exact tested commit.
5. Create a GitHub Release from that tag and paste `docs/releases/v0.1.0.md`.
6. Attach the installer and its matching checksum file.
7. Verify the published asset checksum after download.
8. Store a second copy of the installer, checksum and release notes in a durable backup location.

The release-notes file is a draft, not a published GitHub Release.
