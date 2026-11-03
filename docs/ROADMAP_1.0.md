# Chess OS — roadmap tecnica verso la versione 1.0

> Stato del progetto verificato il **3 novembre 2026**. Questa roadmap descrive il lavoro necessario per passare dall'attuale rebuild 0.1.0 a una release 1.0 mantenibile, verificabile e distribuibile. Non considera recuperato il vecchio archivio 0.7.0.

## 1. Valutazione dello stato attuale

### Fondazione presente in `main`

Il repository contiene una desktop app Windows-first basata su **Tauri 2, Vite, JavaScript e Rust/SQLite**, con anteprima browser che usa localStorage. La base applicativa include:

- scacchiera interattiva e validazione delle mosse con `chess.js`;
- navigazione della cronologia e gestione delle posizioni iniziali personalizzate;
- repertori ad albero, varianti, trasposizioni, import/export PGN e RAV;
- persistenza locale SQLite nel desktop, migrazioni versionate e import legacy da localStorage;
- commenti e NAG associati alle mosse nel modello del grafo;
- test JavaScript, test Rust/SQLite e workflow Windows per l'installer.

La base è quindi adatta a estendere lo studio del repertorio, ma prima della 1.0 serve consolidare l'integrazione delle feature già proposte: al momento diverse funzionalità esistono in branch e PR, non nella versione distribuita da `main`.

### Pull request aperte da integrare

| PR | Contenuto | Evidenza CI verificata | Nota d'integrazione |
|---|---|---|---|
| [#12](https://github.com/red04yes-cyber/ChessOS/pull/12) | Validazione SQLite, backup, restore, snapshot automatici e audit dipendenze | Frontend verde; job Windows/Rust fallito nella run [41584361244](https://github.com/red04yes-cyber/ChessOS/actions/runs/41584361244) | Errore Rust `E0282` in `src-tauri/src/db.rs:945`, inferenza del tipo di `rollback_result`. Da correggere e verificare nuovamente prima di considerare completata la protezione dei dati. |
| [#13](https://github.com/red04yes-cyber/ChessOS/pull/13) | FSRS-6, carte di ripasso, sessioni e cronologia | Run [41584266971](https://github.com/red04yes-cyber/ChessOS/actions/runs/41584266971) verde | Fondazione necessaria per ripassi, statistiche e obiettivi. |
| [#14](https://github.com/red04yes-cyber/ChessOS/pull/14) | Motore Stockfish 19 via UCI | Run [41584339381](https://github.com/red04yes-cyber/ChessOS/actions/runs/41584339381) verde | Completare il controllo delle note di licenza e la verifica desktop manuale. |
| [#15](https://github.com/red04yes-cyber/ChessOS/pull/15) | Correzione training da FEN personalizzata e test/installer smoke test | Run [41584302349](https://github.com/red04yes-cyber/ChessOS/actions/runs/41584302349) verde | Utile per affidabilità del training e del rilascio. |
| [#16](https://github.com/red04yes-cyber/ChessOS/pull/16) | Gestione avanzata repertori: ricerca, tag e colori a livello di repertorio, duplicazione e import PGN multiplo | Nessuna run CI associata al commit esaminata | Branch basato su una revisione più vecchia di `main`; da riallineare e testare. I tag qui sono a livello di repertorio, non ancora di singola variante/mossa. |
| [#18](https://github.com/red04yes-cyber/ChessOS/pull/18) | Dashboard, obiettivi e primi esami di repertorio | Run [41583709551](https://github.com/red04yes-cyber/ChessOS/actions/runs/41583709551) verde | Dipende dalla #13. La base della PR punta a una revisione precedente dell'head FSRS: riallineare lo stack prima dell'integrazione. |

La PR #17 è già stata chiusa come superata dalla #18. Le PR elencate restano aperte e non vanno considerate parte di una release finché non sono integrate e verificate insieme.

### Rischi tecnici già visibili

1. **Migrazioni SQLite concorrenti.** La base di `main` arriva alla migrazione v2. La PR #13 usa la v3 per FSRS; la PR #16 usa anch'essa la v3 per `tags_json` e `color`; la PR #18 usa la v4 per dashboard ed esami. Le migrazioni non possono essere unite mantenendo questi numeri: va definita una sequenza unica e continua, con test di upgrade da ogni schema supportato.
2. **File frontend molto condivisi.** Le PR modificano in parte gli stessi file (`src/main.js`, `index.html`, `src/style.css`, `src-tauri/src/db.rs` e workflow). Le integrazioni vanno serializzate e testate sul risultato combinato, non soltanto sui branch isolati.
3. **Backup prima della sincronizzazione.** La sync cloud non dovrebbe essere iniziata finché export/restore, migrazioni e recovery locale non sono affidabili.
4. **Funzionalità da distinguere.** I tag della #16 classificano il repertorio; i tag richiesti per «linea critica», «trappola» o «da ripassare» devono poter classificare anche una variante o una singola mossa.

## 2. Obiettivo della 1.0

La 1.0 dovrebbe essere una versione desktop stabile in cui un utente possa:

- costruire e organizzare repertori con varianti, commenti e annotazioni visive;
- analizzare le posizioni con Stockfish;
- ripassare con FSRS e misurare i progressi;
- creare esami ripetibili e verificabili;
- proteggere e ripristinare i dati;
- installare, aggiornare e disinstallare l'app senza perdere il database.

La priorità della 1.0 è **integrità dei dati, qualità del training e affidabilità del rilascio**. Cloud sync e classifiche pubbliche sono importanti, ma introducono backend, autenticazione, privacy e risoluzione dei conflitti: è preferibile svilupparli dopo aver stabilizzato il modello dati. La roadmap li mantiene esplicitamente nel percorso prodotto, senza far dipendere la prima release stabile da un servizio remoto ancora da progettare.

## 3. Roadmap per fasi

### Fase 0 — Consolidamento della base

**Obiettivo:** integrare in modo coerente le feature già implementate nei branch.

- [ ] Correggere l'errore Rust `E0282` della PR #12 e ottenere una run Windows completamente verde.
- [ ] Riallineare le PR con base obsoleta e risolvere le sovrapposizioni nei file condivisi.
- [ ] Definire una sola numerazione delle migrazioni SQLite. Se FSRS viene integrato come v3, assegnare una nuova versione alla migrazione dei tag e spostare quelle successive; non riutilizzare un numero già applicato.
- [ ] Aggiornare la PR #18 sulla revisione effettiva della PR #13 da cui dipende.
- [ ] Eseguire test completi dopo ogni integrazione: suite JavaScript, build Vite, test Rust/SQLite, audit dipendenze e packaging Windows.
- [ ] Aggiungere test di upgrade di un database esistente, non soltanto test su database vuoti.

**Criterio di uscita:** tutte le feature già presenti nelle PR che si decide di includere sono integrate su una sequenza di branch chiara; CI verde sul commit risultante; nessuna migrazione duplicata o non testata.

### Fase 1 — Annotazioni avanzate e classificazione delle varianti

**Obiettivo:** rendere ogni posizione e ogni mossa comprensibile e organizzabile.

#### 1A. Annotazioni avanzate

Il modello delle mosse già conserva commenti e NAG. L'estensione deve aggiungere:

- [ ] Editor di commenti per la mossa selezionata, con salvataggio esplicito e indicatore di modifiche non salvate.
- [ ] Simboli scacchistici selezionabili (ad esempio `!`, `?`, `!!`, `??`, `!?`, `?!`) e visualizzazione coerente nella notazione.
- [ ] Frecce tra caselle e marcatori/colori sulle caselle della scacchiera.
- [ ] Modifica, selezione e rimozione delle annotazioni visive senza alterare la posizione o la legalità delle mosse.
- [ ] Persistenza in SQLite e parità del formato localStorage per l'anteprima browser.
- [ ] Import/export PGN delle annotazioni supportate. Usare direttive compatibili con gli strumenti PGN più comuni, preservando anche i commenti non riconosciuti senza corromperli.

**Modello dati suggerito:** mantenere commenti e NAG sugli archi/mosse; associare frecce e marcatori alla posizione/nodo del repertorio con una struttura tipizzata (casella, origine, destinazione, colore e tipo). Evitare di serializzare l'annotazione visiva come HTML libero. Validare coordinate e colori nel backend Rust prima della persistenza.

**Test di accettazione:** round-trip PGN con commenti/NAG; round-trip SQLite delle frecce e dei marcatori; annotazioni visibili dopo riapertura; nessuna perdita dopo cambio variante, rotazione scacchiera o transposizione; input malformati rifiutati dal backend.

#### 1B. Tag personalizzati per repertori e varianti

La PR #16 copre tag e colore a livello di repertorio. La 1.0 deve completare la classificazione a livello di variante:

- [ ] Conservare i tag e i colori del repertorio introdotti dalla #16.
- [ ] Aggiungere tag a singoli archi/varianti, per esempio «tattica», «linea critica», «trappola», «da ripassare», «novità».
- [ ] Consentire creazione, rinomina e rimozione dei tag personalizzati.
- [ ] Associare un colore al tag e mostrare chip coerenti in notazione, elenco varianti e filtri.
- [ ] Filtrare/ricercare repertori e varianti per uno o più tag.
- [ ] Consentire l'avvio di una sessione FSRS o di un esame a partire da un tag.

**Modello dati suggerito:** entità tag con ID stabile, nome normalizzato e colore; relazione molti-a-molti tra tag e archi di repertorio. Evitare di usare il nome visualizzato come identificatore: una rinomina non deve perdere le associazioni. Le eliminazioni devono essere transazionali e con comportamento esplicito sulle associazioni.

**Test di accettazione:** filtri combinati; rinomina senza perdita dei collegamenti; eliminazione con gestione delle associazioni; persistenza e import/export; tag non validi o payload troppo grandi rifiutati.

### Fase 2 — Esami personalizzati e gamification locale

**Obiettivo:** trasformare dashboard ed esami di base della #18 in strumenti di valutazione configurabili.

#### 2A. Generatore di test personalizzati

La #18 fornisce la prima versione: selezione del repertorio, lato, numero di domande, soglia di superamento e cronologia. Le estensioni richieste sono:

- [ ] Filtri per repertorio, tag, lato e intervallo di mosse/semimosse.
- [ ] Livello di difficoltà configurabile; inizialmente basato su criteri trasparenti (profondità della linea, numero di continuazioni, tag di criticità). Non presentare una difficoltà stimata come valutazione oggettiva se non è supportata da dati.
- [ ] Tipi di esercizio: trova la prossima mossa, completa una sequenza, ripeti una linea completa, riconosci la continuazione corretta.
- [ ] Configurazione salvabile come modello di esame e possibilità di ripetere un esame.
- [ ] Risultato dettagliato per domanda, con risposta attesa, risposta data e posizione iniziale.
- [ ] Cronologia con accuratezza, tempo, filtri e modello utilizzato.

Stockfish potrà offrire in seguito esercizi «trova la mossa migliore», ma questi vanno distinti dai test di memoria del repertorio: valutano abilità differenti.

**Regola importante:** un esame non deve modificare automaticamente lo stato FSRS. L'eventuale conversione di un errore in carta di ripasso deve essere un'azione separata e tracciabile.

**Test di accettazione:** pool di domande senza duplicati; filtri corretti; test deterministici con seed; impossibilità di completare un esame con risposte mancanti; persistenza del risultato dopo riavvio; nessuna modifica involontaria alle schedule FSRS.

#### 2B. Achievement e classifiche

Implementare prima una gamification locale, indipendente da account e rete:

- [ ] Obiettivi sbloccabili per numero di ripassi, sessioni completate, repertori coperti ed esami superati.
- [ ] Serie di studio giornaliere e record personali.
- [ ] Achievement con condizioni esplicite e versionate, per evitare che una modifica alle regole alteri retroattivamente i risultati.
- [ ] Pagina personale con progressi, achievement ottenuti e prossimi obiettivi.
- [ ] Preferenza per notifiche non invasive e possibilità di disabilitarle.

Le classifiche tra utenti devono arrivare solo con il servizio cloud: richiedono account, consenso, pseudonimi, regole anti-abuso e dati verificabili dal server. Non usare i contatori locali come fonte attendibile per una classifica pubblica.

**Test di accettazione:** achievement idempotenti; nessun doppio sblocco; streak coerenti con il fuso orario scelto; dati conservati nei backup; regole versionate e testate.

### Fase 3 — Sincronizzazione cloud e classifiche online

**Obiettivo:** sincronizzare più dispositivi senza mettere a rischio repertori e cronologia.

Questa fase va avviata dopo aver stabilizzato schema, backup e restore.

- [ ] Scegliere e documentare il backend remoto, il provider di autenticazione e la regione di conservazione dei dati.
- [ ] Definire account, sessioni, revoca dei dispositivi e recupero dell'account.
- [ ] Progettare API versionate e un protocollo di sincronizzazione incrementale.
- [ ] Aggiungere identificatori stabili, versioni/revisioni, timestamp e tombstone per le cancellazioni.
- [ ] Implementare coda offline/outbox, retry con backoff, deduplicazione e idempotenza.
- [ ] Mostrare conflitti di modifica del repertorio e offrire confronto/recupero invece di sovrascrivere silenziosamente una versione.
- [ ] Sincronizzare prima repertori, annotazioni, tag e preferenze; poi carte, log, sessioni, obiettivi ed esami.
- [ ] Definire esplicitamente come ricostruire o riconciliare lo stato FSRS da eventi di revisione provenienti da più dispositivi.
- [ ] Proteggere il trasporto con TLS, custodire i token nel secure storage del sistema e documentare retention, esportazione e cancellazione dell'account.
- [ ] Aggiungere backup remoto e ripristino selettivo.
- [ ] Abilitare classifiche online solo su dati convalidati dal server, con opt-in e pseudonimo.

**Modello suggerito:** offline-first con coda di modifiche, revisioni per entità e conflitti espliciti. I log di ripasso dovrebbero essere trattati come eventi append-only; lo stato FSRS va riconciliato con regole deterministiche e testate, non sincronizzato come un semplice campo sovrascrivibile.

**Test di accettazione:** due dispositivi offline che modificano dati; riconnessione e retry; duplicati e cancellazioni; conflitti concorrenti; revoca dispositivo; restore dopo perdita locale; nessun token nei log; test del flusso di cancellazione account.

## 4. Perimetro raccomandato per la 1.0

| Area | Requisito 1.0 |
|---|---|
| Repertori e PGN | Gestione affidabile di linee, varianti, trasposizioni, ricerca, tag e import multi-game |
| Annotazioni | Commenti, NAG, frecce e marcatori persistenti ed esportabili |
| Analisi | Stockfish integrato, con gestione robusta di avvio, arresto e errori |
| Training | FSRS, sessioni, cronologia, dashboard e obiettivi |
| Esami | Filtri, modalità di esercizio, difficoltà spiegabile e risultati persistenti |
| Gamification | Achievement locali, streak e record personali |
| Affidabilità | Backup/restore verificati, migrazioni sequenziali, validazione e audit dipendenze |
| Distribuzione | Installer Windows verificato, upgrade senza perdita dati, checksum, note e licenza |

**Scelta di rilascio consigliata:** includere nella 1.0 le classifiche personali/locali; mantenere sync cloud e classifiche pubbliche in beta opt-in o nella 1.1, a meno che backend, privacy e conflitti non siano già verificati end-to-end. È meglio una 1.0 locale affidabile che una sincronizzazione remota che rischi di perdere o sovrascrivere i repertori.

## 5. Gate tecnici prima della release 1.0.0

### Dati e migrazioni
- [ ] Migrazioni transazionali, idempotenti e numerate senza collisioni.
- [ ] Test automatici da ogni schema supportato fino allo schema finale.
- [ ] Backup SQLite verificato con database in modalità WAL.
- [ ] Restore testato su database valido, corrotto e versione non supportata.
- [ ] Esportazione PGN conservata come formato portabile indipendente dal backup completo.

### Qualità
- [ ] Suite JavaScript completa e build frontend verde.
- [ ] Test Rust/SQLite verdi su Windows.
- [ ] Audit npm e RustSec senza vulnerabilità bloccanti non accettate formalmente.
- [ ] Test di regressione su PGN standard e FEN personalizzate, varianti, trasposizioni, promozioni, annotazioni e training interrotto.
- [ ] Nessuna perdita di dati durante aggiornamento, restore, import o cancellazione.

### Distribuzione e progetto
- [ ] Installazione, avvio, upgrade e disinstallazione provati su una macchina Windows pulita.
- [ ] Installer e checksum generati dallo stesso commit verificato.
- [ ] Licenza del progetto scelta e file `LICENSE` aggiunto.
- [ ] Note e obblighi delle dipendenze, incluso Stockfish se distribuito, verificati.
- [ ] Versione, changelog, documentazione, troubleshooting e note di rilascio aggiornati.
- [ ] Protezione di `main` con PR obbligatoria e status checks richiesti.

La release non va dichiarata pronta sulla base del solo successo del frontend: per una desktop app con database locale servono anche test Rust, packaging, restore e prova di upgrade.

## 6. Definition of Done per ogni feature

Una funzionalità è completata solo quando:

1. l'interfaccia copre stato vuoto, caricamento, errore, conferma e modifiche non salvate;
2. il backend valida input, limiti e riferimenti prima di scrivere;
3. dati e migrazioni sono coperti da test, inclusa la persistenza dopo riavvio;
4. l'anteprima browser mantiene un comportamento documentato, senza fingere di usare SQLite o il cloud;
5. import/export conserva i dati supportati e segnala ciò che non può rappresentare;
6. CI è verde sul commit esatto della feature e la verifica desktop manuale è registrata.

## 7. Decisioni ancora da prendere

- Licenza del progetto e strategia di distribuzione delle dipendenze.
- Provider/backend cloud, costi operativi e regione dei dati.
- Se la sync cloud è requisito obbligatorio della 1.0 o feature 1.1.
- Se le classifiche sono globali, private tra amici o solo personali.
- Quali formati PGN di annotazione visiva sono richiesti per interoperabilità.
- Quali livelli di difficoltà e tipologie di esame devono essere inclusi nella prima release.

---

**Principio guida:** prima rendere impossibile perdere il lavoro dell'utente; poi rendere più efficace lo studio; infine aggiungere sincronizzazione e competizione online.