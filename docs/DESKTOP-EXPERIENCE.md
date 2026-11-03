# Esperienza desktop — ChessOS

## Redesign riallineato a main

Il redesign è stato trapiantato per componenti dal ramo design/chess-os-ui-refresh, senza fondere il ramo divergente né sostituire le funzioni già arrivate su main (SQLite, backup e restore, importazione partite, FSRS, FEN editor e Chess Lab).

La UI resta HTML, CSS e JavaScript vanilla. Usa uno sprite SVG inline originale e font di sistema. Le preferenze grafiche sono isolate in localStorage con chiave chess-os.ui.v1; non cambiano lo schema SQLite né i record dei repertori.

## Preferenze

| Preferenza | Valori |
|---|---|
| Tema interfaccia | Scuro, Chiaro, Sistema |
| Tema scacchiera | Salvia, Noce, Ardesia |
| Coordinate | Dentro, Nascoste |
| Movimento | Segui il sistema, Ridotte |

Le coordinate sono inserite direttamente nelle case visibili; le etichette accessibili rimangono presenti quando le coordinate vengono nascoste. Le tre palette si applicano anche alle scacchiere ausiliarie dell'editor FEN e degli strumenti di analisi.

## Tastiera della scacchiera

- Tab e Shift+Tab entrano/escono dalla scacchiera attraverso una sola casa (roving tabindex).
- Le quattro frecce spostano il focus tra le case adiacenti sullo schermo; non eseguono mosse scacchistiche.
- Invio o Spazio attivano la casa focalizzata e riusano la selezione/mossa legale del clic.
- Esc deseleziona il pezzo o esce dal dialogo attivo.
- F ruota la scacchiera e conserva la casa focalizzata.
- Home / End e freccia sinistra/destra continuano a navigare la linea nello Studio.
- Durante la promozione, Q, R, B, N selezionano Donna, Torre, Alfiere e Cavallo.

## Dialoghi, focus e messaggi

Importazione online, editor FEN e promozione dichiarano un ruolo dialogo modale. L'importazione e l'editor FEN restituiscono il focus al controllo che li ha aperti. Le schede di promozione riportano il focus alla casa di partenza o alla destinazione dopo una scelta; Tab/Shift+Tab restano nel dialogo. I messaggi di errore usano un annuncio assertivo e uno stato distinguibile; avvisi e messaggi ordinari restano polite.

## Dimensioni desktop richieste

La finestra Tauri conserva dimensione iniziale 1440×940 e minimo 1080×720. Il CSS ridimensiona l'area della scacchiera in base alla larghezza e all'altezza, riduce pannelli e spaziature sotto 780 px di altezza e amplia padding/griglia su schermi oltre 1500 px.

| Dimensione | Controlli previsti | Stato |
|---|---|---|
| 1080×720 | scacchiera non tagliata, heading/pannelli utilizzabili, nessun overflow orizzontale | Da verificare visivamente in Windows WebView2 |
| 1440×940 | dimensione desktop di riferimento, scacchiera e pannello dettagli bilanciati | Da verificare visivamente in Windows WebView2 |
| 1920×1080 | area centrale più ampia, scacchiera limitata a dimensione massima, padding espanso | Da verificare visivamente in Windows WebView2 |

I test automatici verificano la presenza di controlli, scorciatoie, semantica dei dialoghi e breakpoint CSS. Non sostituiscono una prova visuale reale su WebView2. Il controllo manuale dei tre viewport e dei temi va completato sull'installer Windows.

## Verifiche

```sh
npm test
npm run build
npm run tauri:build
```

Checklist manuale Windows:
1. Aprire la finestra a 1080×720, 1440×940 e 1920×1080; verificare scacchiera, pannello dettagli, header e assenza di scroll orizzontale.
2. Usare Tab per entrare nella scacchiera; verificare una sola fermata Tab, navigazione con le quattro frecce, Invio/Spazio, Esc e orientamento dopo F.
3. Eseguire una promozione: testare Q/R/B/N, Tab/Shift+Tab/Esc e ritorno del focus.
4. Aprire/chiudere importazione online ed editor FEN con mouse e tastiera; verificare focus iniziale, focus trap, Esc, click sul backdrop e ritorno del focus.
5. Provare input errati: PGN non valido, token Lichess mancante, errori database e mosse illegali; verificare testo, colore e annuncio.
6. Provare tema Scuro/Chiaro/Sistema, Salvia/Noce/Ardesia, coordinate Dentro/Nascoste, movimento Ridotto e impostazione sistema.
7. Ripetere click, tastiera, rotazione e annotazioni dopo ogni cambio tema; verificare Dashboard, FSRS, Chess Lab, importazione e Protezione dati.