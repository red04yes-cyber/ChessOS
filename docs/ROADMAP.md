# Chess OS roadmap

Questa roadmap distingue le funzionalità già presenti nell'MVP 0.1.0 dalle estensioni ancora da sviluppare. Le voci 6–10 riprendono le richieste aggiuntive del progetto.

## Funzionalità pianificate

| # | Funzionalità | Obiettivo | Stato |
|---|---|---|---|
| 1 | Analisi Stockfish | Valutazione delle posizioni, migliori mosse, analisi delle imprecisioni e confronto con le linee del repertorio. | Da sviluppare |
| 2 | Ripetizione spaziata FSRS | Pianificazione dei ripassi, stati delle carte, cronologia e intervalli adattivi. | Da sviluppare |
| 3 | Backup e ripristino | Esportazione e ripristino del database SQLite, oltre all'esportazione PGN già disponibile. | Da sviluppare |
| 4 | Dashboard e statistiche | Progressi, obiettivi, sessioni, accuratezza e risultati degli allenamenti. | Da sviluppare |
| 5 | Sincronizzazione cloud | Account, sincronizzazione dei repertori e backup tra dispositivi. | Da sviluppare |
| 6 | Creazione automatica delle flashcard | Trasformare gli errori commessi nelle partite o durante il ripasso in carte collegate alla posizione e alla variante corretta, da pianificare con FSRS. | Da sviluppare |
| 7 | Modalità Blindfold | Allenare il richiamo delle varianti senza mostrare la scacchiera; verificare la mossa inserita e rivelare la posizione dopo la risposta. | Da sviluppare |
| 8 | Heatmap delle debolezze | Evidenziare aperture, varianti e posizioni meno conosciute usando errori, accuratezza e cronologia dei ripassi. | Da sviluppare |
| 9 | Preparazione contro un avversario | Importare le partite PGN di un avversario e sintetizzarne aperture preferite, frequenze, risposte ricorrenti e abitudini. | Da sviluppare |
| 10 | Gestione delle trasposizioni | Riconoscere sequenze differenti che raggiungono la stessa posizione e riunirle nel grafo del repertorio. | Già implementata nel grafo dei repertori |
 
## Dipendenze e note di progettazione

- La generazione automatica delle carte (6) si appoggia al motore di ripasso FSRS (2). Per identificare gli errori in modo più robusto, l'analisi Stockfish (1) può essere aggiunta come fonte opzionale, distinta dagli errori rispetto al repertorio.
- La modalità Blindfold (7) può riutilizzare il motore di allenamento e la navigazione delle varianti esistenti.
- La heatmap (8) richiede dati di allenamento e cronologia FSRS; prima di questi dati, può mostrare soltanto copertura e dimensione del repertorio, non una misura attendibile della conoscenza.
- La preparazione avversario (9) può riutilizzare l'importazione PGN e il grafo delle varianti. Le statistiche dovranno distinguere colore, apertura, campione di partite e periodo analizzato.
- Le trasposizioni (10) sono già gestite nel grafo: la chiave confronta disposizione dei pezzi, tratto, diritti di arrocco e possibilità en passant. I contatori di mezza mossa e numero della mossa non identificano una posizione diversa. Il codice evita inoltre fusioni che introdurrebbero cicli; in quel caso mantiene un nodo separato.

## Criteri di completamento suggeriti

Ogni nuova funzione dovrebbe includere test automatici, gestione dei dati persistenti e una breve verifica manuale nell'app desktop Windows. Le funzionalità che dipendono dai dati di ripasso dovrebbero essere sviluppate dopo l'introduzione di FSRS e della relativa cronologia.
