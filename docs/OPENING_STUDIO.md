# Editor FEN, catalogo ECO e annotazioni visuali

## Catalogo delle aperture

Chess OS include una copia offline del dataset `lichess-org/chess-openings`:

- 3.865 sequenze di apertura
- 500 codici ECO, da A00 a E99, senza codici mancanti
- 150 famiglie di aperture
- PGN e nomi delle varianti per il riconoscimento delle posizioni

Sorgente: https://github.com/lichess-org/chess-openings

Revisione upstream inclusa: `712a58be746c143f4ab935b68acc50f4bac813eb`

Licenza: CC0 1.0 Universal / public domain dedication. Il dataset è un insieme di fatti curati; la dichiarazione e le note di copyright sono nel repository upstream. La copia è inclusa in `src/data/lichess-openings.js`. Il test `tests/opening-catalog.test.js` controlla i 500 codici ECO e riproduce ogni sequenza PGN con `chess.js`.

La classificazione confronta la posizione corrente con la posizione finale di ogni riga del catalogo usando disposizione dei pezzi, lato al tratto, diritti di arrocco e casa en passant. La UI mostra l'ultima posizione catalogata raggiunta nella linea. Una posizione che non coincide con una delle posizioni nominate non riceve un ECO inventato.

## Repertori iniziali

I quattro repertori iniziali sono costruiti dalle righe complete del dataset, non da una sola variante dimostrativa:

| Famiglia | Righe incluse |
|---|---:|
| Difesa Siciliana | 400 |
| Partita Italiana | 187 |
| Difesa Francese | 211 |
| Difesa Caro-Kann | 110 |

I percorsi condivisi sono uniti in un unico grafo di varianti e le transposizioni vengono conservate secondo le regole del grafo. Il caricamento importa il repertorio nell'editor corrente; l'utente deve premere **Salva linea** per conservarlo nel database locale.

"Completo" qui significa completo rispetto alle righe incluse nel catalogo Lichess e ai relativi codici ECO. Non significa che la teoria scacchistica sia finita o che ogni risposta teoricamente possibile sia contenuta nel dataset: nuove linee e analisi online rimangono utili.

## Editor FEN

L'editor visuale permette di aggiungere e rimuovere pezzi sulla scacchiera, scegliere il colore al tratto e impostare arrocco, en passant e contatori. Una posizione viene applicata solo se la FEN completa viene accettata da `chess.js` e supera i controlli supplementari su re, pedoni, arrocco ed en passant.

## Frecce, colori e annotazioni

Le marcature delle caselle e le frecce vengono serializzate nei commenti PGN con i tag standard `[%csl ...]` e `[%cal ...]`. I commenti e i NAG delle mosse sono salvati nel grafo del repertorio e quindi sopravvivono alla serializzazione SQLite e all'esportazione PGN. Le annotazioni della posizione iniziale sono conservate negli header Chess OS del PGN.

Colori supportati: verde, rosso, giallo e blu. Valutazioni supportate: `!`, `?`, `!!`, `??`, `!?`, `?!`, `=` e `∞`.
