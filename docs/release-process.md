# Release process

Chess OS does not create a new version for routine commits, small fixes, or work in progress. Collect related improvements into a meaningful release. Before changing the app version or creating a `vX.Y.Z` tag, ask the owner whether they want to make a release and wait for an explicit yes.

When approved, update the version consistently in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; write `docs/releases/vX.Y.Z.md`; then create and push the matching `vX.Y.Z` tag. The tag workflow verifies the app, builds the installer, signs the updater bundle, and publishes the GitHub Release. Ordinary pushes and pull requests never publish a release.

The Windows updater checks when the app opens and every six hours while it remains open. It downloads a signed update, installs it in passive mode, and restarts Chess OS. The first release containing the updater still needs to be installed manually by users whose app predates updater support.

## GitHub Actions secrets

Store the Tauri signing key as the repository Actions secret `TAURI_SIGNING_PRIVATE_KEY`. If a password is used for the key, store it as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The matching public key is committed in `src-tauri/tauri.conf.json`; never commit or publish the private key.
