# Chess OS — database SQLite

## File e ownership

Nel desktop Tauri la connessione viene aperta una volta all'avvio. Il file `chess-os.sqlite3` viene creato nella directory dati applicazione indicata da `app.path().app_data_dir()`; non viene scritto nel repository né nella cartella Desktop dell'utente. SQLite usa foreign key, WAL e un timeout di lock di 5 secondi.

La preview Vite nel browser continua a usare `localStorage` perché non ha accesso al backend Rust. Il programma desktop usa i comandi Tauri/SQLite per i repertori; le nuove flashcard FSRS, i log per carta e l'ultimo report avversario usano invece le chiavi WebView `chess-os.study-cards.v1` e `chess-os.opponent-report.v1`. Se SQLite non si inizializza, i pulsanti di salvataggio/eliminazione dei repertori vengono bloccati anziché fingere di aver scritto su SQLite.

## Schema

Le migrazioni sono registrate in `schema_migrations` e vengono eseguite in ordine, in transazioni:

- **v1**: `repertoires` (metadati e PGN), `repertoire_positions` (nodi/posizioni), `repertoire_moves` (archi con UCI, SAN, NAG e commenti), `app_settings`, `study_cards`, `training_sessions` e `review_logs`.
- **v2**: indici per repertori aggiornati, ricerca delle posizioni, navigazione delle mosse e selezione delle carte dovute.

Le posizioni sono memorizzate in modo separato dalle mosse: due ordini di mosse che arrivano alla stessa posizione possono puntare allo stesso nodo e conservare più archi entranti. Le mosse sono archiviate con l'ordine delle continuazioni del nodo, così la linea principale e le varianti non cambiano al riavvio.

## Comandi Tauri

- `list_repertoires`: legge metadati e grafo completo per ogni repertorio.
- `save_repertoire`: salva metadati, nodi e archi in una singola transazione.
- `delete_repertoire`: elimina il repertorio; le foreign key rimuovono anche il suo grafo.

L'interfaccia valida il grafo ricostruendolo con `RepertoireTree.fromJSON` e controlla che ciascuna mossa sia legale e coerente con la posizione di destinazione.

## Migrazione da localStorage

Al primo avvio desktop vengono letti gli elementi di `chess-os.repertoire.v1`. Le linee non già presenti vengono parse come PGN o come grafo e inserite tramite `save_repertoire`. L'app rilegge poi l'elenco da SQLite; solo quando tutti gli elementi legacy sono stati importati elimina la vecchia chiave. Una migrazione parziale mantiene i dati legacy per consentire un nuovo tentativo al successivo avvio.

## Verifiche

I test Rust coprono:
- esecuzione idempotente delle migrazioni;
- salvataggio e lettura di un albero con mosse;
- aggiornamento senza duplicazione;
- cancellazione con cascade su nodi e archi.

I test JavaScript coprono la serializzazione round-trip del grafo e il rifiuto di archi alterati o non legali.

## Limiti attuali

Le tabelle `study_cards`, `training_sessions` e `review_logs` sono predisposte ma l'MVP delle nuove funzioni salva temporaneamente carte e cronologia FSRS in WebView `localStorage`; il successivo passaggio è collegarle alle tabelle SQLite esistenti. L'esportazione PGN è disponibile come backup portabile; backup dell'intero database, ripristino da file e migrazione tra versioni dell'app con UI dedicata restano attività successive. Non c'è sincronizzazione cloud.
