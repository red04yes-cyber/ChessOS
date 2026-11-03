import test from "node:test";
import assert from "node:assert/strict";
import { listenForOptionalImportProgress } from "../src/online-import-progress.js";

test("registers the import progress listener when event access is granted", async () => {
  let eventName = "";
  let callback = null;
  const unlisten = () => {};
  const result = await listenForOptionalImportProgress(async (name, handler) => {
    eventName = name;
    callback = handler;
    return unlisten;
  }, () => {});
  assert.equal(eventName, "online-game-import-progress");
  assert.equal(typeof callback, "function");
  assert.equal(result, unlisten);
});

test("does not block a completed import when Tauri denies event listening", async () => {
  const denied = new Error("plugin:event|listen not allowed by ACL");
  let warning = null;
  const result = await listenForOptionalImportProgress(async () => { throw denied; }, () => {}, (error) => {
    warning = error;
  });
  assert.equal(result, null);
  assert.equal(warning, denied);
});

test("handles a missing listener API and a non-function cleanup result", async () => {
  let warning = null;
  assert.equal(await listenForOptionalImportProgress(null, () => {}, (error) => { warning = error; }), null);
  assert.match(warning.message, /non disponibile/i);
  assert.equal(await listenForOptionalImportProgress(async () => undefined, () => {}), null);
});
