#!/usr/bin/env node
import path from "node:path";
import {
  ROOT,
  assertAddress,
  fetchJson,
  loadChains,
  normalizeAddress,
  shortAddress,
  timestampId,
  writeJson,
  writeText
} from "./lib.mjs";

const DEFAULT_OWNER = "0x9C20993E98aa5A6BAD8AD0FC42C2f4cc3008096f";

function argValue(name, fallback = undefined) {
  const item = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (item) return item.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const owner = argValue("--owner", DEFAULT_OWNER);
assertAddress(owner, "owner");

const runId = argValue("--run-id", `${timestampId()}-owner-${shortAddress(owner)}`);
const operationDir = path.join(ROOT, "operations", runId);
const chains = loadChains();
const discovered = [];
const errors = [];

for (const chain of chains) {
  const base = chain.transactionServiceUrl.replace(/\/$/, "");
  const ownerSafesUrl = `${base}/api/v1/owners/${owner}/safes/`;

  try {
    const ownerSafes = await fetchJson(ownerSafesUrl);
    const safes = ownerSafes.safes || [];

    for (const safeAddress of safes) {
      const safeUrl = `${base}/api/v1/safes/${safeAddress}/`;
      const safe = await fetchJson(safeUrl);
      const ownerStillPresent = (safe.owners || []).some(
        (currentOwner) => normalizeAddress(currentOwner) === normalizeAddress(owner)
      );

      const item = {
        chainId: chain.chainId,
        chainName: chain.name,
        shortName: chain.shortName,
        transactionServiceUrl: base,
        safeAddress,
        threshold: safe.threshold,
        nonce: safe.nonce,
        version: safe.version,
        owners: safe.owners || [],
        ownerStillPresent,
        modules: safe.modules || [],
        fallbackHandler: safe.fallbackHandler || null,
        guard: safe.guard || null
      };
      discovered.push(item);

      const safeDir = path.join(
        operationDir,
        "inventory",
        `chain-${chain.chainId}-${chain.shortName}`,
        safeAddress
      );
      writeJson(path.join(safeDir, "safe-info.json"), item);
      writeText(
        path.join(safeDir, "README.md"),
        [
          `# ${chain.name} Safe ${safeAddress}`,
          "",
          `- Chain ID: \`${chain.chainId}\``,
          `- Threshold: \`${safe.threshold}\``,
          `- Nonce: \`${safe.nonce}\``,
          `- Owner under review present: \`${ownerStillPresent}\``,
          "",
          "## Owners",
          "",
          ...(safe.owners || []).map((currentOwner) => `- \`${currentOwner}\``),
          ""
        ].join("\n")
      );
    }
  } catch (error) {
    errors.push({
      chainId: chain.chainId,
      chainName: chain.name,
      transactionServiceUrl: base,
      message: error.message
    });
  }
}

const summary = {
  createdAt: new Date().toISOString(),
  owner,
  source: "Safe Transaction Service /api/v1/owners/{owner}/safes/",
  operationDir,
  totalSafes: discovered.length,
  chainsChecked: chains.map(({ chainId, name, transactionServiceUrl }) => ({
    chainId,
    name,
    transactionServiceUrl
  })),
  safes: discovered,
  errors
};

writeJson(path.join(operationDir, "all-safes.json"), summary);
writeJson(path.join(operationDir, "rotation.template.json"), {
  ownerToReplace: owner,
  newOwners: [],
  newThresholdByDefault: null,
  newThresholdBySafe: {},
  notes:
    "Fill newOwners with the complete final signer set. Leave newThresholdByDefault null to keep each Safe's current threshold, or set per-safe thresholds by safe address."
});
writeText(
  path.join(operationDir, "NEXT_STEPS.md"),
  [
    "# Next Steps",
    "",
    "1. Review `all-safes.json` and each `inventory/.../safe-info.json` by hand.",
    "2. Copy `rotation.template.json` to `rotation.json`.",
    "3. Fill `newOwners` with the complete final owner set.",
    "4. Optionally set `newThresholdByDefault` or per-safe entries in `newThresholdBySafe`.",
    "5. Run:",
    "",
    "```bash",
    `npm run generate -- --operation-dir ${operationDir} --rotation-file ${path.join(operationDir, "rotation.json")}`,
    "```",
    "",
    "Generated Safe Transaction Builder JSON files will land in one folder per Safe under `generated-rotation/`.",
    "Always inspect and Tenderly-simulate before proposing/executing.",
    ""
  ].join("\n")
);

console.log(JSON.stringify({
  operationDir,
  totalSafes: discovered.length,
  errors: errors.length,
  allSafes: path.join(operationDir, "all-safes.json")
}, null, 2));
