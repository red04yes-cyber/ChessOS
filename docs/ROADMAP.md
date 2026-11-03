# Chess OS roadmap

Questa roadmap descrive le funzioni disponibili nel branch di sviluppo e separa esplicitamente ciò che è già implementato dalle estensioni ancora necessarie per una release stabile.

## Moduli di studio e allenamento

| # | Funzionalità | Stato | Confini attuali |
|---|---|---|---|
| 1 | Analisi Stockfish | Implementata (MVP) | Stockfish 19 Lite single-threaded in WebAssembly; analisi posizione, PV e best move. Non è un motore multi-thread desktop. |
| 2 | Ripetizione spaziata FSRS | Implementata (MVP) | Libreria ts-fsrs, Again/Hard/Good/Easy, due date e review history. Carte e log usano SQLite in desktop mode; browser preview usa localStorage. |
| 3 | Backup e ripristino | Implementata (MVP) | Backup JSON applicativo di repertori, carte, PGN importati, report avversario e progressi Endgame. Non è una copia binaria SQLite. Import merge-by-ID, senza cancellare record non presenti nel backup. |
| 4 | Dashboard e statistiche | Parzialmente implementata | Heatmap delle posizioni e conteggi FSRS. Restano dashboard aggregate per sessioni, obiettivi, accuratezza e trend longitudinali. |
| 5 | Sincronizzazione cloud | Da sviluppare | Nessun account, server remoto o sync multi-dispositivo. |
| 6 | Creazione automatica delle flashcard | Implementata (MVP) | Crea carte da deviazioni del repertorio nei PGN e da errori nell'allenamento. Stockfish per identificare blunder veri è una fase distinta; la deviazione dal book non implica automaticamente un errore scacchistico. |
| 7 | Modalità Blindfold | Implementata (MVP) | Pezzi e notazione nascosti; inserimento SAN e cattura degli errori. |
| 8 | Heatmap delle debolezze | Implementata (MVP) | Classifica posizioni con carte in deboli, in apprendimento, stabili o non valutate. È una misura della cronologia flashcard, non un punteggio oggettivo della forza scacchistica. |
| 9 | Preparazione contro un avversario | Implementata (MVP) | Analisi PGN di aperture, prime mosse, sequenze iniziali, risultati e dimensione campione. |
| 10 | Gestione delle trasposizioni | Implementata | Grafo delle posizioni equivalenti e navigazione fra percorsi distinti che raggiungono lo stesso nodo. |
| 11 | Opening Sparring | Implementata (MVP) | Partita locale contro Stockfish con colore e livello Elo regolabili. Non è un avversario online né un simulatore di stile umano. |
| 12 | Opening Explorer e Gap Finder | Implementata (MVP) | Frequenze calcolate dai PGN importati; evidenzia mosse viste nel campione ma assenti dal repertorio attivo. Non è un database globale di tutte le partite online. |
| 13 | Importazione Chess.com e Lichess | Implementata (MVP) | Importa partite pubbliche da username, senza credenziali. Rispetta le richieste sequenziali di Chess.com e si ferma su HTTP 429. Non accede a partite private o account autenticati. |
| 14 | Tactics Trainer personalizzato | Implementata (MVP) | Genera candidati da una scansione Stockfish limitata. Candidati da verificare: non sono classificazioni certificate di blunder o puzzle curati. |
| 15 | Annotazioni intelligenti | Implementata (MVP) | Commenti, piani, avvisi e NAG sulle mosse del grafo; diventano permanenti quando si salva la linea. |
| 16 | Endgame Trainer | Implementato (MVP esteso) | 111 lezioni in 9 capitoli, FEN modificabili, scacchiera interattiva, analisi/mossa Stockfish, progressi e Syzygy online fino a 7 pezzi. Non è un'enumerazione di ogni posizione finale possibile. |
| 17 | Generatore automatico di repertori | Implementato (MVP) | Costruisce e unisce linee dai PGN importati, filtra per frequenza minima e annota frequenze osservate; richiede revisione umana prima del salvataggio. |

## Endgame Lab: copertura didattica

Il catalogo contiene 111 lezioni in nove capitoli:

1. **Re e pedone:** opposizione, case chiave, regola del quadrato, zugzwang, triangolazione, tempi di riserva, breakthroughs, pedoni passati, pedone di torre, alfiere di colore sbagliato e case corrispondenti.
2. **Finali di torre:** attività, torre dietro il passato, taglio del re, Lucena, ponte, Philidor, Vancura, scacchi laterali/da dietro, torre contro pedoni, maggioranze, controgioco.
3. **Finali di alfiere:** alfieri dello stesso colore e di colore contrario, alfiere buono/cattivo, blocchi, diagonali, fortezze, coppia di alfieri.
4. **Finali di cavallo:** cavallo contro pedone, pedone di torre, alfiere, avamposti, pedoni passati e limite dei due cavalli.
5. **Finali di donna:** perpetuo, donna contro torre/pedoni, re esposto, cambio delle donne, promozioni e stallo.
6. **Finali di pezzi minori:** alfiere contro cavallo, coppia di alfieri, materiali misti, qualità e fortezze.
7. **Matti elementari:** donna, torre, due alfieri, alfiere+cavallo, due cavalli e rete senza stallo.
8. **Tecnica pratica e difesa:** fortezze, blocchi, dominazione, ripetizione, stallo, regola delle 50 mosse, attività del re, cambi e conversione del vantaggio.
9. **Finali avanzati e studi:** qualità, donna contro due torri/pezzi minori, promozioni multiple, sotto-promozioni, strutture pedonali, triangolazioni e zugzwang complessi.

Ogni lezione ha focus, obiettivo, metodo pratico, errore tipico e posizione FEN modificabile. La padronanza didattica è contrassegnata manualmente dall'utente; la semplice consultazione della tablebase non certifica che una tecnica sia stata appresa.

### Precisione delle valutazioni finali

- Syzygy viene interrogata online per posizioni standard con massimo sette pezzi totali, re inclusi. La risposta WDL/DTZ è teorica per la posizione coperta dalla tablebase.
- Per più di sette pezzi, posizioni non coperte o indisponibilità della rete, Chess OS usa Stockfish e non presenta il suo giudizio come verità tablebase.
- Il catalogo delle lezioni è intenzionalmente ampio ma non può contenere ogni FEN possibile. L'input FEN libero e l'engine/tablebase estendono lo studio oltre gli esempi didattici.
- Le richieste tablebase pubbliche possono essere limitate dal provider.

## Persistenza e distribuzione

- Repertori, flashcard FSRS e review history: SQLite nella app desktop; localStorage nella preview browser.
- PGN importati, ultimo report avversario e progressi Endgame: localStorage nel MVP corrente.
- Backup JSON: esporta dati applicativi, non il file binario SQLite.
- Stockfish Lite è distribuito come worker JS/WASM locale. Il pacchetto Stockfish è GPL-3.0: la distribuzione dell'app deve essere verificata rispetto agli obblighi della licenza e non deve essere trattata come automaticamente compatibile con un'eventuale licenza proprietaria.

## Prossimi miglioramenti

1. Migrare anche PGN importati, progressi Endgame e report avversario in SQLite con schemi versionati.
2. Aggiungere test end-to-end di UI e verifiche manuali Windows per Stockfish Worker, Syzygy, import account e backup/restore.
3. Aggiungere diagrammi e quiz multi-step per ogni capitolo Endgame, progressione adattiva FSRS e test pratici di conversione/difesa.
4. Estendere il motore tattico con analisi più profonde e valutazioni multi-linea, mantenendo la distinzione fra candidati e blunder verificati.
5. Estendere Openings Explorer con un database di aperture esterno/aggiornabile e filtri per periodo, colore, cadenza e fascia Elo.
6. Realizzare dashboard complete e sincronizzazione cloud opzionale.

