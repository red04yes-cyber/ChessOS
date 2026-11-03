# Backup e recupero del database

## Backup manuale
In Chess OS desktop, **Crea backup** usa l'Online Backup API di SQLite e produce un file `.sqlite3` autonomo. Lo snapshot include schema e dati presenti al momento della copia, anche quando il database attivo usa WAL. Il trasferimento dalla schermata è limitato a 64 MiB.

Nell'anteprima browser viene esportato un file JSON con i repertori conservati in localStorage: non è una copia del database SQLite desktop.

## Backup automatici
All'avvio, dopo i controlli d'integrità e le migrazioni, e dopo ogni salvataggio o eliminazione di un repertorio, l'app crea uno snapshot nella cartella `backups` accanto al database. Conserva gli ultimi cinque backup automatici. Prima di un ripristino manuale viene creato un ulteriore snapshot di sicurezza `chess-os-before-restore-*.sqlite3`.

## Ripristino
Il backup importato viene verificato con `PRAGMA quick_check`, `PRAGMA foreign_key_check`, versione dello schema e presenza delle tabelle essenziali. Il database attivo viene sostituito solo dopo la verifica; se l'operazione fallisce, l'app tenta il rollback allo snapshot creato prima del ripristino.

## Recupero da corruzione
All'avvio, se il database non supera i controlli di integrità, il file e gli eventuali sidecar WAL/SHM vengono conservati con suffisso `.corrupt-...`. L'app cerca quindi il backup automatico più recente che supera tutti i controlli e tenta il ripristino.

Se non esiste un backup automatico valido, Chess OS non crea un database vuoto al posto di quello danneggiato: interrompe l'avvio e indica dove è stato conservato il file. In quel caso si può importare un backup manuale o ricorrere a strumenti specializzati di recupero SQLite.

Un backup automatico è un punto di ripristino, non la ricostruzione dei dati successivi alla sua creazione. Esporta periodicamente un backup manuale e conservalo anche fuori dal dispositivo.

## Validazione e dipendenze
Il backend applica limiti alle dimensioni e ai metadati dei repertori e verifica FEN, chiavi di posizione, UCI, riferimenti tra nodi, ID degli archi e ordine delle varianti. CI esegue `npm audit --audit-level=high` e `cargo audit`; Dependabot propone aggiornamenti settimanali per npm e Cargo.
