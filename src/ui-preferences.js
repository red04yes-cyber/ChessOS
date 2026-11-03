const STORAGE_KEY = "chess-os.ui.v1";

const DEFAULT_PREFERENCES = Object.freeze({
  theme: "dark",
  boardTheme: "sage",
  coordinates: "inside",
  motion: "system",
});

const VALID = {
  theme: new Set(["dark", "light", "system"]),
  boardTheme: new Set(["sage", "walnut", "slate"]),
  coordinates: new Set(["inside", "hidden"]),
  motion: new Set(["system", "reduced"]),
};

export function readUiPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return Object.fromEntries(
      Object.entries(DEFAULT_PREFERENCES).map(([key, fallback]) => [
        key,
        VALID[key].has(stored?.[key]) ? stored[key] : fallback,
      ]),
    );
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function applyUiPreferences(preferences) {
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.dataset.boardTheme = preferences.boardTheme;
  root.dataset.coordinates = preferences.coordinates;
  root.dataset.motion = preferences.motion;
}

export function saveUiPreferences(preferences) {
  const safe = Object.fromEntries(
    Object.entries(DEFAULT_PREFERENCES).map(([key, fallback]) => [
      key,
      VALID[key].has(preferences?.[key]) ? preferences[key] : fallback,
    ]),
  );
  applyUiPreferences(safe);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    return true;
  } catch {
    return false;
  }
}

export function defaultUiPreferences() {
  return { ...DEFAULT_PREFERENCES };
}
