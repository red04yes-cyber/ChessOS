import test from "node:test";
import assert from "node:assert/strict";
import {
  applyUiPreferences,
  defaultUiPreferences,
  readUiPreferences,
  saveUiPreferences,
} from "../src/ui-preferences.js";

function withLocalStorage(run) {
  const previousStorage = globalThis.localStorage;
  const previousDocument = globalThis.document;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  globalThis.document = { documentElement: { dataset: {} } };
  try { run(values); } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

test("uses the documented default appearance preferences", () => {
  assert.deepEqual(defaultUiPreferences(), {
    theme: "dark",
    boardTheme: "sage",
    coordinates: "inside",
    motion: "system",
    accent: "amber",
    density: "compact",
    boardSize: "medium",
    sidebar: "full",
  });
});

test("persists and reloads supported appearance preferences", () => {
  withLocalStorage((values) => {
    const preferences = {
      theme: "light",
      boardTheme: "walnut",
      coordinates: "hidden",
      motion: "reduced",
      accent: "blue",
      density: "comfortable",
      boardSize: "large",
      sidebar: "compact",
    };
    assert.equal(saveUiPreferences(preferences), true);
    assert.deepEqual(readUiPreferences(), preferences);
    assert.equal(JSON.parse(values.get("chess-os.ui.v1")).boardTheme, "walnut");
  });
});

test("normalizes invalid stored values instead of applying arbitrary themes", () => {
  withLocalStorage((values) => {
    values.set("chess-os.ui.v1", JSON.stringify({
      theme: "remote-url",
      boardTheme: "neon",
      coordinates: "visible",
      motion: "fast",
      accent: "invalid",
      density: "dense",
      boardSize: "huge",
      sidebar: "hidden",
    }));
    assert.deepEqual(readUiPreferences(), defaultUiPreferences());
  });
});

test("applies preferences to root data attributes", () => {
  const previousDocument = globalThis.document;
  const root = { dataset: {} };
  globalThis.document = { documentElement: root };
  try {
    applyUiPreferences({ theme: "system", boardTheme: "slate", coordinates: "hidden", motion: "reduced", accent: "green", density: "comfortable", boardSize: "small", sidebar: "compact" });
    assert.deepEqual(root.dataset, {
      theme: "system",
      boardTheme: "slate",
      coordinates: "hidden",
      motion: "reduced",
      accent: "green",
      density: "comfortable",
      boardSize: "small",
      sidebar: "compact",
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
