# Chess OS — database SQLite

## File e ownership

Nel desktop Tauri la connessione viene aperta una volta all'avvio. Il file chess-os.sqlite3 viene creato nella directory dati applicazione indicata da app.path().app_data_dir(); non viene scritto nel repository. SQLite usa foreign key, WAL e un timeout di lock di 5 secondi.

La preview Vite nel browser continua a usare localStorage perché non ha accesso al backend Rust. L'app desktop usa SQLite sia per i repertori sia per il ripasso FSRS-6 e per i dati persistenti dei moduli avanzati.

## Schema e migrazioni

Le migrazioni sono registrate in schema_migrations e vengono eseguite in ordine, in transazioni:

- **v1**: repertoires, repertoire_positions, repertoire_moves, app_settings, study_cards, training_sessions e review_logs.
- **v2**: indici per repertori aggiornati, ricerca delle posizioni, navigazione delle mosse e selezione delle carte dovute.
- **v3**: study_cards.fsrs_json per conservare lo stato serializzato completo del scheduler FSRS-6 e un indice composto per lato e scadenza.

Le posizioni sono memorizzate separatamente dalle mosse: ordini differenti che arrivano alla stessa posizione possono puntare allo stesso nodo e conservare più archi entranti. Gli archi mantengono ordine, UCI, SAN, NAG e commento.

## Ripasso giornaliero FSRS-6

La coda giornaliera esistente usa le tabelle strutturate:
- study_cards: una carta collegata al repertorio e all'arco da ripassare, con lato, scadenza, stabilità, difficoltà, reps, lapses, stato e fsrs_json.
- review_logs: valutazione, sessione, tempo di risposta, intervallo programmato e stato serializzato al momento del ripasso.
- training_sessions: data inizio/fine, lato, carte viste, risposte corrette e Again.

Il comando record_study_review aggiorna la carta, aggiunge il log e aggiorna i contatori della sessione nella stessa transazione. Le sessioni rimaste senza finished_at dopo una chiusura imprevista possono essere mostrate come interrotte.

## Impostazioni persistenti dei moduli avanzati

I moduli aggiuntivi usano app_settings per conservare dati applicativi che non sono legati a un singolo arco del repertorio:

- chess-os.study-cards.v1: flashcard create automaticamente dagli errori o dai concetti Endgame, con stato ts-fsrs, prossima scadenza e review history.
- chess-os.imported-games.v1: raccolta PGN importata da Chess.com/Lichess o incollata dall'utente.
- chess-os.opponent-report.v1: ultimo report di preparazione avversario.
- chess-os.endgame-progress.v1: tentativi, risultato tablebase consultato e padronanza manuale delle lezioni.

Le flashcard aggiuntive restano separate dalle carte giornaliere FSRS-6. Usano un deck dedicato, così gli errori e i concetti non cambiano il modello del ripasso del repertorio già presente in main. Nel browser preview gli stessi dati sono salvati in localStorage.

## Comandi Tauri

- list_repertoires: legge metadati e grafo completo per ogni repertorio.
- save_repertoire: salva metadati, nodi e archi in una singola transazione.
- delete_repertoire: elimina un repertorio e, tramite foreign key, il suo grafo.
- list_study_cards, list_review_logs, list_training_sessions: caricano il ripasso giornaliero FSRS-6 e lo storico.
- start_training_session, record_study_review, finish_training_session: gestiscono sessioni e valutazioni atomiche.
- get_app_setting e set_app_setting: leggono/scrivono chiavi applicative con limiti su chiavi e payload.
- restore_review_data: importa carte/log/sessioni del ripasso giornaliero tramite upsert in una singola transazione; non elimina record locali assenti dal backup.

## Backup e ripristino

Esporta backup completo crea un archivio JSON applicativo con:
- repertori e grafo delle posizioni/mosse;
- carte FSRS-6, review logs e sessioni giornaliere;
- flashcard aggiuntive e relativa cronologia ts-fsrs;
- PGN importati e report avversario;
- progressi Endgame.

Il ripristino valida il formato, ricostruisce i grafi PGN/FEN, unisce record per ID e non cancella dati locali assenti dal backup. Nel desktop i repertori sono salvati con save_repertoire, i dati del ripasso con restore_review_data e i moduli avanzati con set_app_setting. Il file JSON è un export applicativo, non una copia binaria del database SQLite o dei suoi WAL.

Il ripristino può compiere più transazioni (repertori, poi FSRS, poi impostazioni). Se un errore interviene dopo una scrittura, i dati già salvati restano presenti e possono essere ripristinati nuovamente; non viene presentata come un'unica transazione globale.

## Verifiche

I test Rust coprono migrazioni idempotenti fino alla versione 3, salvataggio/lettura/aggiornamento/cancellazione dei repertori e la persistenza atomica del ripasso giornaliero.
I test JavaScript coprono regole scacchistiche, PGN, grafo, trasposizioni, FSRS aggiuntivo, analisi avversario, Opening Explorer, generazione repertori e validità delle posizioni del catalogo Endgame.

## Limiti

Non c'è sincronizzazione cloud. Syzygy, Chess.com e Lichess richiedono rete; i servizi possono applicare rate limit. Le statistiche dell'Opening Explorer dipendono dal campione PGN importato. Il backup JSON non è una copia grezza del database e non sostituisce il backup di sistema del dispositivo.
