# Design system — Chess OS

## Obiettivo e ambito

Questa revisione aggiorna la presentazione desktop di Chess OS senza cambiare la logica scacchistica, il grafo dei repertori, i record salvati, le migrazioni SQLite o i comandi Tauri. La base reale del branch `main` comprende Studio, Dashboard, FSRS-6, esami del repertorio e libreria delle partite importate: queste aree restano presenti e vengono mantenute.

La UI resta HTML, CSS e JavaScript vanilla. Non vengono aggiunti framework, pacchetti di font, servizi remoti o asset caricati da CDN. La CSP Tauri non viene modificata.

## Architettura visiva

- **Superfici:** sfondo finestra `--bg-0`, barra e sidebar `--bg-1`, pannelli `--surface-1`, campi `--surface-2`, hover e stati selezionati `--surface-3`.
- **Accento:** ambra per azione primaria, selezione, focus e mossa corrente.
- **Successo:** verde esclusivamente per stati di conferma e progresso riuscito.
- **Avviso:** ambra per modifiche non salvate o condizioni da controllare.
- **Errore:** rosso per azioni o stati non riusciti.
- **Informazione:** azzurro per comunicazioni neutre.
- **Tipografia:** `Segoe UI Variable Text`, `Segoe UI`, `system-ui`. Non viene incluso un font binario: la scelta usa le famiglie UI installate sul sistema ed evita richieste di rete. Per FEN e notazione si usa `ui-monospace` con fallback di sistema.
- **Spaziatura:** griglia a multipli di 4 px, token `--space-1` … `--space-9`.
- **Raggi:** 6, 10, 14 e 18 px.
- **Ombre:** tre livelli definiti nei token.
- **Movimento:** 100, 160 e 240 ms; easing `cubic-bezier(.2,.8,.2,1)`. L'animazione FLIP delle mosse usa 180 ms; la dissolvenza della cattura 120 ms. Le preferenze e `prefers-reduced-motion` disattivano le animazioni.
- **Livelli:** sticky 10, menu 20, dialog 30, toast 40.

## Temi e preferenze

Le preferenze UI sono memorizzate in `localStorage` con la chiave separata `chess-os.ui.v1`; non vengono salvate in SQLite e non alterano i dati dei repertori.

| Impostazione | Valori |
|---|---|
| Tema interfaccia | Scuro, Chiaro, Sistema |
| Tema scacchiera | Salvia, Noce, Ardesia |
| Coordinate | Dentro, Nascoste |
| Animazioni | Segui il sistema, Ridotte |

Il tema scuro è il predefinito. Il tema Sistema segue `prefers-color-scheme`. I colori della scacchiera sono:
- Salvia: chiara `#e4dfcf`, scura `#7a9183`.
- Noce: chiara `#ecd9b9`, scura `#a97c50`.
- Ardesia: chiara `#cfd6de`, scura `#5f768c`.

## Pezzi SVG

I dodici simboli sono un set geometrico originale creato per questa revisione del progetto. Non viene incorporato un set di terze parti; non sono quindi richiesti crediti o licenze esterne. Lo sprite inline è compatibile con `img-src 'self' data:` e non carica risorse di rete.

Ogni casella mantiene un'etichetta accessibile italiana, per esempio "Cavallo bianco in f3" oppure "Casa vuota e4". La forma è disegnata con riempimento e contorno: nei pezzi chiari il contorno scuro distingue la sagoma sulle case chiare; nei pezzi scuri il riempimento scuro distingue la sagoma sulle case chiare e il contorno chiaro sulle case scure.

## Contrasti verificati

I rapporti sono calcolati con la formula WCAG di luminanza relativa, arrotondati a due decimali. Sono verifiche matematiche dei colori dichiarati, non una certificazione completa dell'interfaccia né una prova del rendering WebView2.

| Elemento / testo | Primo piano | Sfondo | Rapporto | Esito |
|---|---:|---:|---:|---|
| Testo principale scuro | `#eef2f7` | `#172029` | 14.65:1 | AA |
| Testo secondario scuro | `#b6c2d0` | `#172029` | 9.11:1 | AA |
| Testo terziario scuro | `#93a2b4` | `#172029` | 6.33:1 | AA |
| Testo principale chiaro | `#1b2530` | `#fbfaf6` | 14.85:1 | AA |
| Testo secondario chiaro | `#394858` | `#fbfaf6` | 8.97:1 | AA |
| Testo terziario chiaro | `#526477` | `#fbfaf6` | 5.83:1 | AA |
| Accento testuale chiaro | `#9a6408` | `#fbfaf6` | 4.79:1 | AA |
| Coordinate su case chiare (Salvia) | `#29343d` | `#e4dfcf` | 9.53:1 | Grafica AA |
| Coordinate su case scure (Salvia) | `#fffdf4` | `#7a9183` | 3.32:1 | Grafica AA |
| Coordinate su case scure (Noce) | `#fffdf4` | `#a97c50` | 3.62:1 | Grafica AA |
| Coordinate su case scure (Ardesia) | `#fffdf4` | `#5f768c` | 4.62:1 | Grafica AA |
| Contorno pezzo chiaro su casa scura (minimo) | `#17232d` | `#5f768c` | 3.39:1 | Grafica AA |
| Riempimento pezzo scuro su casa scura (minimo) | `#1c2832` | `#5f768c` | 3.19:1 | Grafica AA |
| Contorno pezzo scuro su casa scura (minimo) | `#fffdf7` | `#7a9183` | 3.33:1 | Grafica AA |

Nota sui pezzi: il riempimento del pezzo chiaro su una casa chiara non raggiunge da solo 3:1 (per esempio 1.27:1 su Salvia). In quel caso la silhouette è definita dal contorno scuro, che supera 3:1 su tutte le case chiare e scure considerate. Il pezzo scuro usa invece un riempimento che supera 3:1 su tutte le case dei tre temi; il contorno chiaro aumenta la leggibilità sulle case scure. Il contrasto dei dettagli sottili interni e di ogni stato forzato va ancora controllato visivamente.

## Scacchiera, coordinate e movimento

La scacchiera mantiene 64 pulsanti e il rendering imperativo esistente. Le coordinate sono inserite nelle caselle più vicine al lato e seguono la rotazione. L'opzione "Nascoste" rimuove solo le coordinate, non le etichette accessibili.

Il drag usa Pointer Events, soglia di 5 px, destinazioni legali, ghost temporaneo e la stessa funzione di commit usata dal clic–clic. Un rilascio fuori da una destinazione legale annulla il gesto senza messaggio. L'animazione FLIP viene derivata dall'oggetto mossa e considera anche la torre nell'arrocco e il pezzo catturato (inclusa la casa distinta della presa en passant). In modalità movimento ridotto la posizione cambia senza animazione.

## Slot per estensioni future

La struttura mantiene spazio logico per funzioni che non devono essere simulate:
```text
Workspace
├── Page heading and actions
└── Study grid
    ├── Board stage
    │   ├── Future evaluation rail (left of the board)
    │   └── Board panel
    └── Details column
        ├── Move line / variations
        ├── Future analysis card
        └── Existing review / exam panels
```
Non vengono aggiunti pannelli vuoti né voci "in arrivo". Il layout usa una colonna principale flessibile e una colonna di dettagli dimensionabile, così un'eventuale barra di valutazione può essere inserita senza cambiare il grafo o il database.

## Verifiche manuali su Windows

Le modifiche sono state apportate tramite il repository GitHub. Non ho accesso a un'istanza WebView2 visibile: non dichiaro verificato il risultato visivo. Dopo che la CI avrà concluso i controlli automatici, verificare:

1. `npm install`, `npm test`, `npm run build`.
2. `npm run dev`: mosse clic-clic e trascinamento, arrocco, en passant, promozione, rotazione, import/export PGN, salvataggio in localStorage.
3. `npm run tauri:dev` su Windows: salvataggio SQLite, apertura, eliminazione, migrazione da localStorage, assenza di violazioni CSP in console.
4. Controllo visivo a 1080×720, 1440×940 e 1920×1080; verificare che caselle, pannelli e navigazione siano interamente visibili e senza scroll orizzontale.
5. Percorrere l'interfaccia con Tab, Shift+Tab, frecce, Invio ed Esc; verificare il focus visibile.
6. Provare Narrator, temi scuro/chiaro/Sistema, tre temi scacchiera, coordinate interne/nascoste e impostazione Ridotte.
7. Confrontare drag e clic–clic per catture, arrocco, en passant e promozione; ripetere con animazioni ridotte.
8. Verificare FSRS, Dashboard, esami e libreria di partite importate, per accertarsi che la revisione grafica non abbia cambiato i flussi.

## Stato delle fasi di questa revisione

- Fase 1 — token, superfici, tipografia, componenti base: implementata.
- Fase 2 — topbar, sidebar e nuova struttura di lavoro: implementata; verifica visiva manuale ancora necessaria.
- Fase 3 — SVG, coordinate interne, temi, drag e FLIP: implementata nel codice; prove reali di input e rendering ancora necessarie.
- Fase 4 — preferenze e scorciatoie principali: parziale; dialog personalizzati, toast tipizzati e focus trap completi non ancora implementati.
- Fase 5 — notazione, varianti, ricerca e menu repertori: parziale; notazione e varianti sono ridisegnate, la ricerca e i menu per repertorio non sono ancora implementati.
- Fase 6 — esperienza di allenamento: non ridisegnata integralmente; FSRS ed esami esistenti sono conservati.
- Fase 7 — documentazione e verifiche: documento presente; controlli automatici e manuali ancora da completare.
