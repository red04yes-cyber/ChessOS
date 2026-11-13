# Quality gates — Chess OS

## Dipendenze riproducibili

- `package-lock.json` e `src-tauri/Cargo.lock` sono versionati.
- La pipeline installa Node con `npm ci` e verifica il grafo Rust con `--locked`.
- Ogni modifica a `package.json` o `Cargo.toml` deve aggiornare il relativo lockfile nello stesso commit.
- Gli aggiornamenti vanno eseguiti intenzionalmente, verificando il diff dei lockfile e rieseguendo gli audit.

## Verifiche automatizzate

Ogni pull request verso `main` esegue:

1. Test JavaScript e build Vite di produzione.
2. `npm audit --audit-level=high` e `cargo audit` (CLI `cargo-audit` installata a versione fissata).
3. `cargo fmt --check` su tutti i sorgenti Rust, Clippy con warning bloccanti e test Rust/SQLite con `--locked`. Il controllo usa il toolchain stable installato dal job Windows.
4. Test end-to-end Chromium su scacchiera, input da tastiera, importazione PGN, persistenza locale e dialogo.
5. Build Windows NSIS e smoke test d'installazione, avvio, upgrade e persistenza SQLite.

Gli audit non sostituiscono gli aggiornamenti: un avviso non bloccante va valutato e documentato, non ignorato implicitamente.

## Accessibilità

La scacchiera espone nomi accessibili per ogni casa e usa un solo punto di ingresso Tab con navigazione tramite frecce. I cambi di turno e lo stato della partita sono annunciati tramite regioni `status`/`aria-live`.

I test Playwright verificano etichette, movimento da tastiera, annuncio del turno, dialogo modale, chiusura con Escape e ripristino del focus. Prima di una release resta necessario un controllo manuale con Narrator su Windows/WebView2: gli screen reader nativi non sono simulati da Chromium.

## Sicurezza Tauri

La Content Security Policy:
- limita gli script a risorse locali e `wasm-unsafe-eval` (necessario per WebAssembly);
- limita `worker-src` a risorse locali e `blob:` per il worker Stockfish;
- imposta `base-uri 'self'` e `object-src 'none'`;
- non abilita origini remote o wildcard in `connect-src`.

La capability è confinata alla finestra `main` e concede soltanto le autorizzazioni richieste per eventi, updater e riavvio controllato. I test statici falliscono se CSP o capability si allargano inaspettatamente.

## Pubblicazione release

Il push di un tag `v*` può eseguire le verifiche e produrre l'installer, ma non pubblica automaticamente una release. La pubblicazione richiede un `workflow_dispatch` sul tag, la conferma testuale esatta `PUBBLICA vX.Y.Z` e l'approvazione dell'environment protetto `release`.

La protezione dell'environment (required reviewer) deve essere configurata nelle impostazioni GitHub del repository: il workflow non può crearla tramite YAML.
