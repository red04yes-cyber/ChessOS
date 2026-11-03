# Chess OS roadmap

Questa roadmap distingue le funzionalità già presenti nell'MVP 0.1.0 dalle estensioni ancora da sviluppare. Le voci 6–10 riprendono le richieste aggiuntive del progetto.

## Funzionalità pianificate

| # | Funzionalità | Obiettivo | Stato |
|---|---|---|---|
| 1 | Analisi Stockfish | Valutazione delle posizioni, migliori mosse, analisi PGN delle imprecisioni/errori e confronto con le linee del repertorio. | Base implementata; report PGN MVP nella PR #31 |
| 2 | Ripetizione spaziata FSRS | Pianificazione dei ripassi, stati delle carte, cronologia e intervalli adattivi. | Implementata per le mosse del repertorio |
| 3 | Backup e ripristino | Esportazione e ripristino del database SQLite, oltre all'esportazione PGN già disponibile. | Da sviluppare |
| 4 | Dashboard e statistiche | Progressi, obiettivi, sessioni, accuratezza e risultati degli allenamenti. | Implementata per ripassi, obiettivi ed esami |
| 5 | Sincronizzazione cloud | Account, sincronizzazione dei repertori e backup tra dispositivi. | Da sviluppare |
| 6 | Creazione automatica delle flashcard | Trasformare gli errori commessi nelle partite in carte collegate alla posizione e alla mossa migliore, pianificate con FSRS. | MVP locale nella PR #31 |
| 7 | Modalità Blindfold | Allenare il richiamo delle varianti senza mostrare la scacchiera; verificare la mossa inserita e rivelare la posizione dopo la risposta. | MVP sulla variante principale nella PR #31 |
| 8 | Heatmap delle debolezze | Evidenziare posizioni meno conosciute usando accuratezza e cronologia FSRS, senza inventare valori quando i dati mancano. | MVP per il repertorio attivo nella PR #31 |
| 9 | Preparazione contro un avversario | Analizzare PGN per aperture, colori, risultati, prime mosse e scelte ricorrenti dell'avversario. | MVP statistico da PGN nella PR #31 |
| 10 | Gestione delle trasposizioni | Riconoscere sequenze differenti che raggiungono la stessa posizione e riunirle nel grafo del repertorio. | Già implementata nel grafo dei repertori |
 
## Dipendenze e note di progettazione

- Le carte dagli errori (6) sono distinte dalle carte delle linee di repertorio: nella prima versione della PR #31 sono salvate nel localStorage WebView, con scheduler FSRS-6, e non ancora nella tabella SQLite `study_cards`.
- La modalità Blindfold (7) usa al momento la variante principale del repertorio attivo; le varianti secondarie e un percorso casuale restano estensioni.
- La heatmap (8) si basa sulle carte e sui log FSRS del repertorio attivo; senza ripassi sufficienti una posizione viene esplicitamente marcata come non misurabile.
- La preparazione avversario (9) usa i nomi esatti nelle intestazioni PGN e descrive solo il campione caricato. I risultati non sono previsioni, soprattutto con campioni piccoli.
- Le trasposizioni (10) sono già gestite nel grafo: la chiave confronta disposizione dei pezzi, tratto, diritti di arrocco e possibilità en passant. I contatori di mezza mossa e numero della mossa non identificano una posizione diversa. Il codice evita inoltre fusioni che introdurrebbero cicli; in quel caso mantiene un nodo separato.

## Criteri di completamento suggeriti

Ogni nuova funzione dovrebbe includere test automatici, gestione dei dati persistenti e una breve verifica manuale nell'app desktop Windows. Per la PR #31 restano da validare manualmente UX/accessibilità su WebView2, resa del Blindfold, accuratezza su campioni PGN reali e comportamento con archivi molto grandi. Il report Stockfish iniziale analizza fino a 3 partite, 48 semimosse ciascuna e profondità 10; le etichette sono stime dipendenti dal motore, non giudizi certificati. Il Tactical Trainer applica filtri euristici più selettivi ma non sostituisce puzzle curati da esperti.
