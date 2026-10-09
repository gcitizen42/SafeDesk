# tDAO Signer Rotation

This project inventories Threshold DAO Safe multisigs for a signer and prepares one Safe Transaction Builder JSON per Safe using [`safe-owner-manager`](https://github.com/GNSPS/safe-owner-manager).

The workflow is intentionally two-stage:

1. Discover Safes where the signer is currently an owner.
2. After the final signer list is provided, generate per-Safe rotation JSON files.

Generated JSON must be reviewed and simulated before use. Optional signing/proposal tools support Ledger signatures and publication to Safe transaction services; they do not execute live Safe transactions automatically.

## Batch Signing and Proposals

Open the Safe proposal desk to collect signatures across chains, review the batch and publish selected proposals:

```bash
npm run batch -- serve
```

Open http://127.0.0.1:8770/ in your Ledger/MetaMask browser. CLI users can use `npm run batch -- list`, `collect`, `review` and `propose`. Full usage, simulation requirements and safeguards are in [the batch guide](scripts/safe-batch/README.md).

The **Simulate on Tenderly** button previews one new virtual environment before confirmation, simulates assumed approvals and the exact Safe execution, then attaches the checked result. CLI equivalent: `npm run batch -- simulate ID`. Credentials stay in ignored environment files, and capacity/daily limits prevent unbounded creation.

For a fresh Git checkout, run `npm ci --ignore-scripts`, then `npm run batch -- init` before `serve`. Operations, credentials and signature collections are deliberately excluded from Git; import prepared signing data or specify your own `--root` batch.

The default batch contains the five outstanding preparations from 9 October 2026. Drafts remain blocked. Publishing a proposal is separate from executing it, and signatures must not be reused across Safes or chains.

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
