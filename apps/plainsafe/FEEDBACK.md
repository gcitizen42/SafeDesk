# Uniswap developer feedback: Plain Safe

Plain Safe is a local-first UI for Safe multisigs. Its swap flow reads Uniswap v3 and v4 quotes through the user's RPC, builds a Safe transaction for Universal Router 2.2.0, and renders the router's commands for a signer to review. It uses no Uniswap API or hosted routing service.

## What worked well

- QuoterV2 and V4Quoter made it possible to compare candidate routes with `eth_call` at one pinned block. This fits an app whose default network policy permits only the user's chosen RPC.
- The deployment feed provided the newer Universal Router address when the main deployment docs had not yet listed version 2.2.0 during this build.
- Permit2 and Universal Router let the Safe execute a token swap with a bounded approval and explicit output recipient. Native ETH swaps need only one router call; token swaps use a checked MultiSendCallOnly batch for approvals and execution.

## Friction and suggestions

1. **Versioned router command documentation.** Universal Router 2.2.0 added `minHopPriceX36` to the v3 exact-input command and its v4 action. We had to confirm the input layout against `Dispatcher.sol` and the pinned v4 periphery source. A versioned, machine-readable table of command IDs, ABI input tuples, recipient placeholder semantics, and changes between router releases would make independent encoders and transaction reviewers easier to maintain.
2. **Deployment data and docs in one place.** The deployment feed and documentation did not show the same newest router version while we built this. Publishing the feed's version, address, chain, source tag, and deployment block together on the docs page would make it easier to verify which contract a wallet should target.
3. **Examples for delayed multisig execution.** A Safe may collect signatures over hours. An example showing a Permit2 allowance, a Universal Router deadline, a signed minimum output, a fresh pre-execution quote, and recipient ownership would help wallet builders avoid stale or misleading swap previews.

## How we tested the integration

Pure tests cover route candidates, router encoding and decoding, and TWAP arithmetic. The Mainnet integration test simulates app-built v3 and v4 swaps through a real Safe against Universal Router 2.2.0 using `eth_simulateV1` state overrides. The demo uses a local Sepolia fork and throwaway test wallets.

## Code pointers

- Route construction, contract addresses, QuoterV2/V4Quoter calls, Universal Router encoding and command decoding: [`src/core/uniswap.ts`](src/core/uniswap.ts)
- RPC quote and TWAP reads: [`src/features/swap/program.ts`](src/features/swap/program.ts)
- Swap form: [`src/features/swap/swap-preset.tsx`](src/features/swap/swap-preset.tsx)
- Fresh quote versus the signed minimum on review: [`src/features/swap/swap-panel.tsx`](src/features/swap/swap-panel.tsx)
- Command-by-command signer view: [`src/features/swap/router-view.tsx`](src/features/swap/router-view.tsx)
- Mainnet simulation checks: [`test/integration/swap-mainnet.test.ts`](test/integration/swap-mainnet.test.ts)

The product spec records the exact router version, addresses, and route shapes in [`SPEC.md` §3.13](SPEC.md).
