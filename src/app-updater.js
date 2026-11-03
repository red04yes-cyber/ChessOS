export async function downloadPendingAppUpdate(check, logger = console) {
  let update = null;
  try {
    update = await check({ timeout: 15_000 });
    if (!update) return null;

    // Download in the background, but defer installation until the app is idle
    // and every user change has been saved.
    await update.download();
    return update;
  } catch (error) {
    try {
      await update?.close?.();
    } catch {
      // A failed cleanup must not interfere with normal application startup.
    }
    logger.warn("Controllo o download aggiornamento Chess OS non riuscito:", error);
    return null;
  }
}

export async function installPendingAppUpdate(update, canInstall, logger = console) {
  if (!update || typeof canInstall !== "function" || !canInstall()) return false;

  try {
    // The Windows updater closes the app, installs the NSIS update and
    // restarts Chess OS (restartAfterInstall defaults to true).
    await update.install({ restartAfterInstall: true });
    return true;
  } catch (error) {
    logger.warn("Installazione automatica aggiornamento Chess OS non riuscita:", error);
    return false;
  }
}
