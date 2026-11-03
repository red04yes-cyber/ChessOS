# Importazione delle partite da Chess.com e Lichess

## Interfaccia

In ChessOS desktop apri **Importa partite online**, scegli la piattaforma e inserisci lo username. L'importazione scarica le partite concluse e le colloca nella sezione **Partite importate** della sidebar.

Le partite importate non vengono convertite automaticamente in repertori: rimangono in una libreria separata. Selezionando una partita la si apre nello Studio; il pulsante **Salva linea** consente di copiarla nel repertorio solo quando l'utente lo decide.

## Chess.com

ChessOS usa la PubAPI ufficiale:
1. legge l'elenco degli archivi mensili da `/pub/player/{username}/games/archives`;
2. richiede in sequenza il PGN mensile da `/pub/player/{username}/games/{YYYY}/{MM}/pgn`;
3. divide il PGN multi-partita e inserisce i singoli giochi in SQLite.

L'API è pubblica e read-only. Sono importabili i dati di gioco pubblicamente disponibili; ChessOS non può accedere a chat private o mosse condizionali. Chess.com aggiorna gli endpoint con una cache che può arrivare a 12 ore e raccomanda richieste seriali per evitare il rate limiting.

## Lichess

ChessOS chiama l'endpoint ufficiale `GET /api/games/user/{username}` e richiede il PGN in streaming. L'endpoint richiede autenticazione OAuth; per questa prima versione desktop l'utente inserisce un proprio token API personale Lichess.

- Crea un token dalla pagina [Personal API access tokens](https://lichess.org/account/oauth/token).
- Inserisci il token direttamente nella finestra ChessOS quando selezioni Lichess.
- Il token viene passato al backend Tauri solo per effettuare la richiesta. Non viene scritto in SQLite, localStorage, log o file di configurazione; il campo viene svuotato al termine dell'importazione.
- Non condividere il token. Può essere revocato dalla stessa pagina Lichess.

Questa integrazione con token personale è pensata per l'uso desktop individuale. Prima di distribuire una modalità di connessione multiutente semplificata, è preferibile implementare il flusso OAuth2 Authorization Code con PKCE e token separati per ogni utente.

Lichess raccomanda di fare una sola richiesta alla volta. In caso di HTTP 429, attendere almeno 60 secondi prima di riprovare. ChessOS usa una singola richiesta stream e non scarica archivi in parallelo.

## Integrità, duplicati e varianti

- Le partite sono salvate nella tabella SQLite `imported_games`, separata da `repertoires`, carte FSRS e risultati degli esami.
- L'identità remota è la coppia provider/ID partita. Reimportare lo stesso archivio non crea copie: i record già presenti vengono saltati.
- I record vengono scritti in piccoli batch, così una lunga importazione non mantiene bloccato il database durante le richieste HTTP.
- Sono importate partite concluse in formato PGN standard. Varianti non supportate dalla scacchiera attuale (ad esempio Chess960 o Bughouse) e PGN malformati vengono conteggiati come ignorati.
- I dati restano sul dispositivo. Questa funzione non attiva sincronizzazione cloud e non modifica i repertori già salvati.
- La preview browser non esegue l'importazione: il client API è nel backend Rust della versione desktop Tauri.

## Verifica manuale

1. Importa un account di test con poche partite da Chess.com.
2. Ripeti l'importazione: il numero di nuove partite deve essere zero e tutte le partite esistenti conteggiate come duplicate.
3. Apri una partita importata nello Studio e controlla data, nomi, risultato e sequenza mosse.
4. Salva la partita nel repertorio e verifica che la voce importata originale resti nella libreria.
5. Ripeti il flusso con Lichess usando un token personale valido; verifica che il campo token sia vuoto al termine e che il token non compaia nel database né nei log.
6. Prova uno username inesistente, un token rifiutato e un HTTP 429 e controlla i messaggi di errore.
