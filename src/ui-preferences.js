const STORAGE_KEY = "chess-os.ui.v1";

const DEFAULT_PREFERENCES = Object.freeze({
  theme: "dark",
  boardTheme: "sage",
  coordinates: "inside",
  motion: "system",
  accent: "amber",
  density: "compact",
  boardSize: "medium",
  sidebar: "full",
});

const VALID = {
  theme: new Set(["dark", "light", "system"]),
  boardTheme: new Set(["sage", "walnut", "slate"]),
  coordinates: new Set(["inside", "hidden"]),
  motion: new Set(["system", "reduced"]),
  accent: new Set(["amber", "blue", "green", "rose"]),
  density: new Set(["compact", "comfortable"]),
  boardSize: new Set(["small", "medium", "large"]),
  sidebar: new Set(["full", "compact"]),
};

function normalize(preferences) {
  return Object.fromEntries(
    Object.entries(DEFAULT_PREFERENCES).map(([key, fallback]) => [
      key,
      VALID[key].has(preferences?.[key]) ? preferences[key] : fallback,
    ]),
  );
}

export function readUiPreferences() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function applyUiPreferences(preferences) {
  const root = document.documentElement;
  const safe = normalize(preferences);
  root.dataset.theme = safe.theme;
  root.dataset.boardTheme = safe.boardTheme;
  root.dataset.coordinates = safe.coordinates;
  root.dataset.motion = safe.motion;
  root.dataset.accent = safe.accent;
  root.dataset.density = safe.density;
  root.dataset.boardSize = safe.boardSize;
  root.dataset.sidebar = safe.sidebar;
}

export function saveUiPreferences(preferences) {
  const safe = normalize(preferences);
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
