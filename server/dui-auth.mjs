import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function buildActivationRequest({ productId, productKey, productSecret, deviceId, nonce = randomUUID().replaceAll("-", ""), timestamp = String(Date.now()) }) {
  if (!productId || !productKey || !productSecret || !deviceId) throw new Error("请配置 DUI_PRODUCT_ID、DUI_PRODUCT_KEY 和 DUI_PRODUCT_SECRET。");
  const format = "plain";
  const sig = createHmac("sha1", productSecret).update(productKey + format + nonce + productId + timestamp).digest("hex");
  const url = new URL("https://auth.dui.ai/auth/device/register");
  for (const [key, value] of Object.entries({ productKey, format, productId, timestamp, nonce, sig })) url.searchParams.set(key, value);
  return { url, body: { platform: "windows", deviceName: deviceId } };
}

export function buildDuiSocketUrl({ productId, apiKey, branch = "prod", deviceName, deviceSecret, nonce = randomUUID().replaceAll("-", ""), timestamp = String(Date.now()) }) {
  const url = new URL("wss://dds.dui.ai/dds/v3/" + encodeURIComponent(branch));
  url.searchParams.set("serviceType", "websocket"); url.searchParams.set("productId", productId);
  if (deviceName && deviceSecret) {
    const sig = createHmac("sha1", deviceSecret).update(deviceName + nonce + productId + timestamp).digest("hex");
    for (const [key, value] of Object.entries({ deviceName, nonce, timestamp, sig })) url.searchParams.set(key, value);
  } else if (apiKey) url.searchParams.set("apikey", apiKey);
  else throw new Error("未配置 DUI API Key，也没有已激活设备凭证。请先执行 npm run dui:activate。");
  return url;
}

export function loadDeviceProfile(root, productId) {
  const path = join(root, "data", "dui-device.json");
  if (!existsSync(path)) return null;
  const profile = JSON.parse(readFileSync(path, "utf8"));
  if (String(profile.productId) !== String(productId)) throw new Error("已激活设备的产品 ID 与当前配置不一致，请核对配置，不要反复激活。");
  if (!profile.deviceName || !profile.deviceSecret) throw new Error("本地设备凭证不完整。");
  return profile;
}
