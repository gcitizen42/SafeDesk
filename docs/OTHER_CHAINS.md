# Other Chains: Sui / MSafe

This adapter reads Sui mainnet public data, derives multisig policies, builds unsigned object-migration transactions and runs native simulation. It never connects a wallet, signs, creates an MSafe, proposes or broadcasts. Starknet is reserved for a later adapter, not implemented here yet.

## Migration, Not In-Place Replacement

Sui native multisig addresses derive from ordered public keys, weights and threshold. Changing these produces a different address. MSafe adds an account-specifier key derived from its creation nonce; it is not a human owner. A 6-of-9 MSafe can contain ten native keys.

This is not an EVM owner swap. Selected objects move to a separately verified destination policy. Token transfers alone do not rotate AdminCaps, UpgradeCaps, other permissions, positions or references to the old address. [Sui address derivation](https://www.docs.sui.io/operators/exchange-integration), [MSafe glossary](https://doc.m-safe.io/sui/faq/glossary).

MSafe nonce parsing follows source distributed in the official `@msafe/sui3-utils` 5.1.0 package, `src/account.ts` and `src/constants.ts`: a final Ed25519 key contains `maven`, a little-endian uint32 nonce at byte 16, and weight 1. That reserved key must not make an otherwise unreachable threshold seem achievable.

## Browser Workflow

1. Open **Other Chains**, without needing EVM setup. Enter the existing vault, optionally your Sui signer, and an executed outgoing transaction digest or complete public policy.
2. Inspect. Public providers' mainnet identifiers are checked. The source policy must derive the supplied vault address, including key order and any MSafe specifier. Unknown policy blocks migration building.
3. Supply the desired public owner list and weighted threshold. Use scheme-prefixed Base64 Sui public keys; claimed addresses must match. Address-only rows are resolved from bounded public history when possible; otherwise supply the key. Use the correct MSafe creation nonce when registering a new MSafe, not an assumed zero.
4. Independently verify incoming owners' key access, threshold and any destination MSafe registration. Select exact non-SUI objects; none are selected automatically. Capability and unknown non-coin transfers need explicit acknowledgement. Framework kiosk and transfer-policy capabilities are included in this conservative classification.
5. Build and review the derived destination, exact selected and remaining objects, gas, expiration and digest. Simulate and inspect destination ownership changes. Unsigned simulation does not prove signatures or authorize execution.
6. Export **Plain Transaction JSON** and paste only the actual Mysten V2 JSON into MSafe's Plain Transaction field. The separate review package is not the import payload. The connected MSafe must match the sender. Review MSafe's final bytes and simulation before proposing yourself.

MSafe's Propose button is not a read-only import check: its current public demo invokes wallet `signAndExecuteTransaction` to propose an intention. SafeDesk deliberately does not perform that step. Existing source owners must meet their current threshold; incoming owners cannot substitute for those approvals. [Importer source](https://github.com/Momentum-Safe/msafe-sui-app-arbitrary-transaction/blob/688b34dc7ccd4d53fa6c544c3e775368ee195e47/src/App.tsx), [Plain Transaction guide](https://doc.m-safe.io/sui/app-store/plain-transaction).

## CLI

Store public operation inputs/outputs under ignored `operations/`, not in the public source tree. The CLI never overwrites files and uses no wallet/private key.

Inspection request shape:

```json
{
  "vault": "0xYOUR_SUI_VAULT",
  "signer": "0xYOUR_SUI_SIGNER",
  "evidenceDigest": "AN_EXECUTED_OUTGOING_TRANSACTION_DIGEST"
}
```

Replace placeholders before running:

```bash
npm run other-chains -- inspect --input operations/my-sui-operation/inspect.json --out operations/my-sui-operation/inspection.json
```

Public policy shape (template only; supply every owner and a reachable threshold):

```json
{
  "threshold": 6,
  "members": [
    {"address": "0xOWNER_ADDRESS", "publicKey": "SCHEME_PREFIXED_BASE64_KEY", "weight": 1}
  ],
  "creationNonce": 0
}
```

Optional `creationNonce` appends/validates the MSafe specifier. Omit it for a native non-MSafe policy. Import complete native source keys including any specifier, or real owners plus the correct nonce. Already derived policies contain a top-level expected `address`; editing keys without updating/removing that field is rejected.

```bash
npm run other-chains -- derive --input operations/my-sui-operation/target-policy.json --out operations/my-sui-operation/target-derived.json
```

A migration request combines inspection fields with `targetPolicy`, nonempty `objectIds`, `ackDestination: true`, and `ackPrivileged: true` only for deliberately included capabilities. These are human attestations, not cryptographic incoming-owner key-possession proof. Optional `gasBudgetMist` defaults to 50,000,000 MIST and cannot exceed 100,000,000 MIST (0.1 SUI).

```bash
npm run other-chains -- plan --input operations/my-sui-operation/migration-request.json --out operations/my-sui-operation/migration-package.json
npm run other-chains -- simulate --input operations/my-sui-operation/migration-package.json --out operations/my-sui-operation/simulation.json
```

`plan` also writes `migration-package.json.plain-transaction.json`, containing only Mysten V2 JSON for MSafe. The transaction digest commits to transaction bytes; the SHA-256 package hash detects package changes. Neither is a signature. A package hash alone is not an authenticity guarantee because it can be recomputed.

## Providers And Simulation

- Tenderly's published list does not include native Sui or Starknet. EVM Virtual Environments cannot validate Sui Move transactions. [Supported networks](https://docs.tenderly.co/platform/supported-networks), [Virtual Environments](https://docs.tenderly.co/virtual-environments/overview).
- Native simulation uses pinned Mysten SDK and official `https://fullnode.mainnet.sui.io:443` gRPC, checks enabled, source-owned real gas and selected destination-ownership verification. No execute/signature methods are called. [Mysten simulation](https://sdk.mystenlabs.com/sui/clients/executing).
- Historical evidence uses the pinned indexer `https://graphql.mainnet.sui.io/graphql` when full-node history is unavailable. Both mainnet identifiers are checked. Missing evidence remains unknown. [GraphQL client](https://sdk.mystenlabs.com/sui/clients/graphql).
- MSafe unauthenticated vault metadata can return 401. No login-token import, login-signature request or bypass is implemented; public onchain evidence supplies the policy instead.
- Browser API is same-origin, explicit-header, bounded and restricted to inspect/plan/simulate. No arbitrary RPC URL/SSRF inputs or signing/proposal/execute route exists. Custom providers are deferred.
- Public inputs reject private keys, seeds, passwords and login/signature fields. No MSafe or Tenderly credentials are needed.

## Limits And Execution Readiness

This is an unaudited unsigned builder, not a custody product. Inventory reads are not an atomic global checkpoint snapshot; build/simulation recheck object references and ownership. Public providers can lag or retain limited history.

SUI gas objects stay at the source. This version does not merge gas coins, spend address balances, sweep all assets, withdraw positions, change contract-specific admin fields or register a destination MSafe. Some objects cannot be publicly transferred; native simulation must expose those failures. A migration needs an explicit authority/asset reconciliation beyond merely copying tokens.

Simulation requires a package no older than 15 minutes. It rechecks ownership, versions, current object type/authority metadata, acknowledgement binding, gas price/owner, expiration, exact calldata, bytes and digest. Arbitrary Move calls, mocked gas, missing destination ownership or gas not retained at the source are rejected or failed proof. Browser Plain Transaction copy/download additionally require a current passing simulation. Rebuild when inputs/state change. Exports expire after the next epoch. MSafe can rebuild gas and bytes; compare its final proposal and fresh simulation before signing. No unsigned simulation verifies source approvals or destination private-key availability.

Before execution: approve the final chain-specific member list, threshold and scope; verify all destination owners' wallet access and fund its SUI gas separately; collect old-policy threshold approvals in the official wallet; reconcile destination assets/authority; update DAO references; monitor the old address for late deposits. Those steps remain human-controlled and outside this adapter.
