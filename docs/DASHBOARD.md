# Dashboard, progressi ed esami

## Panoramica dei repertori

La dashboard genera una scheda per ogni arco del grafo del repertorio, riutilizzando la stessa identità posizione/mossa del ripasso FSRS. Per ciascuna linea mostra il numero di schede, quante sono state effettivamente viste almeno una volta, il numero totale di valutazioni e la percentuale di richiamo.

La copertura è calcolata come schede distinte con almeno un review log diviso per le schede del repertorio. Le percentuali di richiamo usano invece tutte le risposte registrate: ogni nuova valutazione della stessa mossa è una nuova osservazione.

## Progressi giornalieri e settimanali

Le giornate sono calcolate nel fuso orario locale del dispositivo. La dashboard mostra gli ultimi sette giorni e le ultime sei settimane; le settimane iniziano il lunedì. Ogni gruppo include numero di risposte, risposte ricordate, percentuale di richiamo e minuti di studio stimati dal tempo di risposta registrato.

Il tempo è la somma dei millisecondi impiegati sulle carte, arrotondata al minuto più vicino. I conteggi delle sessioni provengono dalle sessioni di ripasso salvate; i conteggi delle risposte provengono dai review log, così una sessione interrotta non nasconde le risposte già registrate.

Una risposta è considerata ricordata quando il giocatore trova la mossa prima di chiedere la soluzione. Il rating FSRS (Again, Hard, Good, Easy) è una valutazione distinta: rivelare la soluzione e scegliere un rating diverso da Again non trasforma quella risposta in un richiamo corretto.

## Obiettivi di studio

Sono configurabili obiettivi giornalieri e settimanali di numero di ripassi, minuti di studio e percentuale di richiamo.

I valori iniziali sono 20 ripassi e 20 minuti al giorno, 100 ripassi e 120 minuti a settimana, con una soglia di richiamo dell'80%. Gli obiettivi sono salvati nel database SQLite desktop o nel localStorage della preview browser. Sono traguardi personali e non modificano lo scheduling FSRS.

## Test ed esami sui repertori

Un esame seleziona casualmente schede uniche da un repertorio scelto, filtrate per lato (Bianco, Nero o entrambi) e per numero di domande. Il default è 10 domande e la soglia di superamento è 70%, entrambi modificabili prima dell'avvio.

Ogni domanda presenta una posizione e richiede una sola mossa. La risposta viene registrata e la soluzione viene mostrata. L'esame non modifica le carte FSRS né le relative scadenze. Al termine vengono salvati punteggio, stato superato/non superato e tentativo nello storico. Un'interruzione viene conservata come tentativo interrotto, non come esame superato.

SQLite conserva gli esami desktop in `exam_attempts` e le risposte in `exam_answers`. Il backend verifica che FEN e mossa prevista corrispondano davvero all'arco del repertorio selezionato, che le risposte arrivino in ordine e che un tentativo concluso non accetti altre risposte.

## Limiti

La dashboard è locale al dispositivo e usa i dati disponibili negli ultimi 10.000 review log restituiti dal database. Non sincronizza obiettivi, progressi o esami tra dispositivi. L'esame verifica una mossa prevista per posizione, non valuta varianti alternative o la qualità strategica di una mossa.
