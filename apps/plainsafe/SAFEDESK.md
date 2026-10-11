# SafeDesk's PlainSafe Integration

Upstream: [gskril/plainsafe](https://github.com/gskril/plainsafe), pinned at
`9a23f9ab38501cf09bb5464b2b5684314e9fb7d5`. The upstream MIT license and
Greg Skriloff's copyright notice are preserved in `LICENSE`. `README.md` and
`docs/` here describe the upstream, not a security certification of SafeDesk.

## Local Changes

- SafeDesk branding and navigation between two separate localhost origins.
- Read-only default for EIP-712 signing, `approveHash`, Safe creation and
  `execTransaction`. Their shared `useAccountOn` entry checks the launch
  policy before touching the wallet. Status is visible in the header.
- Enabling actions requires restarting with `--enable-wallet-actions`.
- `source-map-js` overridden to 1.2.2 to fix GHSA-68fv-2mgg-jv7q. All other
  upstream lockfile package versions remain unchanged.
- Compact tabs, zero letter spacing and an 8px base corner radius.
- The 47MB IPFS CID test has a 120-second deadline for slower machines;
  its inputs and expected CID are unchanged. Root tests use four workers.

The upstream network guard remains the first boot import. Its capability
allowlist, Safe-code validation, full EIP-712 hash verification, signature
recovery, simulation, IndexedDB schema and execution logic are retained.

## Boundaries

Safe Management serves static files on `http://127.0.0.1:8772`. The existing
Rotations & Simulations API is on `http://127.0.0.1:8770`. Navigation uses
normal links, not an iframe, reverse proxy, shared API token or `postMessage`
bridge. Cross-origin batch requests are rejected. No credentials or existing
collected signatures are automatically copied.

Configure each tab separately. PlainSafe keeps RPC URLs, packages and
signatures in the browser's **unencrypted IndexedDB**. Backups include
settings, so a private RPC URL can be present in a backup. Existing rotation
configuration/signatures stay in ignored filesystem secrets. Neither app
needs your wallet private key or seed phrase. A hardware wallet must still
be reviewed and confirmed by its owner.

Read-only mode is an accidental-action safeguard, not a sandbox against
malicious code, browser extensions or a compromised device.

## Limitations

- Unaudited software. Tests and a clean dependency scan do not establish
  suitability for unattended treasury execution.
- Supported Safe versions: 1.3.0, 1.4.1 and 1.5.0, subject to recognised
  proxy/singleton bytecode hashes. Older/unrecognised contracts are read-only.
  A `VERSION()` string alone is not sufficient proof of support.
- Package import/signing accepts 65-byte **EIP-712 EOA** signatures, not
  Safe `eth_sign` with v=31/32 or EIP-1271 contract signatures. Earlier
  Ledger collections are not imported or relabelled. Use the rotations tab.
- The local package queue does **not** mirror pending Safe Transaction
  Service proposals. Import a complete PlainSafe package from a co-signer
  to see that proposal. Onchain execution history can be read separately.
- RPC simulations are not Tenderly VNet evidence. Tenderly remains a
  separate confirmed workflow in Rotations & Simulations.
- Broadcast routing is controlled by the connected wallet. This is **not
  Flashbots/private relay execution**. Never use it for the coordinated
  Republic incident transaction.
- Clearing browser data loses local packages/signatures. Keep a private
  backup and the same browser profile and origin/port.

## Install, Validate and Run

From the SafeDesk project root, use Node 22.12+ with npm:

```bash
npm ci --ignore-scripts
npm run setup:manager
npm run build:manager
npm test
npm run test:local
npm run test:manager
npm run audit:manager
npm start
```

Setup obtains pinned Bun 1.4.3 through npm, uses the committed Bun lockfile
and skips dependency lifecycle scripts. Bun is not installed globally.
Serving a built app does not download code or dependencies.

Open `http://127.0.0.1:8772/` in a wallet-enabled browser. Configure an RPC,
add a Safe, inspect owners, threshold, balance and local queue. Connecting
a wallet does not override read-only mode. The other tab retains batch
proposals, Tenderly simulations and Ledger collection.

Only after independent review and a successful test with a disposable
wallet/fork, stop the server and explicitly opt into management actions:

```bash
npm start -- --enable-wallet-actions
```

This does not sign or send anything itself. Individual actions prompt the
wallet. Approvals/creation/execution are real transactions on production
networks; ordinary broadcast may be public.

Custom ports and batch folder:

```bash
npm start -- --port 8780 --manager-port 8782 --root /path/to/private-batch
```

Links update for both ports. Keep management's port stable for IndexedDB.
Previous rotation-only server and CLI:

```bash
npm run start:rotations
npm run safedesk -- list
npm run safedesk -- status OPERATION_ID
```

No automatic upstream updates. Review source, lockfile, license, wallet
actions and guards before updating this vendored copy.
