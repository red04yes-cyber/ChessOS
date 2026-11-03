const IMPORT_PROGRESS_EVENT = "online-game-import-progress";

/**
 * Register progress notifications when the host allows event listening.
 * Import itself must not depend on this optional UI channel.
 */
export async function listenForOptionalImportProgress(listenFn, onProgress, onUnavailable = () => {}) {
  if (typeof listenFn !== "function") {
    onUnavailable(new TypeError("Listener eventi non disponibile."));
    return null;
  }
  try {
    const unlisten = await listenFn(IMPORT_PROGRESS_EVENT, onProgress);
    return typeof unlisten === "function" ? unlisten : null;
  } catch (error) {
    onUnavailable(error);
    return null;
  }
}
