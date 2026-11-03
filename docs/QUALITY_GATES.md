# Quality gates — Chess OS

## Lockfile e riproducibilità

`package-lock.json` e `src-tauri/Cargo.lock` sono versionati. Ogni modifica a `package.json` o `Cargo.toml` deve aggiornare il relativo lockfile nello stesso commit. CI usa `npm ci` e `cargo` con `--locked` dove applicabile; non rigenera silenziosamente le dipendenze durante test e build.

Per aggiornare le dipendenze in modo intenzionale:
- Node: `npm install`, verificare il diff di `package-lock.json`, poi eseguire `npm audit --audit-level=high`.
- Rust: `cargo update --manifest-path src-tauri/Cargo.toml`, verificare il diff di `src-tauri/Cargo.lock`, quindi eseguire `cargo audit --file src-tauri/Cargo.lock`.

## CI obbligatoria

- Node 22 con `npm ci` da `package-lock.json` versionato.
- `npm audit --audit-level=high` sulla stessa risoluzione bloccata usata dalla build.
- `cargo audit` su `src-tauri/Cargo.lock` versionato.
- `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` e `cargo test`.
- Test browser Playwright su Chromium per movimento da tastiera, nomi accessibili, importazione PGN, persistenza browser e apertura/chiusura del dialogo.
- Build frontend e installer Windows con smoke test di installazione, avvio e conservazione di SQLite.

## Accessibilità da accettare manualmente su Windows / WebView2

I test browser non sostituiscono il collaudo con tecnologie assistive. Prima di una release verificare:

1. Navigazione completa con Tab e Shift+Tab; la scacchiera deve essere un singolo punto di ingresso e le frecce devono spostare il focus tra le case.
2. Enter e Spazio devono attivare la casa focalizzata; il focus deve restare visibile dopo una mossa e quando la scacchiera viene ruotata.
3. Con Narrator, verificare che ogni casa annunci il nome del pezzo, il colore e la coordinata; le case vuote devono annunciare la coordinata.
4. Verificare che il cambio di turno e lo stato della partita siano annunciati senza letture ripetitive.
5. Provare promozione, importazione e editor FEN con tastiera, chiusura via Escape e ritorno del focus.
6. Verificare contrasto, zoom 200%, riduzione animazioni e dimensioni 1080×720, 1440×940 e 1920×1080.

## CSP e capability Tauri

La CSP consente gli asset locali, il WebAssembly di Stockfish e il canale IPC locale di Tauri. `connect-src` non autorizza host Internet; le richieste verso Chess.com, Lichess o tablebase devono essere effettuate da comandi Rust, non sbloccate con un wildcard o una lista generica di domini nella WebView.

La capability della finestra `main` concede soltanto `core:event:allow-listen` e `core:event:allow-unlisten`, necessari per gli aggiornamenti di avanzamento. Non viene usato `core:default` per evitare permessi plugin aggiuntivi non necessari.

Le asserzioni automatiche in `tests/tauri-security.test.js` falliscono se la CSP o la lista di capability si allargano involontariamente.

## Limiti della verifica automatica

Playwright usa Vite in modalità browser e verifica i flussi frontend con `localStorage`. Non sostituisce le prove manuali nell'app Tauri WebView2, l'importazione con account Chess.com/Lichess reali o il test Narrator. Questi restano gate di release.
