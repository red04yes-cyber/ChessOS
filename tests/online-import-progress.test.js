import test from "node:test";
import assert from "node:assert/strict";
import { listenForOptionalImportProgress } from "../src/online-import-progress.js";

test("registers the import progress listener when the host grants event access", async () => {
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

test("does not block imports when event listening is denied by Tauri ACL", async () => {
  const denied = new Error("plugin:event|listen not allowed by ACL");
  let warning = null;
  const result = await listenForOptionalImportProgress(async () => { throw denied; }, () => {}, (error) => {
    warning = error;
  });
  assert.equal(result, null);
  assert.equal(warning, denied);
});

test("does not block imports when the event listener API is absent", async () => {
  let warning = null;
  const result = await listenForOptionalImportProgress(null, () => {}, (error) => {
    warning = error;
  });
  assert.equal(result, null);
  assert.match(warning.message, /non disponibile/i);
});
