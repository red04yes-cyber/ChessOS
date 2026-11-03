# Chess OS roadmap

La roadmap riporta lo stato verificato dell'MVP 0.1.0 e delimita le parti già operative dalle estensioni future.

| # | Funzionalità | Stato | Note |
|---|---|---|---|
| 1 | Analisi Stockfish | Da sviluppare | Motore di valutazione, migliori mosse e riconoscimento di imprecisioni/blunder. È il passo necessario per identificare errori oggettivi di gioco, oltre alle deviazioni dal repertorio. |
| 2 | Ripetizione spaziata FSRS | Parzialmente implementata | Le flashcard usano `ts-fsrs` con valutazioni Again/Hard/Good/Easy e stato/cronologia per carta. Persistenza attuale in localStorage/WebView; resta l'integrazione con le tabelle SQLite `study_cards` e `review_logs`. |
| 3 | Backup e ripristino | Da sviluppare | Backup e ripristino dell'intero database SQLite; l'export PGN è già disponibile. |
| 4 | Dashboard e statistiche | Parzialmente implementata | La heatmap mostra lo stato delle posizioni misurate; restano dashboard aggregate, obiettivi, sessioni e statistiche complete. |
| 5 | Sincronizzazione cloud | Da sviluppare | Account, sincronizzazione e backup tra dispositivi. |
| 6 | Creazione automatica delle flashcard | Implementata (MVP) | Genera carte quando una partita PGN devia da una continuazione salvata in una posizione conosciuta; anche gli errori nel ripasso/Blindfold possono creare carte. Non equivale ancora al rilevamento di blunder tramite motore. |
| 7 | Modalità Blindfold | Implementata (MVP) | Nasconde i pezzi e la notazione, richiede l'inserimento SAN e registra gli errori come carte. |
| 8 | Heatmap delle debolezze | Implementata (MVP) | Classifica le posizioni in deboli, in apprendimento, stabili o non valutate in base a scadenze FSRS e cronologia. L'assenza di dati non viene interpretata come padronanza. |
| 9 | Preparazione contro un avversario | Implementata (MVP) | Analizza una o più partite PGN: aperture/varianti (header PGN o prime 8 semimosse), prime mosse del colore selezionato, risultati e dimensione del campione. Restano analisi più profonde per posizione e fase di partita. |
| 10 | Gestione delle trasposizioni | Implementata | Il grafo unifica posizioni equivalenti e l'explorer mostra i diversi percorsi di mosse che conducono alla stessa posizione. |

## Come usare le nuove funzioni

- **Flashcard automatiche:** aprire una linea/repertorio in Studio, incollare una partita nella sezione Flashcard automatiche e scegliere Genera carte dagli errori. Vengono considerate soltanto le deviazioni in posizioni già presenti nel grafo, dove esiste almeno una continuazione salvata.
- **Ripasso FSRS:** usare Ripassa carte dovute, rivelare la soluzione e valutare il ricordo con Again, Hard, Good o Easy. La schedulazione è eseguita dalla libreria `ts-fsrs`.
- **Blindfold:** avviare la modalità sulla linea attiva e inserire la mossa in notazione SAN (ad esempio `Nf3` o `O-O`). La scacchiera resta senza pezzi e la notazione viene nascosta durante il tentativo.
- **Heatmap:** controllare lo stato delle posizioni del repertorio attualmente aperto. Le posizioni senza flashcard associate sono marcate come non valutate.
- **Preparazione avversario:** incollare uno o più PGN con intestazioni `[Event "..."]`, selezionare il colore dell'avversario e avviare l'analisi. Le percentuali sono descrittive del campione importato, non previsioni.
- **Trasposizioni:** consultare la sezione Trasposizioni in fondo allo Studio per confrontare le sequenze che convergono sullo stesso nodo.

## Limiti e prossimi passi

1. Integrare le flashcard e i log FSRS con il database SQLite già predisposto, invece di usare localStorage.
2. Collegare Stockfish alla revisione PGN per distinguere deviazioni di repertorio, errori e imprecisioni valutative.
3. Arricchire la heatmap con statistiche aggregate per apertura/variante e con metriche di accuratezza quando saranno disponibili valutazioni affidabili.
4. Estendere la preparazione avversario con risposte per posizione, frequenze per fase e filtri temporali.
5. Aggiungere test end-to-end UI e una verifica manuale in Tauri/Windows oltre ai test unitari JavaScript.

Le posizioni transposte sono identificate nel grafo usando disposizione dei pezzi, tratto, diritti di arrocco e campo en passant della FEN. I contatori di mezza mossa e numero della mossa non fanno parte della chiave. Il codice evita fusioni che introdurrebbero cicli; in quel caso conserva un nodo separato.
