import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const capability = JSON.parse(await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

function directive(policy, name) {
  const entry = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + " "));
  return entry ? entry.slice(name.length).trim() : null;
}

test("Tauri CSP applies local-only defaults and blocks base/object injection", () => {
  const policy = config.app.security.csp;
  assert.equal(directive(policy, "default-src"), "'self'");
  assert.equal(directive(policy, "base-uri"), "'self'");
  assert.equal(directive(policy, "object-src"), "'none'");
  assert.equal(directive(policy, "script-src"), "'self' 'wasm-unsafe-eval'");
  assert.ok(!directive(policy, "script-src").includes("'unsafe-inline'"));
  assert.ok(!directive(policy, "script-src").includes("'unsafe-eval'"));
  assert.equal(directive(policy, "worker-src"), "'self' blob:");
  assert.equal(directive(policy, "connect-src"), "ipc: http://ipc.localhost");
  assert.doesNotMatch(policy, /(?:^|\s)\*(?:\s|;|$)/);
});

test("Tauri grants only required permissions to the main window", () => {
  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(
    [...capability.permissions].sort(),
    ["core:event:allow-listen", "core:event:allow-unlisten", "process:allow-restart", "updater:default"],
  );
  assert.ok(capability.permissions.every((permission) => !permission.includes("*")));
});
