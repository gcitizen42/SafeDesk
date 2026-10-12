# SafeDesk

SafeDesk is one local application with two nested workspaces at the same address:

- **Safe Management**, powered by a pinned, modified MIT-licensed copy of [PlainSafe](https://github.com/gskril/plainsafe): configure RPCs, inspect Safes, build/edit/import transactions, choose EIP-712 or Ledger hash signing and share verified packages. Starts read-only.
- **Rotations & Simulations**, our existing multichain workflow: choose owners/thresholds, generate calls using [`safe-owner-manager`](https://github.com/GNSPS/safe-owner-manager), simulate with Tenderly, collect Ledger signatures and publish reviewed proposals.

Both workspaces are routes inside the PlainSafe-powered interface, served by one localhost process. Rotation endpoints are namespaced under `/api/rotations/` and retain session-token, origin and confirmation checks. They share the app's trust boundary, not an automatic credential/signature transfer. **SafeDesk is unaudited; local hosting is not a security certification.** Read [Security](SECURITY.md) and the [integration guide](apps/plainsafe/SAFEDESK.md) before enabling management wallet actions. Credit and the original license are preserved in [Third-Party Notices](THIRD_PARTY_NOTICES.md).

The rotations tab's live panel shows nonce, verified published approvals, local signatures, conflicts and wallet readiness. Its execution/gas check is read-only; use Safe to execute separately. The management tab can sign/execute only when explicitly enabled at launch and confirmed in the wallet. It is not a private relay and must not be used for the Republic incident operation.

## Quick Start

```bash
git clone https://github.com/gcitizen42/SafeDesk.git
cd SafeDesk
npm run install:desk
npm start
```

Requires Node 22.12+ and npm. Setup obtains pinned Bun through npm without a global installation. Builds use the committed lockfile; serving downloads no code.

Open [SafeDesk](http://127.0.0.1:8772/) in a wallet-enabled browser. **Rotations & Simulations** stays inside the same app at [/#/rotations](http://127.0.0.1:8772/#/rotations), with no iframe, second port or page handoff. Management starts read-only. Existing rotation files and collected signatures remain unchanged. See [Windows, macOS and Linux installation](docs/INSTALL.md); Windows users can also run `start-safedesk.cmd` after setup.

On a fresh rotation batch, its wizard asks you to:

1. Choose a network and public RPC from the Chainlist catalogue, or enter a custom HTTPS endpoint. SafeDesk verifies its chain ID.
2. Load the first Safe and review its current owners, threshold and nonce.
3. Enter the complete desired final owner list and approval threshold.
4. Optionally configure Tenderly account, project and access key.
5. Review and prepare the rotation. Simulate before signing, then add further Safes as needed.

Rotation RPCs and Tenderly keys stay in ignored local environment files. Management settings, including RPC URLs, stay unencrypted in browser IndexedDB and may be included in private backups. Do not share keyed RPC backups or signature collections publicly. The historical folder name stays `tDAO-signerrotation` for compatibility.

The legacy rotation-only server remains available with `npm run start:rotations`; it is not needed for the combined app. CLI commands still work. Management's local queue does not mirror Safe service proposals, and earlier rotation collections use a different file format. EIP-712 and Safe personal-sign packages are supported; signature transfer between workspaces remains explicit.

## Verification

The Safe badge is based on the **keccak256 of deployed proxy and implementation bytecode**, matched with the pinned `safe-deployments` table. Expand **How this Safe was verified** to see the full hashes, implementation address, source and checked block. A matching `VERSION()` string or familiar address alone is not sufficient. This checks code identity from your RPC, not owners' trustworthiness or a security audit.

The header's **Build fingerprint** opens Settings > About, showing SHA-256 fingerprints for built app files and tracked source, plus the build commit. `npm run verify:app` checks copied files against the local manifest; startup refuses mismatches and changed assets are not served. A replaced app and manifest can still agree, so compare source/commit with this repository independently. The fingerprint is an integrity check, not an official Safe certificate.

## Networks and Signing

Both workspaces use the same sanitised [Chainlist catalogue](https://chainlist.org). In management, choose **Add network**, **Load public chains**, search/select the chain, choose a public or custom RPC, then test its chain ID before adding it. The top **Network** dropdown filters your configured Safes without silently switching a transaction to another chain.

The catalogue covers positive, safe-integer EVM chain IDs; non-EVM wallets use different tools. Inclusion does not imply a valid Safe deployment, a reliable RPC or Safe service support. Private/placeholder endpoints are excluded, requests are bounded, and known public defaults remain available offline.

The proposal desk deliberately supports Ethereum, Arbitrum, Optimism, Polygon, Base and BOB only. Other EVM chains can be configured for direct Safe management if their Safe bytecode is recognised. Private RPC configuration remains separate between workspaces.

**Signing method** is a small dropdown in each transaction view:

- **EIP-712 typed data** (default): review the complete SafeTx/domain in the wallet.
- **Ledger hash / personal_sign**: sign the same SafeTx hash using the message prefix; verified signatures are stored in Safe's v=31/32 format.

The app rejects a returned signature that does not match the selected method or owner. There is no silent fallback. Contract/EIP-1271 signatures remain unsupported as plain EOA signatures.

## Transaction Builder

In management, open a Safe and choose **New transaction**. Native/token transfers, contract calls, owners/threshold changes and supported Uniswap actions remain available. **Transaction Builder** adds a raw editor and Safe Builder JSON import:

- Full SafeTx/signing data preserves target, value, calldata, operation, nonce and all gas/refund fields.
- Safe Builder exports with encoded data or ABI method/input values can be imported. Chain/Safe context is checked.
- Multiple CALLs are wrapped using a code-hash-verified MultiSendCallOnly. Inner delegatecall batches are rejected; a reviewed full SafeTx can preserve an explicit outer delegatecall.
- **Edit** and **Edit as new draft** never mutate a signed package. Changed fields generate a different hash and need new signatures; the original remains in the queue.
- Export a Safe Builder JSON file, full proposal signing data, and a verified signature collection. Full signing data is authoritative for nonce/gas/refund fields; standard Builder JSON is not a signature package.

To publish through the proposal desk, use a supported chain, export the operation's **Proposal signing data**, import it using the same operation name in Rotations & Simulations, attach/run a matching successful simulation, import **Proposal signatures**, then **Review proposals** and confirm publication. CLI equivalents remain available. No export, editing or preparation sends an onchain transaction.

**DELEGATECALL must remain operation 1.** Some external Builder imports may alter it; verify the full resulting SafeTx hash before signing. Proposal publication is not execution, and this app is not a private relay.

## Public Repository

The repository contains source, pinned dependencies, tests and documentation only. Keep `operations/`, `secrets/`, environment files, private RPC config, signatures and browser backups out of Git. Before pushing:

```bash
npm run check:public -- --history
npm test
npm run test:manager
npm run build:manager
```

The public-source check recognises local known credentials/signatures and unsafe tracked paths; it is not a complete secret scanner. Manually review staged changes. GitHub CI runs mocked/local checks without production RPCs or wallet secrets. PlainSafe credit is visible in the application and its original MIT notice remains intact.

See the [operator guide](scripts/safe-batch/README.md) for the wizard, CLI equivalents, private configuration, simulation and proposal safeguards. The older discovery/audit tools below remain available.

The workflow is intentionally two-stage:

1. Discover Safes where the signer is currently an owner.
2. After the final signer list is provided, generate per-Safe rotation JSON files.

Generated JSON must be reviewed and simulated before use. Optional signing/proposal tools support Ledger signatures and publication to Safe transaction services; they do not execute live Safe transactions automatically.

## Batch Signing and Proposals

Open SafeDesk to collect signatures across chains, review the batch and publish selected proposals:

```bash
npm start
```

Open http://127.0.0.1:8772/#/rotations in your Ledger/MetaMask browser. CLI users can use `npm run batch -- list`, `collect`, `review` and `propose`. Full usage, simulation requirements and safeguards are in [the batch guide](scripts/safe-batch/README.md).

The **Simulate on Tenderly** button previews one new virtual environment before confirmation, simulates assumed approvals and the exact Safe execution, then attaches the checked result. CLI equivalent: `npm run batch -- simulate ID`. Credentials stay in ignored environment files, and capacity/daily limits prevent unbounded creation.

After setup/build, `npm start` starts one local server and initializes an empty rotation batch if needed. Operations, credentials and signature collections are deliberately excluded from Git; prepared signing-data import and a custom `--root` batch are supported. Custom port: `npm start -- --port 8782`; both workspaces follow the same port.

A fresh checkout starts with an empty batch. Existing private local batches are reused when present; they are not included in this repository. Drafts remain blocked until their outstanding decisions are resolved. Publishing a proposal is separate from executing it, and signatures must not be reused across Safes or chains.

## Current Target Signer

`0x9C20993E98aa5A6BAD8AD0FC42C2f4cc3008096f`

## Install

```bash
cd /Users/Citizen42/Desktop/TdaoUtils/AI-ops/tDAO-signerrotation
npm install
```

## Discover Safes

```bash
npm run discover -- --owner 0x9C20993E98aa5A6BAD8AD0FC42C2f4cc3008096f
```

This writes:

- `operations/<run-id>/all-safes.json`
- `operations/<run-id>/inventory/chain-<id>-<name>/<safe>/safe-info.json`
- `operations/<run-id>/rotation.template.json`
- `operations/<run-id>/NEXT_STEPS.md`

Discovery uses Safe Transaction Service owner endpoints:

`/api/v1/owners/{owner}/safes/`

The Safe Client Gateway owner endpoints are documented, but they returned `403` from this environment, so this project uses per-chain Transaction Service endpoints as the working source.

## Provide New Signers

Copy the generated template:

```bash
cp operations/<run-id>/rotation.template.json operations/<run-id>/rotation.json
```

Then set `newOwners` to the complete desired final signer list. This is important: `safe-owner-manager` expects the final owner set, not merely the signer being added.

Optional threshold controls:

- `newThresholdByDefault`: apply one threshold to all Safes.
- `newThresholdBySafe`: override by Safe address.
- Leave both unset/null to keep each Safe's current threshold.

## Generate Rotation JSON

```bash
npm run generate -- \
  --operation-dir /Users/Citizen42/Desktop/TdaoUtils/AI-ops/tDAO-signerrotation/operations/<run-id> \
  --rotation-file /Users/Citizen42/Desktop/TdaoUtils/AI-ops/tDAO-signerrotation/operations/<run-id>/rotation.json
```

This writes one folder per Safe:

`operations/<run-id>/generated-rotation/chain-<id>-<name>/<safe>/`

Each folder contains:

- `rotation_chain-<chainId>_<safe>.json`
- `owners-before.json`
- `owners-after.json`
- `command.txt`
- logs from `safe-owner-manager`

## RPCs

The generator can use public RPCs from `config/rpcs.example.json`. For more reliable operation, create:

`config/rpcs.local.json`

with the same shape:

```json
{
  "1": "https://your-mainnet-rpc",
  "42161": "https://your-arbitrum-rpc",
  "10": "https://your-optimism-rpc",
  "137": "https://your-polygon-rpc",
  "8453": "https://your-base-rpc"
}
```

`config/rpcs.local.json` is gitignored.

## Safety Checklist

- Review every `safe-info.json`.
- Confirm the final owner list removes the old signer and includes all intended signers.
- Confirm each threshold is sane for the owner count.
- Inspect every generated Safe Transaction Builder JSON by hand.
- Simulate each Safe transaction independently, preferably on Tenderly.
- Propose through the Safe UI chain by chain.

## Audit Rotated Safe Balances

Run the read-only balance and signer-alignment audit:

```bash
npm run balances
```

This checks the 16 rotation targets in `config/rotated-safes.json` and prints:

- Whether the current owners and threshold match the approved signer set.
- The Safe nonce.
- Native gas-token and trusted ERC-20 balances.

Save a Markdown snapshot:

```bash
npm run balances -- --output operations/ROTATED_SAFE_BALANCES.md
```

Add point-in-time USD valuations using contract-address matched CoinGecko prices:

```bash
npm run balances -- --usd --output operations/TREASURY_AUDIT_CURRENT.md
```

To include every indexed token, including likely spam and unsolicited airdrops:

```bash
npm run balances -- --all-tokens
```

This command is read-only and does not require a wallet, private key, or RPC secret.
