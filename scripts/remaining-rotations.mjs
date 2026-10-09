#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJson, writeJson, writeText } from "./lib.mjs";

const SENDER = "0x9C20993E98aa5A6BAD8AD0FC42C2f4cc3008096f";
const OPERATION_ROOT = path.join(ROOT, "operations", "2026-09-15-remaining-safes-align-to-council-tip110");
const GENERATED_INDEX = path.join(OPERATION_ROOT, "generated-rotation", "generated-files.json");

function usage() {
  console.log(`Usage:
  npm run remaining -- list
  npm run remaining -- prepare-all
  npm run remaining -- submit <target-key>
  npm run remaining -- submit-all
  npm run remaining -- notion-index

Examples:
  npm run remaining -- list
  npm run remaining -- prepare-all
  npm run remaining -- submit eth-d55c4261
  npm run remaining -- submit-all

For submit commands, omit the signature from the CLI. The script will prompt for it so it does not land in shell history.
`);
}

function safeKey(item) {
  const prefixByChainId = {
    1: "eth",
    10: "oeth",
    137: "matic",
    8453: "base",
    42161: "arb1"
  };
  const prefix = prefixByChainId[Number(item.chainId)] || String(item.chainId);
  return `${prefix}-${item.safeAddress.slice(2, 10).toLowerCase()}`;
}

function titleFor(item) {
  const safe = item.safeAddress.toLowerCase();
  if (safe === "0xf642bd6a9f76294d86e99c2071cfe2aa3b61fbda") {
    return "Foundation Safe signer alignment to current 9-member set";
  }
  return `Remaining Threshold Safe signer alignment - ${item.chainName} ${item.safeAddress.slice(0, 8)}`;
}

function proposalDir(item) {
  return path.join(OPERATION_ROOT, "proposal-prep", safeKey(item));
}

function loadTargets() {
  const generated = readJson(GENERATED_INDEX).generated || [];
  return generated.map((item) => ({
    ...item,
    key: safeKey(item),
    title: titleFor(item),
    proposalDir: proposalDir(item)
  }));
}

function runPrepare(item, action, signatureArg) {
  const args = [
    "scripts/prepare-safe-service-proposal.mjs",
    "--tx-builder",
    item.file,
    "--operation-dir",
    item.proposalDir,
    "--title",
    item.title,
    "--sender",
    SENDER,
    action === "submit" ? "--submit" : "--dry-run"
  ];

  if (signatureArg) {
    args.splice(args.length - 1, 0, "--signature", signatureArg);
  }

  const result = spawnSync("node", args, {
    cwd: ROOT,
    stdio: "inherit"
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function listTargets(targets) {
  for (const item of targets) {
    console.log(`${item.key}`);
    console.log(`  chain: ${item.chainName} (${item.chainId})`);
    console.log(`  safe:  ${item.safeAddress}`);
    console.log(`  json:  ${item.file}`);
    console.log(`  prep:  ${item.proposalDir}`);
  }
}

function newestSimulationFor(item) {
  const safeFolder = path.resolve(item.folder);
  const simulationRoot = path.join(safeFolder, "simulations");
  if (!fs.existsSync(simulationRoot)) return null;
  const results = fs.readdirSync(simulationRoot)
    .map((runId) => path.join(simulationRoot, runId, "result.json"))
    .filter((file) => fs.existsSync(file))
    .sort();
  return results.length ? readJson(results[results.length - 1]) : null;
}

function resultFor(item) {
  const resultPath = path.join(item.proposalDir, "dry-run-result.json");
  return fs.existsSync(resultPath) ? readJson(resultPath) : null;
}

function notionPathFor(item) {
  return path.join(item.proposalDir, "notion-submit-form.md");
}

function writeNotionIndex(targets) {
  const rows = [];
  const jsonRows = [];
  for (const item of targets) {
    const prepared = resultFor(item);
    const sim = newestSimulationFor(item);
    const notion = notionPathFor(item);
    const row = {
      key: item.key,
      chainName: item.chainName,
      chainId: item.chainId,
      safeAddress: item.safeAddress,
      nonce: prepared?.nonce ?? null,
      safeTxHash: prepared?.safeTxHash ?? null,
      submitted: Boolean(prepared?.submitted),
      signingPage: prepared?.signingPage ?? path.join(item.proposalDir, "ledger-sign-safe-tx.html"),
      notionForm: fs.existsSync(notion) ? notion : null,
      simulation: sim?.vnet_explorer_url || null,
      resultFile: prepared ? path.join(item.proposalDir, "dry-run-result.json") : null
    };
    jsonRows.push(row);
    rows.push(`| ${row.key} | ${row.chainName} | \`${row.safeAddress}\` | ${row.nonce ?? "not prepared"} | ${row.submitted ? "Submitted" : "Not submitted"} | ${row.notionForm ? `\`${row.notionForm}\`` : "Missing"} |`);
  }

  const md = [
    "# Remaining rotation Notion index",
    "",
    "Use this as the per-Safe copy source for Notion records.",
    "",
    "| Key | Chain | Safe | Nonce | Status | Notion form |",
    "| --- | --- | --- | ---: | --- | --- |",
    ...rows,
    "",
    "## Signing pages",
    "",
    ...jsonRows.map((row) => `- ${row.key}: \`${row.signingPage}\``),
    "",
    "## Submit commands",
    "",
    "Run from the project root:",
    "",
    "```bash",
    "cd /Users/Citizen42/Desktop/TdaoUtils/AI-ops/tDAO-signerrotation",
    ...targets.map((item) => `npm run remaining -- submit ${item.key}`),
    "```",
    ""
  ].join("\n");

  const outMd = path.join(OPERATION_ROOT, "NOTION_INDEX.md");
  const outJson = path.join(OPERATION_ROOT, "notion-index.json");
  writeText(outMd, md);
  writeJson(outJson, {
    createdAt: new Date().toISOString(),
    operationRoot: OPERATION_ROOT,
    rows: jsonRows
  });
  console.log(JSON.stringify({ notionIndex: outMd, notionIndexJson: outJson }, null, 2));
}

function main() {
  const [, , actionRaw, keyRaw, signatureArg] = process.argv;
  const action = (actionRaw || "").toLowerCase();
  if (!action || action === "help" || action === "--help") {
    usage();
    process.exit(action ? 0 : 1);
  }

  const targets = loadTargets();
  if (action === "list") {
    listTargets(targets);
    return;
  }

  if (action === "prepare-all") {
    for (const item of targets) {
      console.log(`\n== Preparing ${item.key} ==`);
      runPrepare(item, "dry-run");
    }
    writeNotionIndex(targets);
    return;
  }

  if (action === "notion-index") {
    writeNotionIndex(targets);
    return;
  }

  if (action === "submit") {
    const item = targets.find((target) => target.key === keyRaw);
    if (!item) {
      console.error(`Unknown target key: ${keyRaw || "(missing)"}`);
      console.error("Run `npm run remaining -- list` to see valid keys.");
      process.exit(1);
    }
    runPrepare(item, "submit", signatureArg);
    writeNotionIndex(targets);
    return;
  }

  if (action === "submit-all") {
    for (const item of targets) {
      console.log(`\n== Submitting ${item.key} ==`);
      console.log("Paste the Safe-compatible 65-byte signature for this target when prompted.");
      runPrepare(item, "submit");
    }
    writeNotionIndex(targets);
    return;
  }

  console.error(`Unknown action: ${action}`);
  usage();
  process.exit(1);
}

main();
