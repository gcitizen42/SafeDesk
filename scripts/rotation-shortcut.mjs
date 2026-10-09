#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "./lib.mjs";

const SENDER = "0x9C20993E98aa5A6BAD8AD0FC42C2f4cc3008096f";

const OPERATIONS = {
  arbitrum: {
    title: "Council Safe signer alignment to current ETH Council set - Arbitrum",
    txBuilder:
      "operations/2026-09-02-council-arbitrum-9F6e-align-to-eth-council/generated-rotation/chain-42161-arb1/0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f/rotation_chain-42161_0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f.json",
    operationDir: "operations/2026-09-02-council-arbitrum-9F6e-proposal-prep"
  },
  polygon: {
    title: "Council Safe signer alignment to current ETH Council set - Polygon",
    txBuilder:
      "operations/2026-09-02-council-polygon-9F6e-align-to-eth-council/generated-rotation/chain-137-matic/0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f/rotation_chain-137_0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f.json",
    operationDir: "operations/2026-09-02-council-polygon-9F6e-proposal-prep"
  },
  base: {
    title: "Council Safe signer alignment to current ETH Council set - Base",
    txBuilder:
      "operations/2026-09-03-council-base-518385-align-to-eth-council/generated-rotation/chain-8453-base/0x518385dd31289F1000fE6382b0C65df4d1Cd3bfC/rotation_chain-8453_0x518385dd31289F1000fE6382b0C65df4d1Cd3bfC.json",
    operationDir: "operations/2026-09-03-council-base-518385-proposal-prep"
  },
  optimism: {
    title: "Council Safe signer alignment to current ETH Council set - Optimism",
    txBuilder:
      "operations/2026-09-03-council-optimism-7fB50-align-to-eth-council/generated-rotation/chain-10-oeth/0x7fB50BBabeDEE52b8760Ba15c0c199aF33Fc2EfA/rotation_chain-10_0x7fB50BBabeDEE52b8760Ba15c0c199aF33Fc2EfA.json",
    operationDir: "operations/2026-09-03-council-optimism-7fB50-proposal-prep"
  },
  treasury: {
    title: "Treasury Safe signer alignment to current Council set",
    txBuilder:
      "operations/2026-08-28T-treasury-71E47-align-to-council-tip110/generated-rotation/chain-1-eth/0x71E47a4429d35827e0312AA13162197C23287546/rotation_chain-1_0x71E47a4429d35827e0312AA13162197C23287546.json",
    operationDir: "operations/2026-09-02-treasury-71E47-script-proposal-prep"
  }
};

function usage() {
  console.log(`Usage:
  npm run rotation -- arbitrum dry-run
  npm run rotation -- arbitrum submit
  npm run rotation -- arbitrum submit 0xSIGNATURE

  npm run rotation -- polygon dry-run
  npm run rotation -- polygon submit
  npm run rotation -- polygon submit 0xSIGNATURE

  npm run rotation -- base dry-run
  npm run rotation -- base submit
  npm run rotation -- base submit 0xSIGNATURE

  npm run rotation -- optimism dry-run
  npm run rotation -- optimism submit
  npm run rotation -- optimism submit 0xSIGNATURE

  npm run rotation -- treasury dry-run
  npm run rotation -- treasury submit

Tip:
  For submit, omitting the signature is safer. The script will prompt you to paste it,
  so it does not land in your shell history.
`);
}

function main() {
  const [, , chain, action, signatureArg] = process.argv;
  if (!chain || !action || chain === "--help" || chain === "help") {
    usage();
    process.exit(chain ? 0 : 1);
  }

  const operation = OPERATIONS[chain.toLowerCase()];
  if (!operation) {
    console.error(`Unknown rotation target: ${chain}`);
    usage();
    process.exit(1);
  }

  const normalizedAction = action.toLowerCase();
  if (!["dry-run", "submit"].includes(normalizedAction)) {
    console.error(`Unknown action: ${action}`);
    usage();
    process.exit(1);
  }

  const args = [
    "scripts/prepare-safe-service-proposal.mjs",
    "--tx-builder",
    path.join(ROOT, operation.txBuilder),
    "--operation-dir",
    path.join(ROOT, operation.operationDir),
    "--title",
    operation.title,
    "--sender",
    SENDER,
    normalizedAction === "submit" ? "--submit" : "--dry-run"
  ];

  if (signatureArg) {
    args.splice(args.length - 1, 0, "--signature", signatureArg);
  }

  const result = spawnSync("node", args, {
    cwd: ROOT,
    stdio: "inherit"
  });
  process.exit(result.status ?? 1);
}

main();
