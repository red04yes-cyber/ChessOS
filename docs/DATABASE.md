# Chess OS — database SQLite

## File e ownership

Nel desktop Tauri la connessione viene aperta una volta all'avvio. Il file chess-os.sqlite3 viene creato nella directory dati applicazione indicata da app.path().app_data_dir(); non viene scritto nel repository. SQLite usa foreign key, WAL e un timeout di lock di 5 secondi.

La preview Vite nel browser continua a usare localStorage perché non ha accesso al backend Rust. Il programma desktop usa SQLite per repertori, flashcard FSRS e cronologia dei ripassi. PGN importati, report avversario e progressi Endgame sono ancora in localStorage nel MVP.

## Schema e migrazioni

Le migrazioni sono registrate in schema_migrations e vengono eseguite in ordine, in transazioni:

- **v1**: repertoires, repertoire_positions, repertoire_moves, app_settings, study_cards, training_sessions e review_logs.
- **v2**: indici per repertori aggiornati, ricerca delle posizioni, navigazione delle mosse e selezione delle carte dovute.
- **v3**: study_card_records, che conserva il payload completo FSRS serializzato per ogni flashcard, e study_review_records, che conserva le valutazioni storiche, date, stabilità, difficoltà, stato e intervallo pianificato.

Le tabelle study_cards e review_logs della v1 rimangono presenti per compatibilità con lo schema storico; i comandi Tauri attuali scrivono nelle tabelle v3 study_card_records e study_review_records, che non obbligano una flashcard generica a essere collegata a un edge di un repertorio specifico.

## Comandi Tauri

- list_repertoires: legge metadati e grafo completo per ogni repertorio.
- save_repertoire: salva metadati, nodi e archi in una singola transazione.
- delete_repertoire: elimina il repertorio; le foreign key rimuovono anche il suo grafo.
- list_study_cards: legge le flashcard FSRS complete in ordine di scadenza.
- replace_study_cards: sostituisce la raccolta carte e i relativi log in un'unica transazione; il frontend usa questo comando per sincronizzare il modello locale FSRS con SQLite.

## Chiavi locali mantenute nel MVP

- chess-os.repertoire.v1: dati legacy dei repertori, migrati in SQLite al primo avvio desktop.
- chess-os.imported-games.v1: raccolta PGN importata da Chess.com/Lichess o incollata dall'utente.
- chess-os.opponent-report.v1: ultimo report di preparazione avversario.
- chess-os.endgame-progress.v1: completamento e padronanza delle lezioni Endgame.

Le flashcard usano localStorage nella preview browser; nell'app desktop vengono migrate dalla chiave chess-os.study-cards.v1 a SQLite al primo avvio riuscito. La copia locale viene rimossa solo dopo aver salvato i record nel database.

## Backup e ripristino

L'interfaccia genera un archivio JSON applicativo con:
- repertori e grafo delle posizioni/mosse;
- flashcard FSRS e review history;
- PGN importati;
- ultimo report avversario;
- progressi Endgame.

Il ripristino valida il formato, ricostruisce i grafi PGN/FEN, unisce i record per ID e non cancella i dati locali assenti nel backup. Il JSON non è un file SQLite raw e il ripristino di una raccolta molto grande può richiedere più operazioni di scrittura: in caso di errore, i record già scritti restano presenti.

## Verifiche

I test Rust coprono migrazioni versionate/idempotenti, salvataggio/lettura/aggiornamento/eliminazione dei repertori e persistenza di carte e review history.
I test JavaScript coprono regole scacchistiche, PGN, grafo e trasposizioni, FSRS, analisi avversario, repertorio generato, gap finder e validità delle posizioni del catalogo Endgame.

## Limiti attuali

Il database è locale al dispositivo e non esiste sincronizzazione cloud. I PGN importati, report avversario e progressi Endgame dovranno essere migrati a SQLite in una prossima revisione per avere un unico archivio locale. Il backup JSON è portabile ma non è una copia point-in-time del file SQLite, dei WAL o dei file del motore Stockfish.
