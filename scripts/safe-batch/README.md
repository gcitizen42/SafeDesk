# Safe Proposal Desk

Collect Ledger signatures for a prepared batch of Safe transactions, then publish the selected proposals to their chain-specific Safe transaction services. Browser and CLI share the same local collection. No private key is required or stored.

**Propose is not execute.** Publication exposes the signatures to the Safe service. Actual onchain execution remains a separate action after each Safe's approval threshold is met. Publishing several proposals is sequential, not one atomic multichain transaction.

## Start

Requires Node.js 22 or newer and this project's installed dependencies.

```bash
cd /Users/Citizen42/Desktop/TdaoUtils/AI-ops/tDAO-signerrotation
npm install --ignore-scripts
npm run batch -- serve
```

Open http://127.0.0.1:8770/ in Chrome or Brave with MetaMask and your Ledger account. The Codex in-app browser can show the desk but may not expose your wallet extension. The server listens only on localhost. If 8770 is already running, use that instance, or choose `serve --port 8771`.

The default batch is `operations/2026-10-09-outstanding-rotations`. Every command accepts `--root /absolute/path/to/another/prepared-batch`.

Operation folders and signatures are intentionally not committed. On a fresh checkout, initialize an empty batch before starting the desk:

```bash
npm ci --ignore-scripts
npm run batch -- init
npm run batch -- serve
```

This uses `operations/batch` when the existing local October batch is absent. Import your complete prepared `signing-data.json` with **Add Safe**, or choose an existing batch with `--root`. Do not commit private preparations or collections to share them.

## Browser Workflow

1. Select a Safe in the left list. Check its chain, address, nonce, complete payload, current/proposed owners and approval threshold.
2. Use **Check current state**. Live chain state and the Safe service queue must still match the preparation.
3. Use **Simulate on Tenderly** to review and confirm a new isolated environment. It assumes owner approvals, executes the exact SafeTx on the fork, checks the success event/final state, and automatically attaches the result and dashboard link. Alternatively, **Attach result** accepts existing evidence. The earlier BOB local-fork reports are not Tenderly vnets.
4. Connect your existing owner account. **Sign and collect** requests EIP-712 signing and switches the wallet to the selected chain. Validate the request yourself on the Ledger. **Ledger hash signing** is the personal_sign fallback for the exact SafeTx hash; it provides less hardware-readable context.
5. The server verifies signature recovery against the exact transaction and current owners before saving it. Use **Next Safe**, or **Add Safe** to import another full `signing-data.json`.
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

`add` expects the complete EIP-712 domain and all ten SafeTx fields, not a Safe address or hash alone. It checks the chain, current nonce and onchain transaction hash. Imported generic transactions do not claim a final owner roster/threshold; inspect their payload and simulation separately. Supported chains: Ethereum, BOB, Optimism, Arbitrum, Polygon and Base. RPCs/services are fixed known public endpoints in `core.mjs`; imported files cannot redirect proposal submission to an arbitrary service.

## Built-in Tenderly Simulation

Credentials stay server-side. Configure `TENDERLY_ACCOUNT_SLUG`, `TENDERLY_PROJECT_SLUG` and `TENDERLY_ACCESS_KEY` in your ignored project `.env` (see `.env.example`) or your shell. `SAFE_BATCH_TENDERLY_ENV_FILE` can point to another private environment file. In the existing AI-ops installation, `../Tenderly_simulations/.env` is reused if no project `.env` exists; no keys are copied into source files or sent to the browser.

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

Tests use synthetic wallets and mocked services, including signature binding, simulation matching, stale/conflicting state, partial publication recovery, shared-state locking, HTTP controls, Tenderly capacity/confirmation guards, virtual-RPC restrictions and failed execution handling. Hardware signing, live proposal publication and real virtual-environment creation require an operator's end-to-end test. Development verification itself creates no real environments.
