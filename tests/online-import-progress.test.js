import test from "node:test";
import assert from "node:assert/strict";
import { listenForOptionalImportProgress } from "../src/online-import-progress.js";

test("registers progress listener and returns cleanup", async () => {
  let eventName = "";
  let callback = null;
  const cleanup = () => {};
  const result = await listenForOptionalImportProgress(async (name, handler) => {
    eventName = name; callback = handler; return cleanup;
  }, () => {});
  assert.equal(eventName, "online-game-import-progress");
  assert.equal(typeof callback, "function");
  assert.equal(result, cleanup);
});

test("does not block import when event listener is denied or unavailable", async () => {
  const denied = new Error("plugin:event|listen not allowed by ACL");
  let warning = null;
  assert.equal(await listenForOptionalImportProgress(async () => { throw denied; }, () => {}, e => { warning = e; }), null);
  assert.equal(warning, denied);
  assert.equal(await listenForOptionalImportProgress(null, () => {}, e => { warning = e; }), null);
  assert.match(warning.message, /non disponibile/i);
});
