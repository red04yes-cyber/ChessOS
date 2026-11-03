import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const capability = JSON.parse(await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

function directive(policy, name) {
  const entry = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + " "));
  return entry ? entry.slice(name.length).trim() : null;
}

test("Tauri CSP keeps scripts, workers, and connections on the local app and IPC origins", () => {
  const policy = config.app.security.csp;
  assert.equal(directive(policy, "default-src"), "'self'");
  assert.equal(directive(policy, "base-uri"), "'self'");
  assert.equal(directive(policy, "object-src"), "'none'");
  assert.equal(directive(policy, "script-src"), "'self' 'wasm-unsafe-eval'");
  assert.equal(directive(policy, "worker-src"), "'self'");
  assert.equal(directive(policy, "connect-src"), "ipc: http://ipc.localhost");
  assert.doesNotMatch(directive(policy, "connect-src"), /\*|https?:\/\/(?!ipc\.localhost)/i);
});

test("Tauri grants only the event listener permissions to the main window", () => {
  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(
    [...capability.permissions].sort(),
    ["core:event:allow-listen", "core:event:allow-unlisten"],
  );
});
