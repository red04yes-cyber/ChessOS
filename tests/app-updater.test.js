import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadPendingAppUpdate,
  installPendingAppUpdate,
} from "../src/app-updater.js";

function silentLogger() {
  return { warn() {} };
}

test("returns null when no update is available", async () => {
  let downloaded = false;
  const result = await downloadPendingAppUpdate(async (options) => {
    assert.equal(options.timeout, 15_000);
    return null;
  }, silentLogger());
  assert.equal(result, null);
  assert.equal(downloaded, false);
});

test("downloads an available update but does not install it", async () => {
  let downloadCount = 0;
  let installCount = 0;
  const update = {
    version: "0.2.0",
    async download() { downloadCount += 1; },
    async install() { installCount += 1; },
  };
  const result = await downloadPendingAppUpdate(async () => update, silentLogger());
  assert.equal(result, update);
  assert.equal(downloadCount, 1);
  assert.equal(installCount, 0);
});

test("closes the update resource after a download failure", async () => {
  let closeCount = 0;
  const result = await downloadPendingAppUpdate(async () => ({
    async download() { throw new Error("network unavailable"); },
    async close() { closeCount += 1; },
  }), silentLogger());
  assert.equal(result, null);
  assert.equal(closeCount, 1);
});

test("does not install until the app is safe to restart", async () => {
  let installOptions = null;
  const update = {
    async install(options) { installOptions = options; },
  };
  assert.equal(await installPendingAppUpdate(update, () => false, silentLogger()), false);
  assert.equal(installOptions, null);

  assert.equal(await installPendingAppUpdate(update, () => true, silentLogger()), true);
  assert.deepEqual(installOptions, { restartAfterInstall: true });
});

test("keeps installation errors non-fatal", async () => {
  const result = await installPendingAppUpdate({
    async install() { throw new Error("installer launch failed"); },
  }, () => true, silentLogger());
  assert.equal(result, false);
});
