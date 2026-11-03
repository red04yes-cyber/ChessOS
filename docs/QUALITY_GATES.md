# Quality gates — Chess OS

## 3. Stabilità Windows e dati locali

Gate automatizzati in `.github/workflows/build.yml`:

- Test frontend e build di produzione.
- Test Rust / SQLite.
- Installazione NSIS pulita e primo avvio su Windows.
- Aggiornamento 0.1.x con un record sentinella SQLite scritto prima dell'upgrade.
- Verifica che database e record sentinella sopravvivano all'upgrade e alla disinstallazione.
- Generazione SHA-256 dell'installer prima del caricamento dell'artifact.

Importazioni online:

- Streaming degli archivi PGN mensili Chess.com, senza caricare l'intero archivio in memoria.
- Limite di 128 MiB per archivio e 5 MiB per singola partita.
- Salvataggio a blocchi delle partite complete; un errore di rete conserva i blocchi già confermati.
- Gli eventi di avanzamento sono opzionali: un problema ACL Tauri non blocca l'importazione.
- Gli URL degli archivi Chess.com sono limitati all'host HTTPS ufficiale e al percorso previsto.

## 4. UX, accessibilità e prestazioni

Copertura automatizzata:

- Ogni casa della scacchiera principale ha un nome accessibile in italiano, con tipo e colore del pezzo e coordinata.
- Il focus da tastiera è visibile sui controlli interattivi standard.
- Il CSS rispetta `prefers-reduced-motion: reduce`.

Accettazione manuale ancora necessaria su Windows/WebView2:

1. A 1080×720, 1440×940 e 1920×1080, controllare tagli dei controlli e scroll orizzontale.
2. Percorrere navigazione, moduli, case, dialoghi e menu con Tab e Shift+Tab; verificare che il focus sia sempre visibile.
3. Con Narrator, controllare che ogni casa venga annunciata con nome italiano e che i cambi di stato siano annunciati senza eccessi.
4. Verificare apertura/chiusura dei dialoghi di promozione, importazione e FEN, incluso il ritorno del focus.
5. Confrontare mouse, touch e tastiera; provare arrocco, en passant, cattura e tutte le promozioni.
6. Attivare la preferenza Windows per ridurre le animazioni e verificare che transizioni e animazioni siano disattivate.
7. Verificare che Stockfish lavori nel worker locale e che la UI resti reattiva durante il calcolo.

## 5. Stockfish e strumenti avanzati

Test automatici del parser:

- Valutazioni in centipawn e posizioni di matto forzato.
- Selezione della linea principale MultiPV.
- Conversione UCI-SAN delle varianti legali.
- Gestione di varianti troncate/non legali e della risposta `(none)` del motore.

Accettazione scacchistica manuale ancora necessaria:

1. Analizzare la posizione iniziale e una posizione di matto forzato; confrontare miglior mossa e valutazione con l'output del motore.
2. Verificare che profondità e MultiPV restino entro i limiti previsti.
3. Provare Opening Explorer / Gap Finder con un piccolo campione PGN e verificare frequenze e rami mancanti.
4. Confermare che Tactical Trainer presenti gli esercizi come candidati euristici, non come puzzle certificati.
5. Disconnettere la rete e verificare che il worker Stockfish locale funzioni quando gli asset sono installati.

6. Analizzare un PGN con una mossa corretta e una mossa che perde almeno 2 pedoni; verificare che il report non segnali la mossa già preferita dal motore e mostri la variante.
7. Completare una sessione di flashcard dagli errori: verificare deduplicazione per posizione, persistenza dopo riavvio e intervalli Again/Hard/Good/Easy. Confermare che il mazzo è nel localStorage WebView e non nel database SQLite.
8. Avviare Blindfold con un repertorio contenente almeno una mossa per lato; controllare che la posizione non sia visibile prima della risposta e che la scacchiera della soluzione compaia dopo risposta corretta o reveal.
9. Allenare alcune carte di una linea e controllare che la heatmap usi solo il repertorio attivo, distingua errori e scadenze e lasci non misurabili le posizioni senza cronologia.
10. Preparare un avversario usando PGN con nome, Date, Opening e Result; verificare filtro del nome, intervallo date, colori, risultati e che le percentuali riflettano solo le partite importate.


## Aggiornamenti e pubblicazione

- Il plugin Tauri updater viene inizializzato con la capability `updater:default`.
- I test frontend verificano check senza update, download, chiusura dopo errore e installazione solo quando l'app è sicura da riavviare.
- Le release firmate usano `src-tauri/tauri.release.conf.json`, il bundle NSIS e il manifest statico `latest.json`.
- La chiave privata è richiesta esclusivamente tramite secret GitHub Actions; la chiave pubblica resta nella configurazione di release.
- Il push di un tag esegue solo CI. La pubblicazione richiede un avvio manuale su quel tag e la conferma esatta `PUBBLICA vX.Y.Z`.
- Le installazioni precedenti al plugin updater richiedono una prima installazione manuale della build aggiornata; gli aggiornamenti successivi sono automatici.
