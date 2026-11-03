# Quality gates — Chess OS

## Lockfile e riproducibilità

`package-lock.json` e `src-tauri/Cargo.lock` sono versionati. Ogni modifica a `package.json` o `Cargo.toml` deve aggiornare il relativo lockfile nello stesso commit. La CI installa il grafo Node con `npm ci` e usa il lockfile Rust versionato.

Per aggiornare le dipendenze in modo intenzionale:
- Node: `npm install`, verifica il diff di `package-lock.json`, poi `npm audit --audit-level=high`.
- Rust: `cargo update --manifest-path src-tauri/Cargo.toml`, verifica il diff di `src-tauri/Cargo.lock`, poi `cargo audit --file src-tauri/Cargo.lock`.

## CI obbligatoria

- Node 22, `npm ci`, test JavaScript e build di produzione.
- `npm audit --audit-level=high` per l'intero grafo Node.
- `cargo audit` sul lockfile Rust.
- `cargo fmt --check`, Clippy con warning bloccanti e test Rust/SQLite.
- Playwright/Chromium per interazione scacchiera, movimento da tastiera, importazione PGN, salvataggio locale e dialogo.
- Build installer Windows, test di installazione pulita, avvio, upgrade e persistenza SQLite.

## Avvisi attuali del grafo Rust

L'ultima scansione del lockfile ha completato `cargo audit` senza advisory bloccanti, ma ha riportato due avvisi transitive da valutare durante gli aggiornamenti:
- `proc-macro-error 1.0.4`, segnalato come non mantenuto: [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370).
- `glib 0.18.5`, segnalato per unsoundness in `VariantStrIter`: [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429).

Non vengono soppressi con una whitelist: gli avvisi restano visibili nel log dell'audit e vanno riesaminati dopo gli aggiornamenti di Tauri/GTK. Sono distinti dalle vulnerabilità ad alta gravità che fanno fallire il gate.

## Accessibilità e test manuali Windows/WebView2

La base principale contiene già:
- etichette italiane per case occupate e vuote;
- una sola casa nel ciclo Tab, frecce per spostare il focus e Invio/Spazio per selezionare;
- dialoghi modali con focus trap e ripristino del focus;
- stato dei messaggi con `aria-live`.

I test Playwright verificano etichette, tab stop singolo, navigazione con frecce, apertura e chiusura del dialogo, ma non simulano uno screen reader nativo. Prima della release verificare con Narrator su Windows/WebView2:

1. Annuncio di tipo pezzo, colore e coordinata; annuncio della coordinata per le case vuote.
2. Navigazione con Tab/Shift+Tab e frecce, Enter e Spazio; focus visibile dopo mosse e rotazione.
3. Annuncio del turno e dello stato partita senza ripetizioni eccessive.
4. Dialoghi di promozione, importazione e FEN: Escape, focus trap e ritorno del focus.
5. Zoom 200%, contrasto, riduzione movimento e dimensioni 1080×720, 1440×940, 1920×1080.

## CSP e capability Tauri

La CSP consente asset locali, WebAssembly e IPC Tauri. `connect-src` mantiene una allowlist esplicita delle sole tre origini HTTPS effettivamente chiamate dal frontend (`https://lichess.org`, `https://api.chess.com`, `https://tablebase.lichess.ovh`), oltre a `'self'` e IPC Tauri. Non sono ammessi wildcard né host remoti generici; ogni nuova origine richiede una modifica esplicita e un test.

La capability della finestra `main` concede soltanto `core:event:allow-listen` e `core:event:allow-unlisten`, necessari per gli eventi di avanzamento dell'importazione. I test in `tests/tauri-security.test.js` falliscono se vengono aggiunti wildcard, origini remote o permessi Tauri non previsti.

## Limiti della verifica automatica

Playwright usa Vite in modalità browser e verifica la persistenza del fallback `localStorage`. Non sostituisce l'esecuzione in Tauri WebView2, l'importazione con account reali Chess.com/Lichess o il collaudo Narrator. Questi restano gate di release.
