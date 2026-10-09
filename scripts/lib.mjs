import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

export function normalizeAddress(address) {
  return String(address || "").trim().toLowerCase();
}

export function assertAddress(address, label = "address") {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(address || ""))) {
    throw new Error(`Invalid ${label}: ${address}`);
  }
}

export function shortAddress(address) {
  const value = String(address);
  return `${value.slice(0, 6)}-${value.slice(-4)}`;
}

export function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "TdaoUtils tDAO-signerrotation/0.1"
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export function loadChains() {
  return readJson(path.join(ROOT, "config", "chains.json"));
}

export function loadRpcConfig() {
  const local = path.join(ROOT, "config", "rpcs.local.json");
  if (fs.existsSync(local)) return readJson(local);
  const example = path.join(ROOT, "config", "rpcs.example.json");
  return fs.existsSync(example) ? readJson(example) : {};
}
