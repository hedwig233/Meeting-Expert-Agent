import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buildActivationRequest, buildDuiSocketUrl } from "../server/dui-auth.mjs";

test("SDK product credentials sign device registration rather than masquerading as a cloud API key", () => {
  const request = buildActivationRequest({ productId: "123", productKey: "test-key", productSecret: "test-secret", deviceId: "unique-local-device", nonce: "n1", timestamp: "1000" });
  assert.equal(request.url.hostname, "auth.dui.ai");
  assert.equal(request.url.searchParams.get("sig"), createHmac("sha1", "test-secret").update("test-keyplainn11231000").digest("hex"));
  assert.equal(request.url.searchParams.get("apikey"), null);
  assert.deepEqual(request.body, { platform: "windows", deviceName: "unique-local-device" });
  assert.throws(() => buildActivationRequest({ productId: "123" }), /请配置/);
});
test("device profile authentication uses a per-request HMAC and never transmits the device secret", () => {
  const url = buildDuiSocketUrl({ productId: "123", branch: "test", deviceName: "d1", deviceSecret: "secret", nonce: "n1", timestamp: "1000" });
  assert.equal(url.searchParams.get("deviceName"), "d1");
  assert.equal(url.searchParams.get("sig"), createHmac("sha1", "secret").update("d1n11231000").digest("hex"));
  assert.equal(url.searchParams.get("deviceSecret"), null);
  assert.equal(url.searchParams.get("apikey"), null);
});
test("cloud API key authorization remains supported and missing credentials fail clearly", () => {
  const url = buildDuiSocketUrl({ productId: "123", apiKey: "test-key", branch: "test" });
  assert.equal(url.searchParams.get("apikey"), "test-key");
  assert.throws(() => buildDuiSocketUrl({ productId: "123" }), /未配置/);
});
