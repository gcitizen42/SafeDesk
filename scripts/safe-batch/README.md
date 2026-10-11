# SafeDesk Operator Guide

Prepare owner rotations, monitor Safe transaction readiness, collect Ledger signatures across chains, then publish selected proposals to their chain-specific Safe transaction services. Browser and CLI share the same local collection. No private key is required or stored.

**Propose is not execute.** Publication exposes the signatures to the Safe service. Actual onchain execution remains a separate action after each Safe's approval threshold is met. Publishing several proposals is sequential, not one atomic multichain transaction.

## Start

Requires Node.js 22 or newer and this project's installed dependencies.

```bash
cd /Users/Citizen42/Desktop/TdaoUtils/AI-ops/tDAO-signerrotation
npm ci --ignore-scripts
npm start
```

Open http://127.0.0.1:8770/ in Chrome or Brave with MetaMask and your Ledger account. The Codex in-app browser can show the desk but may not expose your wallet extension. The server listens only on localhost. If 8770 is already running, use that instance, or choose `serve --port 8771`.

The default batch is `operations/2026-10-09-outstanding-rotations`. Every command accepts `--root /absolute/path/to/another/prepared-batch`.

Operation folders and signatures are intentionally not committed. On a fresh checkout, starting the desk initializes an empty batch and opens the setup wizard automatically:

```bash
npm ci --ignore-scripts
npm start
```

This uses `operations/batch` when the existing local October batch is absent. **Add Safe** starts the rotation wizard; **Import transaction** accepts complete prepared `signing-data.json`. Choose an existing batch with `--root`. Do not commit private preparations or collections to share them. `npm run safedesk -- ...` is the preferred CLI command; `npm run batch -- ...` remains compatible.

## Setup Wizard

1. Choose one of the six supported networks. RPC choices are fetched server-side from `https://chainlist.org/rpcs.json`, cached for an hour, with known public fallbacks. The default is a known public endpoint; the catalogue is not a guarantee of provider reliability. Chain identity is checked before proceeding. Custom RPCs must be public HTTPS endpoints, with no URL login, local/private network address or unresolved placeholders.
2. Give the operation a unique lowercase name and load the Safe address. Owners, threshold and nonce are read at a single block. Wrong-chain RPCs, undeployed accounts and invalid Safe state are rejected.
3. Enter the **entire desired final owner list**, not just incoming owners. Threshold starts at the Safe's current value and must be between one and the final owner count. Removing owners does not authorize an unapproved threshold choice.
4. Optionally enable Tenderly and enter the account slug, project slug and access key. A blank key preserves an existing configuration. This step creates no virtual environment. With Tenderly disabled, you can still attach trusted external matching simulation evidence.
5. Review both owner lists and the threshold, then prepare. SafeDesk uses Safe Owner Manager against a pinned verified snapshot, independently validates its owner-list predecessors and final state, builds the complete SafeTx and compares its hash with the Safe contract. It rechecks live state and the service queue before saving. No-op changes, occupied nonces and duplicate preparations are blocked.

Prepared files are saved under `<batch>/<operation>/`: `rotation.json`, `operation.json`, `current-owners.json`, `owners-after.json`, `decoded-inner-transactions.json` and `signing-data.json`. Preparation does not sign, propose or execute. A matching successful simulation is required to collect signatures.

The settings icon edits network RPCs and optional Tenderly configuration. Configured private RPCs are never returned to the browser; choose **Keep configured RPC** to reuse one, or enter a replacement. Wallet network addition always uses the built-in public RPC, not your private URL.

Safe Owner Manager 1.0.4 omits a threshold-only change when the owner set is unchanged. SafeDesk handles that case with an explicit `changeThreshold` call and validates the resulting threshold. All owner changes continue to use the library's output.

## Current Transaction and Wallet

**Refresh transaction** reads the chain and the Safe service without signing or submitting. It shows current/prepared nonces, proposal/execution state, the current queue and conflicts, published approvals, local signatures, and usable distinct current-owner signatures. Local signatures are not counted as published approvals.

Published EOA signatures are cryptographically recovered against the full payload. Preapproved-hash signatures are counted only when the current Safe's onchain approval exists. Contract-owner/EIP-1271 or unverified service confirmations are shown as unverified and excluded. Unknown/unavailable service data is never presented as ready. After a live check, the displayed current owner list and threshold use the current chain state.

Signing readiness requires an existing owner, correct wallet network, unchanged payload/state, no conflicting nonce, no draft, and matching successful simulation. With enough usable signatures and a connected wallet, SafeDesk also attempts an `eth_call` of the exact execution and estimates gas at the inspected block, comparing estimated native cost to the wallet balance with 20% headroom. Any account can potentially submit a valid fully approved Safe execution; being an owner is not itself an execution requirement.

This is a **read-only readiness check**, not an execution guarantee or cost quote. State/gas prices can change, guards can reject, and L2 data fees may not be fully reflected in the RPC estimate. Execution remains a separate wallet-confirmed action through **Open in Safe**. Publish local-only approvals first when using Safe's UI. No automatic polling or blockchain broadcast occurs.

## Browser Workflow

1. Select a Safe in the left list. Check its chain, address, nonce, complete payload, current/proposed owners and approval threshold.
2. Use **Refresh transaction**. Review nonce, approvals, conflicts and wallet readiness.
3. Use **Simulate on Tenderly** to review and confirm a new isolated environment. It assumes owner approvals, executes the exact SafeTx on the fork, checks the success event/final state, and automatically attaches the result and dashboard link. Alternatively, **Attach result** accepts existing evidence. The earlier BOB local-fork reports are not Tenderly vnets.
4. Connect your existing owner account. **Sign and collect** requests EIP-712 signing and switches the wallet to the selected chain. Validate the request yourself on the Ledger. **Ledger hash signing** is the personal_sign fallback for the exact SafeTx hash; it provides less hardware-readable context.
5. The server verifies signature recovery against the exact transaction and current owners before saving it. Use **Next Safe**, **Add Safe** to prepare another rotation, or **Import transaction** for existing full signing data.
6. **Export collection** creates a portable signature file. **Import collection** revalidates signatures against the already-prepared operations. Matching simulation evidence must be present on the receiving machine too; imports do not automatically trust simulation metadata in a collection.
7. Select the operations you intend to publish, use **Review proposals**, inspect the review, then press **Propose selected**. This publishes proposals/confirmations, not onchain transactions.

Signing alone does not broadcast a transaction or upload a confirmation to Safe. Nevertheless, a valid signature authorizes that exact transaction and may be used to execute it when enough owner approvals are available. Keep collections private until publication is intended.

## Command-Line Workflow

```bash
cd /Users/Citizen42/Desktop/TdaoUtils/AI-ops/tDAO-signerrotation
npm run batch -- list
npm run batch -- check all

# Prompt for the current owner address and the matching signature.
npm run batch -- collect bob-3e61
npm run batch -- collect bob-694d
npm run batch -- collect bob-3266

# Read-only review. This does not publish anything.
npm run batch -- review --ids bob-3e61,bob-694d,bob-3266

# Prompts for PROPOSE before publishing to the Safe services.
npm run batch -- propose --ids bob-3e61,bob-694d,bob-3266
```

For a signature produced with an external signer, put `sender` and `signature` fields in a private JSON file and use `collect ID --file /private/path/signature.json`. Do not put a signature or private key directly in a command argument. Interactive input can still appear in terminal scrollback. The CLI verifies/collects externally generated signatures; it does not directly drive a Ledger over USB.

Other commands:

```bash
npm run batch -- add new-safe --file /path/to/signing-data.json
npm run batch -- simulate new-safe
npm run batch -- attach-simulation new-safe --url https://dashboard.tenderly.co/... --file /path/to/result.json
npm run batch -- export --out /private/path/safe-signature-collection.json
npm run batch -- import /private/path/safe-signature-collection.json
```

`add` expects the complete EIP-712 domain and all ten SafeTx fields, not a Safe address or hash alone. It checks the chain, current nonce and onchain transaction hash. Imported generic transactions do not claim a final owner roster/threshold; inspect their payload and simulation separately. Supported chains: Ethereum, BOB, Optimism, Arbitrum, Polygon and Base. Configured RPCs override known public defaults. Safe services remain fixed trusted endpoints; imported files cannot redirect proposal submission to an arbitrary service.

### CLI Setup and Readiness

```bash
npm run safedesk -- chains
npm run safedesk -- configure
npm run safedesk -- configure --file /private/path/settings.json
npm run safedesk -- inspect --file /private/path/rotation-input.json
npm run safedesk -- prepare --file /private/path/rotation-input.json
npm run safedesk -- status ID
npm run safedesk -- status ID --account 0xYOUR_EXECUTOR --wallet-chain 60808
```

`configure` without a file prints redacted configuration only. `prepare` prompts for **PREPARE** after displaying the live snapshot and requested final owners/threshold. The externally signed hash is produced during preparation, before simulation or signing; simulation does not create a different signing hash.

Rotation input shape (addresses below are examples, not actual deployment instructions):

```json
{
  "id": "my-safe",
  "chainId": 60808,
  "safe": "0x1111111111111111111111111111111111111111",
  "newOwners": [
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333"
  ],
  "threshold": 2
}
```

Optional `rpcUrl` overrides the chain's configured/default RPC. Optional `tenderly` object accepts `enabled`, `account`, `project`, `key`. The same RPC/Tenderly fields can be supplied to `configure`. Keep credential-bearing input files under `<batch>/secrets/`, with mode 0600, or another ignored private location, not in command arguments or source-controlled examples. Each command accepts `--root /absolute/batch/path`. CLI Ledger signatures still come from the browser or an external signer.

## Built-in Tenderly Simulation

Credentials stay server-side. The wizard/settings write custom RPCs and Tenderly credentials to `<batch>/secrets/safedesk.env`, mode 0600; non-secret enable/disable preference is `<batch>/secrets/settings.json`. These are ignored, plaintext private files, not encryption. Browser fields are cleared when setup finishes or is cancelled; keys and saved private RPCs are not returned in API responses.

Existing `TENDERLY_ACCOUNT_SLUG`, `TENDERLY_PROJECT_SLUG` and `TENDERLY_ACCESS_KEY` in the ignored project `.env` (see `.env.example`) or shell still work. `SAFE_BATCH_TENDERLY_ENV_FILE` can point to another private environment file. In this AI-ops installation, `../Tenderly_simulations/.env` is reused if no project `.env` exists. Batch-specific wizard credentials take precedence; no legacy secrets are copied into source files or sent to the browser. The per-batch disable switch and project safety policy are both enforced.

The button's first step is read-only: it checks current Safe state, Tenderly's supported-network catalogue and current project capacity. Only **Create and simulate**, or typing **SIMULATE** in the CLI, authorizes one new environment. Private explorer is the default. Check **Public explorer**, or use `simulate ID --public-explorer`, only when you intend to expose simulated addresses and calldata.

The project guard in `config/batch-tenderly-policy.json` allows at most 20 listed environments, five creation attempts per batch per UTC day, ten simulated approvers, and bounded receipt polling. These are this tool's conservative limits, not a statement of Tenderly's plan allowance or pricing. Set `enabled` to false to disable creation. Environments consume Tenderly resources; never assume API usage is free.

The runner preserves the real chain ID, funds only approval senders on the fork, and calls `approveHash` as enough existing owners before `execTransaction`. It does not change Safe owner/threshold storage to bypass approval checks. Real collected signatures are never used for the simulation. Drafts can be simulated, but remain blocked from signing/proposing until their decision is confirmed.

Passing requires the same hash, matching execution payload, Safe `ExecutionSuccess` event, nonce increment, and (for prepared rotations) the exact proposed owners and threshold. A newer failed execution supersedes older passing local evidence. The UI shows progress and the new environment link; successful results attach automatically.

Private RPC details and evidence are saved under `<batch>/secrets/tenderly-runs/<run-id>/`, with file permission 0600. `REPORT.md` and `result.json` summarize the outcome; `environment.json` contains sensitive RPC URLs and must never be shared. This runner does not delete environments, retry uncertain creation, publish Safe proposals, or broadcast real onchain transactions. If interrupted or timed out, inspect Tenderly and the saved run before retrying.

API references: [Virtual Environment REST API](https://docs.tenderly.co/virtual-environments/rest-api), [Admin RPC](https://docs.tenderly.co/virtual-environments/admin-rpc).

## Simulation Evidence and Hashes

The authoritative signing hash is recomputed from the chain ID, Safe address, nonce and complete Safe transaction, then compared with the Safe contract's `getTransactionHash`. A Tenderly transaction hash is usually the hash of the outer simulated EOA transaction, not this SafeTx hash.

Attaching an external URL only records a reference; arbitrary links are not scraped or authenticated. The built-in runner verifies its own authenticated virtual execution automatically. To validate an externally imported execution, supply JSON containing:

```json
{
  "transaction": {
    "to": "0xSAFE_ADDRESS",
    "input": "0xFULL_ENCODED_SAFE_EXECTRANSACTION"
  },
  "receipt": {
    "logs": [
      {
        "address": "0xSAFE_ADDRESS",
        "topics": ["0xEXECUTION_SUCCESS_EVENT_TOPIC"],
        "data": "0xABI_ENCODED_SAFE_TX_HASH_AND_PAYMENT"
      }
    ]
  }
}
```

Get the exact transaction input and receipt logs from your trusted vnet execution record/RPC, without including a private RPC URL or API key in the JSON. The importer compares all nine execTransaction payload fields and requires the Safe's `ExecutionSuccess(bytes32,uint256)` event for the computed SafeTx hash. It rejects a failed/different execution or an outer transaction hash alone.

Existing local reports, or your own trusted simulation runner, can instead supply `{ "status": "PASSED", "safeTxHash": "0x...", "kind": "...", "approvalAssumption": "..." }`. This is an operator-supplied assertion, **not independently authenticated proof**. Only use reports whose origin and full execution you have reviewed. Simulations that assume owner approvals do not establish actual consent.

## Safeguards and Recovery

- Changed nonce, owner set, threshold, chain/hash, conflicting queue entry, non-owner signature, unsigned operation, draft or missing successful simulation blocks the relevant action.
- Only 65-byte EOA signatures are supported. Contract-owner/EIP-1271 signatures and service delegates require a separate workflow.
- Local state is `<batch>/secrets/batch-state.json`, with directory permission 0700 and file permission 0600. This is plaintext with private filesystem permissions, **not encryption**. No private keys are stored.
- The HTTP server does not expose secret files or directory listings. It rejects foreign Host/Origin headers and requires a session token for changes and signature exports. Do not reverse-proxy it to the internet.
- UI and CLI mutations use a shared lock and atomic state-file replacement. If a command was forcibly interrupted and leaves `secrets/batch.lock`, inspect its recorded process ID and ensure that process is no longer running before removing only that lock file.
- Publication checks current state again, reuses an existing matching proposal and adds missing confirmations. On an ambiguous network failure it records `needs-check` and stops the batch. Inspect Safe before retrying; accepted submissions cannot be rolled back by this tool.
- Browser exports contain real signatures. Move them to a private location, keep them out of Git/cloud sharing, and do not post them in chat. CLI export uses permission 0600 and refuses to overwrite an existing file.

The current three BOB operations are eligible for Citizen42 signing after fresh checks. Optimism and Arbitrum remain drafts pending the threshold decision; Citizen42 is not yet a current owner there. Incoming-owner signatures cannot approve their own addition.

## Verification

```bash
node --test scripts/safe-batch/core.test.mjs
npm test
npm audit
```

Tests use synthetic wallets and mocked services, including signature binding, simulation matching, stale/conflicting state, partial publication recovery, shared-state locking, HTTP controls, Tenderly guards, RPC/configuration privacy, real Safe Owner Manager generation against a pinned mock snapshot, wizard preparation and read-only execution readiness. Hardware signing, live proposal publication and real virtual-environment creation require an operator's end-to-end test. Development verification itself creates no real environments.
