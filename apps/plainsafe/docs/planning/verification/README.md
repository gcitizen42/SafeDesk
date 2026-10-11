# Pre-build verification scripts

These scripts were written during planning (2026-09-26) to check the Safe and pricing assumptions in `SPEC.md` against real Mainnet contracts. They are the source for the integration test in SPEC §13 (`test/integration/safe-mainnet.test.ts`). Port them into that test instead of treating them as app code.

| Script | Checks | Spec |
|---|---|---|
| `safe.ts` | 18 checks against each of three real Safes (v1.3.0, v1.4.1 L2, v1.5.0): hashes vs `getTransactionHash()`, storage slots, test-key signatures via `eth_simulateV1` with state overrides, signature ordering, pre-validated signatures, `traceTransfers`, `simulateAndRevert`. **All 54 passed.** | §4.2–4.4, §5, §7.5 |
| `proxies.ts` | Works out each factory's proxy runtime code hash from `proxyCreationCode()` (v1.0.0–v1.5.0) and finds sample Safes | §4.2 |
| `prices.ts` | 1inch Spot Price Aggregator, Uniswap v3 `QuoterV2` and v4 `V4Quoter` over plain RPC; whether the aggregator exists on Sepolia | §10.1, §3.13 |
| `agg.ts` | The 1inch aggregator's owner, and how many price sources and routing tokens it uses | §10.1 |

Run with Bun and viem (they use MEV Blocker as the Mainnet RPC):

```sh
bun add viem
bun run safe.ts
```

The sample Safe addresses and results are recorded in SPEC §4.4.
