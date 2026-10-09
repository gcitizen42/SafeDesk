#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  assertAddress,
  loadRpcConfig,
  normalizeAddress,
  readJson,
  shortAddress,
  writeJson,
  writeText
} from "./lib.mjs";

function argValue(name, fallback = undefined) {
  const item = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (item) return item.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const operationDir = argValue("--operation-dir");
if (!operationDir) throw new Error("Missing --operation-dir");

const rotationFile = argValue("--rotation-file", path.join(operationDir, "rotation.json"));
if (!fs.existsSync(rotationFile)) {
  throw new Error(`Rotation file not found: ${rotationFile}`);
}

const inventory = readJson(path.join(operationDir, "all-safes.json"));
const rotation = readJson(rotationFile);
const rpcByChainId = loadRpcConfig();

const ownerToReplace = rotation.ownerToReplace || inventory.owner;
assertAddress(ownerToReplace, "ownerToReplace");

const newOwners = rotation.newOwners || [];
if (!Array.isArray(newOwners) || newOwners.length === 0) {
  throw new Error("rotation.newOwners must be the complete final owner list and cannot be empty.");
}
for (const [index, owner] of newOwners.entries()) {
  assertAddress(owner, `newOwners[${index}]`);
}

const uniqueOwners = new Set(newOwners.map(normalizeAddress));
if (uniqueOwners.size !== newOwners.length) {
  throw new Error("rotation.newOwners contains duplicate addresses.");
}
if (uniqueOwners.has(normalizeAddress(ownerToReplace)) && !rotation.allowOwnerToRemain) {
  throw new Error("rotation.newOwners still contains ownerToReplace. Remove it if this is a signer rotation.");
}

const outputRoot = path.join(operationDir, "generated-rotation");
fs.mkdirSync(outputRoot, { recursive: true });

const generated = [];
for (const safe of inventory.safes || []) {
  const threshold =
    rotation.newThresholdBySafe?.[safe.safeAddress] ??
    rotation.newThresholdBySafe?.[safe.safeAddress.toLowerCase()] ??
    rotation.newThresholdByDefault ??
    safe.threshold;

  if (!Number.isInteger(Number(threshold)) || Number(threshold) < 1 || Number(threshold) > newOwners.length) {
    throw new Error(
      `Invalid threshold ${threshold} for ${safe.chainId}:${safe.safeAddress}; owner count is ${newOwners.length}.`
    );
  }

  const safeDir = path.join(
    outputRoot,
    `chain-${safe.chainId}-${safe.shortName}`,
    `${safe.safeAddress}`
  );
  fs.mkdirSync(safeDir, { recursive: true });

  const outFile = path.join(safeDir, `rotation_chain-${safe.chainId}_${safe.safeAddress}.json`);
  const command = [
    "safe-owner-manager",
    `--safe-address=${safe.safeAddress}`,
    `--new-owners=${newOwners.join(",")}`,
    `--chain-id=${safe.chainId}`,
    `--new-threshold=${threshold}`,
    `--out-filename=${outFile}`
  ];

  const rpcUrl = rpcByChainId[String(safe.chainId)];
  if (rpcUrl) command.push(`--rpc-url=${rpcUrl}`);

  const result = spawnSync("npx", ["--yes", ...command], {
    cwd: ROOT,
    encoding: "utf8"
  });

  writeText(path.join(safeDir, "command.txt"), `npx --yes ${command.join(" ")}\n`);
  writeJson(path.join(safeDir, "owners-before.json"), {
    chainId: safe.chainId,
    safeAddress: safe.safeAddress,
    thresholdBefore: safe.threshold,
    ownersBefore: safe.owners
  });
  writeJson(path.join(safeDir, "owners-after.json"), {
    chainId: safe.chainId,
    safeAddress: safe.safeAddress,
    thresholdAfter: Number(threshold),
    ownersAfter: newOwners
  });

  if (result.status !== 0) {
    writeText(path.join(safeDir, "error.log"), `${result.stdout || ""}\n${result.stderr || ""}`);
    throw new Error(`safe-owner-manager failed for ${safe.chainId}:${safe.safeAddress}. See ${path.join(safeDir, "error.log")}`);
  }

  writeText(path.join(safeDir, "stdout.log"), result.stdout || "");
  writeText(path.join(safeDir, "stderr.log"), result.stderr || "");

  generated.push({
    chainId: safe.chainId,
    chainName: safe.chainName,
    safeAddress: safe.safeAddress,
    threshold,
    file: outFile,
    folder: safeDir
  });
}

writeJson(path.join(outputRoot, "generated-files.json"), {
  createdAt: new Date().toISOString(),
  operationDir,
  rotationFile,
  ownerToReplace,
  generated
});

console.log(JSON.stringify({
  outputRoot,
  generated: generated.length,
  generatedFiles: path.join(outputRoot, "generated-files.json")
}, null, 2));
