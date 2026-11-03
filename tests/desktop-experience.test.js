import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, main, tauriConfig] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
]);

test("desktop appearance controls expose every supported preference", () => {
  for (const id of ["ui-theme-select", "board-theme-select", "board-coordinates-select", "motion-select"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing control " + id);
  }
  for (const value of ["dark", "light", "system", "sage", "walnut", "slate", "inside", "hidden", "reduced"]) {
    assert.ok(html.includes('value="' + value + '"'), "missing option " + value);
  }
  assert.match(main, /saveUiPreferences\(uiPreferences\)/);
  assert.match(main, /uiPreferences\.coordinates === "inside"/);
});

test("chessboard supports arrow-key navigation and a single tab stop", () => {
  assert.match(main, /getAdjacentSquare\(current\.dataset\.square, event\.key, boardFlipped\)/);
  assert.match(main, /button\.tabIndex = square === focusSquare \? 0 : -1/);
  assert.match(main, /aria-keyshortcuts/);
  assert.match(main, /event\.key === "Home"/);
  assert.match(main, /event\.key === "End"/);
  assert.match(main, /event\.key\.toLowerCase\(\) === "f"/);
});

test("desktop dialogs declare modal semantics and return focus", () => {
  for (const id of ["online-import-dialog", "fen-editor-dialog", "promotion-dialog"]) {
    const index = html.indexOf('id="' + id + '"');
    const element = html.slice(index, html.indexOf(">", index) + 1);
    assert.match(element, /role="dialog"/);
    assert.match(element, /aria-modal="true"/);
  }
  assert.match(main, /function trapDialogTab/);
  assert.match(main, /onlineImportReturnFocus\.focus/);
  assert.match(main, /fenEditorReturnFocus\.focus/);
  assert.match(main, /promotionReturnFocus/);
});

test("requested desktop sizes have matching window constraints and responsive breakpoints", () => {
  const settings = JSON.parse(tauriConfig).app.windows[0];
  assert.equal(settings.width, 1440);
  assert.equal(settings.height, 940);
  assert.equal(settings.minWidth, 1080);
  assert.equal(settings.minHeight, 720);
  assert.match(css, /@media \(max-height: 780px\)/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /@media \(min-width: 1500px\)/);
  assert.match(css, /--board-size: min\(660px/);
});

test("errors and reduced-motion preferences are announced accessibly", () => {
  assert.match(main, /aria-live", type === "error" \? "assertive" : "polite"/);
  assert.match(main, /function hideToast/);
  assert.ok(html.includes('id="toast-close"'));
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /data-motion="reduced"/);
});
