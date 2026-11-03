# Aggiornamenti automatici e pubblicazione delle versioni

## Comportamento dell'app

Le build di distribuzione create con `src-tauri/tauri.release.conf.json` controllano il canale GitHub Releases di ChessOS all'avvio e poi ogni 30 minuti. L'aggiornamento viene scaricato in background e installato automaticamente solo quando lo Studio è inattivo, non ci sono modifiche non salvate e non sono in corso importazioni, sessioni di allenamento o esami. Su Windows l'installer NSIS passivo installa la versione firmata e riavvia l'app. Un errore di rete o di verifica non blocca l'avvio né l'uso dell'app.

L'anteprima browser e le build locali standard non usano il canale di aggiornamento.

## Configurazione iniziale obbligatoria (una sola volta)

Tauri verifica la firma dell'aggiornamento; non accetta aggiornamenti non firmati. Genera una coppia di chiavi sul tuo computer di fiducia:

```powershell
npm install
npm run tauri signer generate -- -w "$HOME\.tauri\chessos.key"
```

Conserva il file `chessos.key` e la relativa password in un password manager o in un archivio offline protetto. **Non committare e non inviare mai la chiave privata.** La chiave pubblica viene stampata dal comando del signer: sostituisci soltanto il valore segnaposto di `plugins.updater.pubkey` in `src-tauri/tauri.release.conf.json` con quella chiave pubblica.

Nel repository GitHub, crea i seguenti Actions secrets (Settings → Secrets and variables → Actions):

- `TAURI_SIGNING_PRIVATE_KEY`: contenuto completo del file privato `chessos.key`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password scelta durante la generazione; lascia il secret vuoto solo se hai deliberatamente generato una chiave senza password.

La chiave privata deve rimanere soltanto nel secret GitHub e nella tua copia locale protetta. Se viene persa, gli aggiornamenti firmati con la nuova chiave non saranno accettati dalle installazioni che contengono la vecchia chiave pubblica.

## Procedura per OGNI nuova versione

1. Aggiorna la versione SemVer in `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`; i tre numeri devono coincidere.
2. Aggiungi le note in `docs/releases/vX.Y.Z.md` e assicurati che test e build siano verdi.
3. Crea e invia il tag `vX.Y.Z`. Il push del tag esegue le verifiche ma **non pubblica** una release.
4. Prima di pubblicare, chiedi e ottieni l'autorizzazione esplicita del proprietario del progetto.
5. Solo dopo l'autorizzazione, apri Actions → “Chess OS verification and Windows installer”, seleziona il tag `vX.Y.Z` nel campo “Use workflow from” e invia il workflow scrivendo esattamente `PUBBLICA vX.Y.Z` nel campo `release_confirmation`.
6. Il job di pubblicazione parte soltanto se entrambe le condizioni (workflow manuale su un tag e stringa di conferma esatta) sono soddisfatte e i test/build Windows sono superati. Pubblica installer, checksum, bundle NSIS firmato, firma e `latest.json`.

Un semplice commit, un push su `main` o un push di tag non può pubblicare una release. Non avviare il workflow manuale e non compilare il token di approvazione senza una nuova autorizzazione esplicita per quella specifica versione.

## Prima attivazione per installazioni esistenti

Le installazioni distribuite prima dell'introduzione del plugin updater non contengono il codice che controlla gli aggiornamenti e quindi non possono aggiornarsi da sole alla prima versione dotata di updater. Per passare a questa versione iniziale serve una sola installazione manuale del nuovo setup; da quel momento in poi gli aggiornamenti firmati saranno automatici.
