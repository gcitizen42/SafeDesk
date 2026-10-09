#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { ethers } from "ethers";
import {
  assertAddress,
  loadChains,
  readJson,
  writeJson,
  writeText
} from "./lib.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MULTISEND_CALL_ONLY = "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D";

function argValue(name, fallback = undefined) {
  const item = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (item) return item.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Usage:
  npm run prepare-proposal -- --tx-builder path/to/rotation.json --operation-dir operations/name --dry-run
  npm run prepare-proposal -- --tx-builder path/to/rotation.json --operation-dir operations/name --sender 0xOwner --signature 0xSig --dry-run
  npm run prepare-proposal -- --tx-builder path/to/rotation.json --operation-dir operations/name --sender 0xOwner --signature 0xSig --submit

Notes:
  --dry-run writes proposal details locally only.
  --submit posts the prepared payload to Safe Transaction Service.
  If --signature is omitted with --sender, the script prompts for it.
`);
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: response.ok, status: response.status, body };
}

async function promptForSignature() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question("Paste Safe-compatible 65-byte signature: ")).trim();
  } finally {
    rl.close();
  }
}

function getV(signature) {
  return Number.parseInt(signature.slice(-2), 16);
}

function setV(signature, v) {
  return `${signature.slice(0, -2)}${v.toString(16).padStart(2, "0")}`;
}

function toRecoveryV(v) {
  if (v === 4 || v === 5) return v + 23;
  return v < 27 ? v + 27 : v;
}

function toSafeTypedDataSignature(signature) {
  const v = getV(signature);
  return v < 27 ? setV(signature, v + 27) : signature;
}

function toSafeEthSignSignature(signature) {
  const v = getV(signature);
  if (v >= 31) return signature;
  if (v === 4 || v === 5) return setV(signature, v + 27);
  if (v >= 27) return setV(signature, v + 4);
  return setV(signature, v + 31);
}

function assertSignatureShape(signature) {
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    throw new Error("Signature must be a 65-byte hex string: 0x + 130 hex characters.");
  }
}

function analyseSignature({ signature, sender, domain, types, message, safeTxHash }) {
  const expected = sender.toLowerCase();
  const v = getV(signature);

  try {
    const recovered = ethers.verifyTypedData(domain, types, message, signature);
    if (recovered.toLowerCase() === expected) {
      return {
        ok: true,
        recovered,
        mode: "EIP-712 typed data",
        submitSignature: toSafeTypedDataSignature(signature)
      };
    }
  } catch {}

  const normalizedSig = v >= 31 ? setV(signature, v - 4) : setV(signature, toRecoveryV(v));
  try {
    const recovered = ethers.recoverAddress(
      ethers.hashMessage(ethers.getBytes(safeTxHash)),
      normalizedSig
    );
    if (recovered.toLowerCase() === expected) {
      return {
        ok: true,
        recovered,
        mode: "Safe eth_sign / Ledger hardware-wallet style",
        submitSignature: toSafeEthSignSignature(signature)
      };
    }
  } catch {}

  try {
    const recovered = ethers.verifyTypedData(domain, types, message, normalizedSig);
    if (recovered.toLowerCase() === expected) {
      return {
        ok: true,
        recovered,
        mode: "EIP-712 typed data with normalized v",
        submitSignature: toSafeTypedDataSignature(normalizedSig)
      };
    }
  } catch {}

  return { ok: false, recovered: null, mode: "unknown", submitSignature: null };
}

function encodeContractCall(tx) {
  if (tx.data && tx.data !== "0x") return tx.data;
  if (!tx.contractMethod?.name || !Array.isArray(tx.contractMethod.inputs)) {
    if (tx.data === "0x") return tx.data;
    throw new Error(`Transaction to ${tx.to} has no data and no contractMethod to encode.`);
  }

  const inputs = tx.contractMethod.inputs;
  const signature = `${tx.contractMethod.name}(${inputs.map((input) => input.type).join(",")})`;
  const values = inputs.map((input) => {
    const value = tx.contractInputsValues?.[input.name];
    if (value === undefined) {
      throw new Error(`Missing contractInputsValues.${input.name} for ${signature}.`);
    }
    return value;
  });
  return new ethers.Interface([`function ${signature}`]).encodeFunctionData(tx.contractMethod.name, values);
}

function encodeMultiSend(transactions) {
  const chunks = transactions.map((tx, index) => {
    assertAddress(tx.to, `transactions[${index}].to`);
    const operation = Number(tx.operation ?? 0);
    if (![0, 1].includes(operation)) {
      throw new Error(`Unsupported operation ${operation} at transaction ${index}.`);
    }
    const data = encodeContractCall(tx);
    const dataBytes = ethers.getBytes(data || "0x");
    return ethers.concat([
      ethers.toBeHex(operation, 1),
      ethers.getBytes(ethers.getAddress(tx.to)),
      ethers.toBeHex(BigInt(tx.value ?? "0"), 32),
      ethers.toBeHex(dataBytes.length, 32),
      dataBytes
    ]);
  });
  const packed = ethers.concat(chunks);
  const data = new ethers.Interface(["function multiSend(bytes transactions)"]).encodeFunctionData("multiSend", [packed]);
  return { packed, data };
}

function buildSafeTx(builder, nonce) {
  const transactions = builder.transactions || [];
  if (transactions.length === 0) throw new Error("Transaction Builder JSON has no transactions.");

  if (transactions.length === 1 && transactions[0].data && transactions[0].operation !== undefined) {
    return {
      to: ethers.getAddress(transactions[0].to),
      value: String(transactions[0].value ?? "0"),
      data: transactions[0].data,
      operation: Number(transactions[0].operation),
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
      nonce: String(nonce),
      innerTransactions: transactions.map((tx) => ({
        to: ethers.getAddress(tx.to),
        value: String(tx.value ?? "0"),
        data: tx.data,
        operation: Number(tx.operation ?? 0),
        method: tx.contractMethod?.name || null,
        inputs: tx.contractInputsValues || null
      }))
    };
  }

  const multi = encodeMultiSend(transactions);
  return {
    to: MULTISEND_CALL_ONLY,
    value: "0",
    data: multi.data,
    operation: 1,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce: String(nonce),
    innerTransactions: transactions.map((tx, index) => ({
      index,
      to: ethers.getAddress(tx.to),
      value: String(tx.value ?? "0"),
      data: encodeContractCall(tx),
      operation: Number(tx.operation ?? 0),
      method: tx.contractMethod?.name || null,
      inputs: tx.contractInputsValues || null
    }))
  };
}

function safeTxTypes() {
  return {
    SafeTx: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "nonce", type: "uint256" }
    ]
  };
}

function writeSigningPage(operationDir) {
  writeText(path.join(operationDir, "ledger-sign-safe-tx.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign Safe Transaction</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.45; margin: 32px; max-width: 980px; }
      button, input { font: inherit; padding: 10px 14px; margin-right: 8px; }
      button { cursor: pointer; }
      input { box-sizing: border-box; width: 100%; margin: 6px 0 10px; }
      pre, textarea { box-sizing: border-box; width: 100%; white-space: pre-wrap; word-break: break-word; }
      pre { background: #f5f5f5; padding: 12px; border: 1px solid #ddd; }
      textarea { min-height: 130px; }
      .danger { color: #9b1c1c; font-weight: 700; }
      .ok { color: #126b2f; font-weight: 700; }
    </style>
  </head>
  <body>
    <h1>Sign Safe Transaction</h1>
    <p>This page signs the exact Safe transaction described by <code>safe-custom-data-params.json</code>. It does not ask for, read, or export a private key.</p>
    <p class="danger">Only sign if the connected address is a current owner and the Safe tx hash matches the operation you intend to propose.</p>
    <h2>Expected Safe Tx Hash</h2>
    <pre id="expectedHash"></pre>
    <h2>Optional Hash To Sign</h2>
    <p>
      Leave this empty to sign the prepared transaction above. Paste a 32-byte Safe tx hash only if ops already gave you an exact hash.
      Hash-only signing uses the Ledger fallback route; typed-data signing needs the full Safe transaction fields.
    </p>
    <input id="manualSafeTxHash" placeholder="0x..." spellcheck="false" />
    <button id="usePreparedHash">Use Prepared Hash</button>
    <pre id="hashSource"></pre>
    <h2>Connected Wallet</h2>
    <p id="wallet">Not connected</p>
    <button id="connect">Connect Wallet</button>
    <button id="sign">Sign Typed Data</button>
    <button id="signHash">Ledger Fallback: Sign Safe Hash</button>
    <h2>Signature To Submit</h2>
    <textarea id="signature" readonly></textarea>
    <h2>Raw Signature</h2>
    <textarea id="rawSignature" readonly></textarea>
    <h2>Recovery Diagnostics</h2>
    <pre id="diagnostics"></pre>
    <h2>Status</h2>
    <pre id="status"></pre>

    <script type="module">
      import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.14.4/+esm";

      const params = await fetch("./safe-custom-data-params.json").then((r) => r.json());
      const owners = await fetch("./current-owners.json").then((r) => r.json());
      const CURRENT_OWNERS = owners.owners.map((item) => item.toLowerCase());
      const SAFE = params.safe;
      const EXPECTED_SAFE_TX_HASH = params.expectedSafeTxHash;
      const tx = {
        to: params.to,
        value: params.value,
        data: params.data,
        operation: params.operation,
        safeTxGas: params.safeTxGas,
        baseGas: params.baseGas,
        gasPrice: params.gasPrice,
        gasToken: params.gasToken,
        refundReceiver: params.refundReceiver,
        nonce: String(params.nonce)
      };
      const domain = { chainId: Number(params.chainId), verifyingContract: SAFE };
      const types = {
        SafeTx: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
          { name: "operation", type: "uint8" },
          { name: "safeTxGas", type: "uint256" },
          { name: "baseGas", type: "uint256" },
          { name: "gasPrice", type: "uint256" },
          { name: "gasToken", type: "address" },
          { name: "refundReceiver", type: "address" },
          { name: "nonce", type: "uint256" }
        ]
      };

      const expectedHash = document.querySelector("#expectedHash");
      const wallet = document.querySelector("#wallet");
      const status = document.querySelector("#status");
      const signature = document.querySelector("#signature");
      const rawSignature = document.querySelector("#rawSignature");
      const diagnostics = document.querySelector("#diagnostics");
      const manualSafeTxHash = document.querySelector("#manualSafeTxHash");
      const hashSource = document.querySelector("#hashSource");
      let account = null;
      expectedHash.textContent = EXPECTED_SAFE_TX_HASH;
      hashSource.textContent = JSON.stringify({
        preparedHashSource: "safe-custom-data-params.json -> expectedSafeTxHash",
        preparedHash: EXPECTED_SAFE_TX_HASH,
        note: "The prepared hash is computed from Safe, chainId, nonce, target, value, data, operation, and gas fields. If any field changes, the hash and signature must change."
      }, null, 2);

      function setStatus(value) { status.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2); }
      function assertHash() {
        const hash = ethers.TypedDataEncoder.hash(domain, types, tx);
        if (hash.toLowerCase() !== EXPECTED_SAFE_TX_HASH.toLowerCase()) throw new Error("Hash mismatch. Computed " + hash);
        return hash;
      }
      function getHashToSign() {
        const manual = manualSafeTxHash.value.trim();
        const prepared = assertHash();
        if (!manual) return { hash: prepared, source: "prepared SafeTx fields" };
        if (!/^0x[a-fA-F0-9]{64}$/.test(manual)) throw new Error("Manual hash must be 0x plus 64 hex characters.");
        return {
          hash: manual,
          source: manual.toLowerCase() === prepared.toLowerCase() ? "manual input matching prepared hash" : "manual input, does not match prepared operation hash"
        };
      }
      function getV(sig) { return parseInt(sig.slice(-2), 16); }
      function setV(sig, v) { return sig.slice(0, -2) + v.toString(16).padStart(2, "0"); }
      function toRecoveryV(v) { return v < 27 ? v + 27 : v; }
      function toSafeTypedDataSignature(sig) {
        const v = getV(sig);
        return v < 27 ? setV(sig, v + 27) : sig;
      }
      function toSafeEthSignSignature(sig) {
        const v = getV(sig);
        if (v >= 31) return sig;
        if (v >= 27) return setV(sig, v + 4);
        return setV(sig, v + 31);
      }
      function analyseSignature(sig, expectedSigner, safeTxHash) {
        const signer = expectedSigner.toLowerCase();
        const v = getV(sig);
        const checks = [];
        try {
          const recovered = ethers.verifyTypedData(domain, types, tx, sig);
          checks.push({ mode: "EIP-712 typed data", recovered });
          if (recovered.toLowerCase() === signer) return { ok: true, mode: "EIP-712 typed data", recovered, submitSignature: toSafeTypedDataSignature(sig), checks };
        } catch (error) { checks.push({ mode: "EIP-712 typed data", error: error.message }); }

        const normalizedSig = v >= 31 ? setV(sig, v - 4) : setV(sig, toRecoveryV(v));
        try {
          const recovered = ethers.recoverAddress(ethers.hashMessage(ethers.getBytes(safeTxHash)), normalizedSig);
          checks.push({ mode: "personal_sign over Safe tx hash bytes", recovered });
          if (recovered.toLowerCase() === signer) return { ok: true, mode: "Safe eth_sign / Ledger hardware-wallet style", recovered, submitSignature: toSafeEthSignSignature(sig), checks };
        } catch (error) { checks.push({ mode: "personal_sign over Safe tx hash bytes", error: error.message }); }

        try {
          const recovered = ethers.verifyTypedData(domain, types, tx, normalizedSig);
          checks.push({ mode: "EIP-712 typed data with normalized v", recovered });
          if (recovered.toLowerCase() === signer) return { ok: true, mode: "EIP-712 typed data with normalized v", recovered, submitSignature: toSafeTypedDataSignature(normalizedSig), checks };
        } catch (error) { checks.push({ mode: "EIP-712 typed data with normalized v", error: error.message }); }
        return { ok: false, mode: "unknown", recovered: null, submitSignature: null, checks };
      }
      function showAnalysis(sig, analysis, safeTxHash, hashSourceLabel) {
        rawSignature.value = sig;
        diagnostics.textContent = JSON.stringify({
          connected: account,
          preparedSafeTxHash: EXPECTED_SAFE_TX_HASH,
          signedSafeTxHash: safeTxHash,
          hashSource: hashSourceLabel,
          rawV: getV(sig),
          accepted: analysis.ok,
          mode: analysis.mode,
          recovered: analysis.recovered,
          checks: analysis.checks
        }, null, 2);
      }

      document.querySelector("#usePreparedHash").addEventListener("click", () => {
        manualSafeTxHash.value = assertHash();
        setStatus({
          ok: true,
          message: "Prepared hash inserted. This is the hash from the exact Safe transaction fields in this folder.",
          safeTxHash: manualSafeTxHash.value
        });
      });

      document.querySelector("#connect").addEventListener("click", async () => {
        if (!window.ethereum) return setStatus("No injected wallet found. Open this page in Chrome or Brave with MetaMask connected to your Ledger.");
        const wantedChain = "0x" + Number(params.chainId).toString(16);
        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        if (chainId !== wantedChain) await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: wantedChain }] });
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        account = ethers.getAddress(accounts[0]);
        wallet.innerHTML = CURRENT_OWNERS.includes(account.toLowerCase()) ? '<span class="ok">' + account + '</span>' : '<span class="danger">' + account + " is not in the current owner list</span>";
        setStatus({ connected: account, safe: SAFE, expectedSafeTxHash: assertHash(), operation: tx.operation });
      });

      async function signWith(method) {
        if (!account) return setStatus("Connect wallet first.");
        if (!CURRENT_OWNERS.includes(account.toLowerCase())) return setStatus("Connected wallet is not a current Safe owner. Stop.");
        const selected = method === "typed" ? { hash: assertHash(), source: "prepared SafeTx fields" } : getHashToSign();
        if (method === "typed" && manualSafeTxHash.value.trim() && manualSafeTxHash.value.trim().toLowerCase() !== EXPECTED_SAFE_TX_HASH.toLowerCase()) {
          return setStatus("Typed-data signing cannot use a hash-only override. Use Ledger Fallback: Sign Safe Hash for a pasted hash.");
        }
        const sig = method === "typed"
          ? await window.ethereum.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify({ domain, types, primaryType: "SafeTx", message: tx })] })
          : await window.ethereum.request({ method: "personal_sign", params: [selected.hash, account] });
        const analysis = analyseSignature(sig, account, selected.hash);
        showAnalysis(sig, analysis, selected.hash, selected.source);
        if (!analysis.ok) return setStatus({ error: "Signature did not recover connected wallet", connected: account, recovered: analysis.recovered, mode: analysis.mode });
        signature.value = analysis.submitSignature;
        setStatus({
          ok: true,
          signer: account,
          recovered: analysis.recovered,
          signatureMode: analysis.mode,
          safeTxHash: selected.hash,
          hashSource: selected.source,
          warning: selected.hash.toLowerCase() === EXPECTED_SAFE_TX_HASH.toLowerCase() ? undefined : "This signature is for a manually pasted hash, not the prepared operation hash shown above.",
          next: "Copy Signature To Submit into the CLI dry-run/submit command."
        });
      }
      document.querySelector("#sign").addEventListener("click", () => signWith("typed"));
      document.querySelector("#signHash").addEventListener("click", () => signWith("hash"));
    </script>
  </body>
</html>
`);
}

function latestSimulation(operationDir) {
  const simulationRoot = path.join(operationDir, "simulations");
  if (!fs.existsSync(simulationRoot)) return null;
  const runs = fs.readdirSync(simulationRoot)
    .map((name) => path.join(simulationRoot, name, "result.json"))
    .filter((file) => fs.existsSync(file))
    .sort();
  if (runs.length === 0) return null;
  return readJson(runs[runs.length - 1]);
}

function safeAppUrl(chain, safe) {
  const prefixByChainId = {
    1: "eth",
    10: "oeth",
    137: "matic",
    8453: "base",
    42161: "arb1"
  };
  const prefix = prefixByChainId[Number(chain.chainId)] || String(chain.shortName || chain.chainId);
  return `https://app.safe.global/transactions/queue?safe=${prefix}:${safe}`;
}

function writeNotionForm({
  operationDir,
  builderPath,
  title,
  chain,
  safe,
  safeInfo,
  safeTxHash,
  domainHash,
  messageHash,
  tx,
  serviceUrl,
  sender,
  signatureAnalysis,
  submitResult
}) {
  const txRows = tx.innerTransactions.map((inner) => {
    const method = inner.method || "raw call";
    const inputs = inner.inputs ? ` ${JSON.stringify(inner.inputs)}` : "";
    return `- ${method} -> ${inner.to}${inputs}`;
  }).join("\n");
  const methodCounts = tx.innerTransactions.reduce((counts, inner) => {
    const method = inner.method || "raw call";
    counts[method] = (counts[method] || 0) + 1;
    return counts;
  }, {});
  const methodSummary = Object.entries(methodCounts)
    .map(([method, count]) => `${count} ${method}`)
    .join(", ");

  const sim = latestSimulation(operationDir);
  const status = submitResult ? (submitResult.ok ? "Submitted" : "Submit failed") : "Not executed";
  const submitStatus = submitResult ? `${submitResult.status}` : "not submitted";
  const signerLine = sender ? `${sender}${signatureAnalysis?.mode ? ` (${signatureAnalysis.mode})` : ""}` : "Empty";
  const simulationUrl = sim?.vnet_explorer_url || sim?.dashboard_url || "Empty";
  const verificationFile = sim ? path.join(operationDir, "simulations", sim.run_id, "REPORT.md") : "Empty";
  const link = safeAppUrl(chain, safe);
  const lowerTitle = title.toLowerCase();
  const multisigPrefix = lowerTitle.includes("treasury")
    ? "Treasury"
    : lowerTitle.includes("foundation")
      ? "Foundation"
      : lowerTitle.includes("council")
        ? "Council"
        : "Threshold Safe";
  const multisigLabel = `${multisigPrefix} ${chain.name}`;
  const issueDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  writeText(path.join(operationDir, "notion-submit-form.md"), `# ${title}

## Notion property values

### Tx Status

${status}

### Issue Date

${issueDate}

### Multisig

${multisigLabel}  
\`${safe}\`  
${link}

### tx

${safeInfo.nonce}

### Details

CRITICAL: do not execute until the signer-rotation group has confirmed the SafeTx hash and approval coordination.

This operation aligns this Safe signer set to the current 9-member signer set using one atomic Safe MultiSend delegatecall. It keeps the Safe threshold at \`${safeInfo.threshold}\` and performs: ${methodSummary}.

${txRows}

Prepared SafeTx hash:

\`${safeTxHash}\`

### Simulation

${simulationUrl}

### Verification File

${verificationFile}

### Author

mcitizen42 / \`${sender || "0x9C20993E98aa5A6BAD8AD0FC42C2f4cc3008096f"}\`

### To (Contract Interaction)

\`${tx.to}\`

### Message Hash

\`${messageHash}\`

### Raw Data

\`\`\`text
${tx.data}
\`\`\`

### SafeTx Hash

\`${safeTxHash}\`

### Domain Hash

\`${domainHash}\`

### Assets

Empty

### Invoices

Empty

### Link

${link}

### Signed by

${signerLine}

### Transaction ID

Empty

## Submit/reference fields

| Field | Value |
| --- | --- |
| Safe threshold | ${safeInfo.threshold} |
| Safe service submit status | ${submitStatus} |
| Safe service URL | ${serviceUrl} |
| Transaction Builder JSON | \`${builderPath}\` |
| Custom data params | \`${path.join(operationDir, "safe-custom-data-params.json")}\` |
| Submit payload | \`${path.join(operationDir, "safe-service-proposal-payload.json")}\` |

## Transaction contents

${txRows}

## Checks performed

- Safe Transaction Service was queried live.
- Current Safe nonce was used from the service.
- Current Safe owner list was saved.
- Safe transaction hash was computed locally from the exact typed SafeTx data.
- No mainnet proposal is posted unless \`--submit\` is used.
- No private key, seed phrase, API key, or signature is copied into this markdown file.

`);
}

async function main() {
  if (hasArg("--help")) {
    usage();
    return;
  }

  const builderPath = argValue("--tx-builder");
  const operationDir = argValue("--operation-dir");
  const title = argValue("--title", "Safe signer rotation proposal");
  const submit = hasArg("--submit");
  const dryRun = hasArg("--dry-run") || !submit;
  const senderRaw = argValue("--sender") || process.env.SAFE_SENDER;
  let signature = argValue("--signature") || process.env.SAFE_SIGNATURE;

  if (!builderPath || !operationDir) {
    usage();
    process.exit(1);
  }

  const builder = readJson(builderPath);
  const chainId = Number(builder.chainId);
  const chain = loadChains().find((item) => Number(item.chainId) === chainId);
  if (!chain) throw new Error(`No chain config found for chainId ${chainId}.`);

  const safe = ethers.getAddress(builder.meta?.createdFromSafeAddress);
  assertAddress(safe, "createdFromSafeAddress");
  const serviceBase = `${chain.transactionServiceUrl}/api/v1`;
  const safeInfo = await getJson(`${serviceBase}/safes/${safe}/`);
  const nonce = Number(safeInfo.nonce);
  const tx = buildSafeTx(builder, nonce);
  const domain = { chainId, verifyingContract: safe };
  const types = safeTxTypes();
  const message = {
    to: tx.to,
    value: tx.value,
    data: tx.data,
    operation: tx.operation,
    safeTxGas: tx.safeTxGas,
    baseGas: tx.baseGas,
    gasPrice: tx.gasPrice,
    gasToken: tx.gasToken,
    refundReceiver: tx.refundReceiver,
    nonce: tx.nonce
  };
  const domainHash = ethers.TypedDataEncoder.hashDomain(domain);
  const messageHash = ethers.TypedDataEncoder.from(types).hash(message);
  const safeTxHash = ethers.TypedDataEncoder.hash(domain, types, message);

  fs.mkdirSync(operationDir, { recursive: true });
  fs.mkdirSync(path.join(operationDir, "secrets"), { recursive: true });
  writeText(path.join(operationDir, "secrets", "README.md"), `# Local secrets

Keep signatures, API keys, admin RPC URLs, and any private submit notes here only if needed.

This folder is intentionally ignored by git-style workflows and should not be shared.
`);
  writeJson(path.join(operationDir, "current-owners.json"), {
    chainId,
    chainName: chain.name,
    safe,
    threshold: safeInfo.threshold,
    nonce,
    owners: safeInfo.owners
  });
  writeJson(path.join(operationDir, "decoded-inner-transactions.json"), tx.innerTransactions);
  writeJson(path.join(operationDir, "safe-custom-data-params.json"), {
    title,
    chainId: String(chainId),
    chainName: chain.name,
    safe,
    nonce,
    domainHash,
    messageHash,
    expectedSafeTxHash: safeTxHash,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    operation: tx.operation,
    operationName: tx.operation === 1 ? "DELEGATECALL" : "CALL",
    safeTxGas: tx.safeTxGas,
    baseGas: tx.baseGas,
    gasPrice: tx.gasPrice,
    gasToken: tx.gasToken,
    refundReceiver: tx.refundReceiver,
    serviceUrl: `${serviceBase}/safes/${safe}/multisig-transactions/`,
    sourceBuilderJson: path.resolve(builderPath)
  });
  writeJson(path.join(operationDir, "signing-data.json"), {
    domain,
    types,
    primaryType: "SafeTx",
    message,
    domainHash,
    messageHash,
    safeTxHash
  });
  writeSigningPage(operationDir);

  let sender = null;
  let signatureAnalysis = null;
  let payload = null;
  if (senderRaw) {
    sender = ethers.getAddress(senderRaw);
    if (!safeInfo.owners.map((owner) => owner.toLowerCase()).includes(sender.toLowerCase())) {
      throw new Error(`${sender} is not a current owner of Safe ${safe}.`);
    }
    if (!signature && !dryRun) signature = await promptForSignature();
    if (signature) {
      assertSignatureShape(signature);
      signatureAnalysis = analyseSignature({ signature, sender, domain, types, message, safeTxHash });
      if (!signatureAnalysis.ok) {
        throw new Error(`Signature did not recover declared sender ${sender}.`);
      }
      payload = {
        to: tx.to,
        value: tx.value,
        data: tx.data,
        operation: tx.operation,
        gasToken: tx.gasToken,
        safeTxGas: Number(tx.safeTxGas),
        baseGas: Number(tx.baseGas),
        gasPrice: tx.gasPrice,
        refundReceiver: tx.refundReceiver,
        nonce,
        contractTransactionHash: safeTxHash,
        sender,
        signature: signatureAnalysis.submitSignature,
        origin: JSON.stringify({
          name: title,
          note: "Prepared outside Transaction Builder so operation and hash can be verified before proposal."
        })
      };
      writeJson(path.join(operationDir, "safe-service-proposal-payload.json"), payload);
    }
  }

  const serviceUrl = `${serviceBase}/safes/${safe}/multisig-transactions/`;
  let submitResult = null;
  if (submit) {
    if (!payload) throw new Error("--submit requires --sender and a valid --signature.");
    submitResult = await postJson(serviceUrl, payload);
    writeJson(path.join(operationDir, "safe-service-submit-result.json"), submitResult);
    if (!submitResult.ok) process.exitCode = 1;
  }

  writeNotionForm({
    operationDir,
    builderPath: path.resolve(builderPath),
    title,
    chain,
    safe,
    safeInfo,
    safeTxHash,
    domainHash,
    messageHash,
    tx,
    serviceUrl,
    sender,
    signatureAnalysis,
    submitResult
  });

  const result = {
    dryRun,
    submitted: Boolean(submitResult?.ok),
    operationDir: path.resolve(operationDir),
    chainId,
    chainName: chain.name,
    safe,
    nonce,
    domainHash,
    messageHash,
    safeTxHash,
    operation: tx.operation,
    target: tx.to,
    currentOwners: path.join(operationDir, "current-owners.json"),
    customDataParams: path.join(operationDir, "safe-custom-data-params.json"),
    signingPage: path.join(operationDir, "ledger-sign-safe-tx.html"),
    notionForm: path.join(operationDir, "notion-submit-form.md"),
    submitPayload: payload ? path.join(operationDir, "safe-service-proposal-payload.json") : null,
    signature: signatureAnalysis ? {
      sender,
      recovered: signatureAnalysis.recovered,
      mode: signatureAnalysis.mode
    } : "not supplied"
  };
  writeJson(path.join(operationDir, "dry-run-result.json"), result);
  console.log(JSON.stringify(result, null, 2));
}

export { buildSafeTx, safeTxTypes, writeSigningPage, analyseSignature };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
