# Chess OS roadmap

La roadmap descrive lo stato verificato del branch di sviluppo rispetto all'MVP 0.1.0. Le funzionalità sono implementate come moduli locali, salvo i servizi pubblici esplicitamente indicati.

## Funzionalità

| # | Funzionalità | Stato | Confini attuali |
|---|---|---|---|
| 1 | Analisi Stockfish | Implementata (MVP) | Stockfish 19 Lite single-threaded WebAssembly: analisi della posizione attiva, migliore mossa e PV. Non è un motore desktop multi-thread. |
| 2 | Ripetizione spaziata FSRS | Implementata | Il sistema giornaliero FSRS-6 esistente su main rimane invariato. La coda aggiuntiva usa ts-fsrs per flashcard da errori e concetti; le due code non si sovrascrivono. |
| 3 | Backup e ripristino | Implementata (MVP) | Backup JSON applicativo di repertori, daily FSRS-6 e log, flashcard extra, PGN, report avversario e progressi Endgame. Non è un'immagine binaria di SQLite. |
| 4 | Dashboard e statistiche | Parzialmente implementata | Heatmap per le posizioni con evidenza di ripasso e statistiche FSRS giornaliere; restano dashboard aggregate e trend longitudinali. |
| 5 | Sincronizzazione cloud | Da sviluppare | Nessun account, server remoto o sync multi-dispositivo. |
| 6 | Creazione automatica delle flashcard | Implementata (MVP) | Crea carte da deviazioni in posizioni note del repertorio e dagli errori di richiamo Blindfold; i concetti Endgame possono diventare carte FSRS. La deviazione da un repertorio non implica automaticamente un errore scacchistico. |
| 7 | Modalità Blindfold | Implementata (MVP) | Nasconde la scacchiera principale e la notazione Studio, richiede mosse SAN e trasforma gli errori in carte. |
| 8 | Heatmap delle debolezze | Implementata (MVP) | Posizioni deboli, in apprendimento, stabili o non valutate, in base a scadenze e cronologia delle carte extra. |
| 9 | Preparazione contro un avversario | Implementata (MVP) | Frequenze di apertura, prime mosse, sequenze iniziali, risultati e numerosità del campione da PGN importati. |
| 10 | Gestione delle trasposizioni | Implementata | Il grafo delle posizioni equivalenti conserva più percorsi e l'explorer permette di aprirli nello Studio. |
| 11 | Opening Sparring | Implementata (MVP) | Partite locali contro Stockfish con scelta del colore e forza. Non è un avversario online né una simulazione dello stile di un umano specifico. |
| 12 | Opening Explorer e Gap Finder | Implementata (MVP) | Frequenze calcolate sul campione PGN importato; segnala mosse osservate nel campione ma assenti dal repertorio attivo. Non è un database globale. |
| 13 | Importazione Chess.com / Lichess | Implementata (MVP) | Solo partite pubbliche da username, senza credenziali. Archivi Chess.com richiesti sequenzialmente; i limiti HTTP 429 interrompono l'importazione. |
| 14 | Tactics Trainer personalizzato | Implementata (MVP) | Candidati generati da scansioni Stockfish limitate di PGN; richiedono verifica umana, non sono puzzle certificati o blunder automaticamente classificati. |
| 15 | Annotazioni intelligenti | Implementata (MVP) | Commenti, piani, avvisi e NAG sulle mosse del grafo; diventano permanenti salvando la linea. |
| 16 | Endgame Trainer | Implementato (MVP esteso) | 131 lezioni in 10 capitoli, FEN libere, board interattiva, analisi e sparring Stockfish, Syzygy online per posizioni standard coperte fino a 7 pezzi, progressi utente e flashcard FSRS per le lezioni. |
| 17 | Generatore automatico di repertori | Implementato (MVP) | Genera un grafo da PGN importati, unisce varianti, filtra per frequenza/profondità e aggiunge note sulle frequenze osservate; richiede revisione prima del salvataggio. |

## Endgame Lab: 131 lezioni / 10 capitoli

1. **Re e pedone:** opposizione, case chiave, regola del quadrato, zugzwang, triangolazione, tempi di riserva, breakthroughs, passati esterni/collegati/protetti, pedone di torre, alfiere di colore sbagliato e case corrispondenti.
2. **Torre:** torre attiva e dietro il passato, tagli del re, Lucena e ponte, Philidor, Vancura, scacchi laterali/posteriori, torre contro passati, maggioranze e controgioco.
3. **Alfiere:** stesso/contrario colore, alfiere buono/cattivo, blocchi, fortezze, pedone di torre e coppia di alfieri.
4. **Cavallo:** cavallo contro passato, pedone di torre, alfiere, avamposti, case di blocco, passati collegati e limiti dei due cavalli.
5. **Donna:** perpetuo, donna contro torre/pedoni, re esposto, cambi, passati, rete di matto e stallo.
6. **Pezzi minori:** alfiere contro cavallo, coppia di alfieri, materiali misti, qualità e fortezze.
7. **Matti elementari:** donna, torre, due alfieri, alfiere+cavallo, limiti teorici dei due cavalli.
8. **Tecnica pratica e difesa:** fortezze, blocco, dominazione, ripetizione, stallo, 50 mosse, attività del re, scambi e conversione.
9. **Finali avanzati e studi:** qualità, materiali asimmetrici, promozioni/sotto-promozioni, strutture e zugzwang complessi.
10. **Studi classici e casi specialistici:** Réti, Saavedra, Troitzky, Cochrane, varianti di Lucena/Philidor/Vancura, torre contro più passati, donna contro torre/pedoni, fortificazioni e interpretazione WDL/DTZ.

Ogni lezione contiene focus, obiettivo, metodo pratico, errore tipico e FEN di studio. L'utente può caricare una FEN arbitraria, muovere i pezzi, richiedere analisi Stockfish, giocare contro Stockfish e interrogare Syzygy quando la posizione è coperta.

### Precisione e limiti dell'Endgame Lab

- Syzygy viene interrogata tramite il servizio pubblico online per posizioni standard con massimo sette pezzi totali, re inclusi, quando il servizio ha copertura.
- WDL/DTZ è un risultato teorico della tablebase per la posizione coperta. Un esito WDL non va separato dalla regola delle 50 mosse e dal DTZ.
- Per posizioni con più di sette pezzi o non coperte dal servizio si mostra l'analisi Stockfish, che è una valutazione di motore e non una prova tablebase.
- Il catalogo di 131 lezioni è un programma didattico ampio, non una lista esaustiva di ogni FEN teorica possibile.
- La padronanza delle lezioni è segnata dall'utente; interrogare una tablebase o aprire una posizione non certifica l'apprendimento.

## Persistenza e servizi

- Repertori, daily FSRS-6 cards, review logs e training sessions: SQLite nel desktop, localStorage nella preview browser.
- Flashcard extra FSRS, archivi PGN importati, report avversario e progressi Endgame: app_settings SQLite nel desktop; localStorage nella preview.
- Stockfish Lite è un worker JS/WASM locale; il pacchetto è GPL-3.0 e i testi licenza sono inclusi.
- Syzygy, Chess.com e Lichess richiedono rete e possono applicare limiti di servizio.
- Il backup JSON è un export applicativo e non una copia raw di SQLite/WAL.

## Lavoro futuro

1. Realizzare sync cloud opzionale e gestione account.
2. Aggiungere una dashboard aggregata con obiettivi, trend, accuratezza per apertura/variante e statistiche di allenamento.
3. Espandere il database aperture oltre il campione PGN personale.
4. Approfondire l'analisi tattica con scansioni più lunghe, multi-PV e revisione delle etichette prima di chiamare una mossa errore/blunder.
5. Aggiungere quiz multi-step e posizioni con soluzione verificata per ogni capitolo Endgame, incluse varianti/linee forzate e test pratici di conversione/difesa.
6. Aggiungere test end-to-end UI e test manuali Windows per motore WASM, tablebase, importazioni e ripristino backup.
