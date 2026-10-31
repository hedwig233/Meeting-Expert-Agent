import "dotenv/config";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildActivationRequest, loadDeviceProfile } from "../server/dui-auth.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const productId = process.env.DUI_PRODUCT_ID;
try {
  const existing = loadDeviceProfile(root, productId);
  if (existing) { console.log("设备已激活，已保留现有凭证，不会重复申请或轮换设备密钥。"); process.exit(0); }
  mkdirSync(join(root, "data"), { recursive: true });
  const idPath = join(root, "data", "dui-device-id.txt");
  const deviceId = existsSync(idPath) ? readFileSync(idPath, "utf8").trim() : randomUUID();
  const request = buildActivationRequest({ productId, productKey: process.env.DUI_PRODUCT_KEY, productSecret: process.env.DUI_PRODUCT_SECRET, deviceId });
  if (!existsSync(idPath)) writeFileSync(idPath, deviceId, { mode: 0o600 });
  console.log("正在将本机演示设备绑定到 DUI 产品；成功后将占用一个设备激活名额。");
  let response;
  try { response = await fetch(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error("无法连接设备激活服务，请检查网络后重试。为保护凭证，未打印请求 URL。"); }
  let profile; try { profile = await response.json(); } catch { throw new Error("激活服务返回了非 JSON 响应。"); }
  if (!response.ok || !profile.deviceName || !profile.deviceSecret) throw new Error("激活失败（HTTP " + response.status + "）。请核对 Windows 授权参数、产品权限和设备名额。");
  writeFileSync(join(root, "data", "dui-device.json"), JSON.stringify({ deviceName: profile.deviceName, deviceSecret: profile.deviceSecret, productId: profile.productId || productId, activatedAt: new Date().toISOString() }, null, 2), { mode: 0o600, flag: "wx" });
  console.log("设备激活成功。凭证保存在本地 data/dui-device.json；未打印密钥。请发布产品版本并重启应用。");
} catch (error) { console.error(error.message); process.exitCode = 1; }
