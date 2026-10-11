# Plain Safe: Product Spec

> **Status:** Working plan (2026-09-26). This version includes Greg's review feedback and the Safe verification in §4.4. One question is still open ([§17](#17-open-questions-and-follow-ups)).
> **Context:** Built solo at ETHGlobal Tokyo 2026 (Sep 25–27) on the **Classic "From Scratch"** track. This spec was written before hacking began. Per ETHGlobal's AI rules it is committed as a planning artifact, and the full planning transcript lives in `docs/planning/`.
> **License:** MIT
> **Name:** Plain Safe (`plainsafe.eth`)

---

## 0. TL;DR

Plain Safe is a static, local-first web UI for Safe multisigs. It reads everything it needs from the chain through **one RPC endpoint you choose**, and signers pass signatures to each other as **plain JSON files or links**. There is no Safe Transaction Service, no backend, no analytics, and by default **no network request other than the RPC**. The app enforces this in code and shows it to the user in a live network log.

The core loop:

1. Add a Safe.
2. Build a transaction.
3. Review it (clear signing, safety rules, simulation, and all three hashes).
4. Sign it.
5. Share a link; co-signers open it, verify it and add their signatures.
6. Execute.

Balances come from token lists you import in the Uniswap Token Lists format.

---

## 1. Product

### 1.1 Why

A Safe is a contract, and anyone holding enough owner signatures can execute its transactions. Everything before execution usually runs through Safe's hosted frontend and Transaction Service. When the software that *shows* the transaction is compromised, signers approve something other than what they see:

- **WazirX** (Jul 2024, ~$235M)
- **Radiant** (Oct 2024, ~$50M)
- **Bybit** (Feb 2025, ~$1.5B)

Plain Safe passes Vitalik's **walkaway test**. If Safe's infrastructure disappeared tomorrow, a signer could still:

- open a local copy or the IPFS release,
- rebuild the transaction from onchain state,
- recompute its hashes,
- verify what they're signing,
- exchange signatures through files or links,
- and execute using only an RPC.

TheDAO Security Fund's [Production-Ready Local-First Safe UI RFP](https://initiatives.thedao.fund/initiative/production-ready-local-first-safe-ui) is a **reference, not a contract**. The goal is simply for this product to exist and be good.

### 1.2 Principles

1. **The RPC is the only default outbound request.** Anything else is opt-in, labeled with its host, and enforced by `netguard` (§8).
2. **Verify, don't trust.**
   - The Safe's authenticity is checked by code hash, not by `VERSION()`.
   - Imported hashes are always recomputed.
   - Every signature is recovered and checked against the *current* owners.
3. **Hashes are always visible.** The domain hash, message hash and safeTxHash appear on every review screen.
4. **Unverified stays unverified.** Calldata we can't decode is shown as raw bytes with an "unverified" label, never as safe.
5. **Warnings never come from untrusted text.** Safety banners are computed from the decoded call, never from clear-signing descriptors.
6. **Design for the least technical signer**: someone who receives a link in Telegram and needs to know what they are signing.
7. **Nothing leaves the browser without consent**, including link payloads, which live in the URL fragment (`#`).

### 1.3 Non-goals

- Feature parity with Safe{Wallet}: Safe Apps, swaps, staking, onramps.
- Any backend, indexer service or telemetry.
- Mobile apps. The web UI is responsive, and signing works in wallets' built-in browsers.
- New smart contracts.

---

## 2. Scope and priority

### P0: the weekend (in build order, see §16)

- First-run setup (RPC chosen before any request is made)
- `netguard`: fetch, WebSocket, XHR and beacon guard with a live network log
- Adding a Safe on any chain, with the code-hash authenticity check (v1.3.0+)
- Transaction builder:
  - send ETH
  - send an ERC-20
  - contract call (whatsabi-assisted ABI, or raw calldata)
  - owner and threshold management
- Review screen:
  - clear signing (ERC-7730) and the five rendering levels
  - safety rules and whatsabi checks
  - simulation and all three hashes
- Signing with `eth_signTypedData_v4`
- Signature package as JSON file, link or code; import with verification and merge
- Execution with gas estimation and plain-language Safe error codes
- Queue for each Safe, plus **local history**
- Verify page, which computes hashes with no wallet and no RPC
- Token lists (Uniswap standard) and balances
- **Prices and fiat values from onchain sources** (§10.1)
- **ENS names**: shown for addresses and accepted in inputs, over RPC. CCIP-read is opt-in (§8.2).
- Opt-in network capabilities in Settings, and the network log drawer
- Address book; Back up and Restore
- Refusing to run on path-based IPFS gateways (§12)

### P1: ambitious, after P0

- **Swap through Uniswap** (§3.13), built together with MultiSend (MultiSendCallOnly) batching with recursive decoding
- `approveHash` as an onchain alternative to signing
- A one-click cancel: a 0-value self-call at the same nonce
- Simulating the whole queue (nonce N, N+1, …) in one `eth_simulateV1` call
- **Onchain history** (§11)
- A reproducible IPFS build, the CID script, and an omnipin release workflow (§12)
- An ENS contenthash for `plainsafe.eth`, updated through a Safe transaction built in Plain Safe itself
- **Creating a Safe** (§3.14), from the Add a Safe screen (agreed 2026-09-26)

### Out of scope

- Nested Safes and contract owners (EIP-1271)
- A CLI or local API
- Direct hardware-wallet integration. Ledger or Trezor *through* MetaMask or Rabby works like any other extension wallet.
- WalletConnect
- Prices from APIs (only onchain pricing is used, §10.1)
- Token logos
- NFTs
- Token transfer history
- Managing modules and guards (beyond what the builder's contract call allows)
- Signing Safe messages (off-chain EIP-1271 messages)
- `eth_sign` signatures
- Encrypting share links

---

## 3. Core flows

### 3.1 First-run setup

**No request leaves the browser until setup is done.** `netguard`'s allowlist starts empty.

1. A single sentence states the promise: *"Plain Safe talks to one RPC you choose. Nothing else, unless you turn it on."*
2. RPC fields for Mainnet and Sepolia, prefilled and editable:
   - Mainnet: `https://rpc.mevblocker.io` (MEV Blocker)
   - Sepolia: `https://evm.stupidtech.net/v1/11155111`

   A note under the fields: *"These are public endpoints. For privacy and reliability, use your own RPC (your node or a provider you trust)."*
3. A **Test** button next to each field:
   - It calls `eth_chainId`, which is the first network request and a deliberate one, and checks that the result matches the chain.
   - It also checks simulation support (§7.5).
4. A **"Use my wallet's RPC"** option for each chain. Reads go through the injected EIP-1193 provider, so the page itself makes no requests.
5. **Remove** on each chain, and **Add a chain** (the same form as "Other chains" below; its Test must match before it's added). Mainnet and Sepolia are only defaults: someone who works on one L2 can remove both and add just that chain.
   - **At least one chain is required.** With none, the add form is shown and Continue is disabled.
   - Without Mainnet, fiat values (§10.1) and ENS names on every chain but Sepolia (§8.5) are off, and a note says so.
   - Nothing is saved until Continue.
6. A folded **"Optional network access"** section with every capability off (§8.2).
7. **Continue** leads to Add a Safe.

**Other chains:** adding a Safe on a chain with no RPC asks only for the **chain ID**.
- The RPC is prefilled with `https://evm.stupidtech.net/v1/<chainId>` (MEV Blocker for Mainnet, as in §8.4) and can be edited, with the same "use your own RPC" note.
- `eth_chainId` must match.
- If `viem/chains` knows the chain, its name, native currency, explorer and Multicall3 address come from there. Otherwise the user enters a name and currency symbol, and multicalls use viem's `deployless` mode (§8.4).
  - Only those fields are bundled: `vite.config.ts` extracts them from the installed viem at build time into a lazy chunk (a virtual module), about 19 KB gzipped instead of 94 KB for viem's full chain definitions.

### 3.2 Adding a Safe

1. Enter a chain and address.
2. A single **pinned-block** read fetches the code of the proxy and singleton, storage slot 0, owners, threshold, nonce and ETH balance (§4, §8.4).
3. **Authenticity check** (§4.2):
   - **Pass:** the Safe is saved under "My Safes" and the version is inferred.
   - **Fail:** it's shown read-only, with the reason and signing disabled.
4. Owners can be labeled on the spot; labels go to the address book. An owner with an ENS primary name (§8.5) is already named and gets no label field.

A Safe is identified by **(chainId, address)**. The same address on two chains is two different Safes.

### 3.3 Building a transaction

The builder has these presets, and every one produces a `SafeTx`:

| Preset | Output |
|---|---|
| **Send ETH** | `{to, value, data: 0x, operation: 0}` |
| **Send ERC-20** | `transfer(to, amount)` on the token picked from your lists, "My tokens," or by address. Decimals come from the list or from RPC. |
| **Contract call** | Enter an address and whatsabi `autoload` follows proxies and extracts selectors from the bytecode. The ABI comes from the bundled set, then your ABI library, then Sourcify (if enabled). Pick a function, fill typed inputs, and viem `encodeFunctionData` builds it. Or paste raw calldata. `value` is editable. |
| **Owners and threshold** | `addOwnerWithThreshold`, `removeOwner` (with `prevOwner` taken from the `getOwners()` order), `swapOwner`, `changeThreshold`. Each targets the Safe itself with `operation: 0`. |

- **Nonce:** defaults to the next free nonce, `max(onchainNonce, highest queued nonce + 1)`. You can edit it to replace a queued transaction.
- **Advanced fields** (`safeTxGas`, `baseGas`, `gasPrice`, `gasToken`, `refundReceiver`) are hidden and default to 0. Editing them triggers the refund warning.
- **The builder never produces delegatecall** except for MultiSend batches (P1).

### 3.4 Review screen

Every transaction is reviewed on the same screen, whether you built it or imported it. The one main button changes with the situation: **Sign**, **Sign unverified transaction**, **Execute**, or **Share**.

1. **Safe identity:** address, ENS name (P1), chain, version, and the authenticity badge.
2. **Summary:** one plain-language sentence from clear signing (§7.2). If none is available, the builder's own description, or a sentence from the decoded call (`src/core/describe.ts`), the same one the queue and history rows use:
   - **Tokens** show amount and symbol only when the token is in your lists (never from the token contract here): "Send 799 USDC to 0xCc0a…4C00", "Approve 0x0000…8BA3 to spend unlimited USDC".
   - **Batches** read as one sentence when every call is alike: transfers of one token ("Send 1196 USDC to 3 addresses"), ETH sends, or owner changes on this Safe ("Add 2 owners and set threshold to 2"). Otherwise the first two calls are listed ("Batch of 3 calls: …").
   - **ENS calls** say what they change ("Set a name's ETH and default EVM addresses to 0x3AF5…Cbed", "Create or update a subname, owned by this Safe", "Renew "name.eth" for 5 years"); strings from the calldata are quoted and cut at 40 characters.
   - Otherwise the function name ("Call setApprovalForAll on 0x0000…2e1e").
3. **Details:** decoded fields at their trust level (§7.1), with raw fields folded away.
4. **Safety banners** (§7.4) and **whatsabi checks** (§7.3).
5. **Simulation** (§7.5): success with balance changes, predicted failure, or a warning that it isn't available.
6. **The three hashes**, with copy buttons: domain hash, message hash, and safeTxHash. A note tells signers to compare them with their wallet or device screen and an independent tool such as `safe-tx-hashes-util`.
7. **Signature progress** (for example "1 of 2"): owners listed with signed ✓, not signed, or "signature from non-owner (ignored)."

### 3.5 Signing

- Uses `eth_signTypedData_v4` through wagmi, with the connected account.
- **Before signing, switch or add the chain.** MetaMask rejects typed data whose `domain.chainId` differs from the active chain.
- The signature is checked by recovering it before it's stored.
- The package is updated and saved to the queue, and the **Share** panel opens.

### 3.6 Sharing

- **Copy link:** `<origin><path>#/import/<payload>`, where `payload = base64url(deflate-raw(JSON))` using the built-in `CompressionStream`. Nothing after the `#` is ever sent to a server or gateway.
- **Copy code:** `plainsafe:1:<payload>`. It can be pasted into *any* copy of Plain Safe (local, IPFS, or another gateway).
- **Download JSON:** `plainsafe-<safe-short>-n<nonce>-<safeTxHash-short>.json`.
- **Links over 4 KB** (large calldata) show a suggestion to use a file instead, since chat apps truncate long links.

### 3.7 Opening a shared link (co-signer)

1. **Offline, before any request:**
   - Decode and validate the payload with Effect Schema.
   - **Recompute all three hashes** from chainId, Safe, version and the transaction, and **reject the package** if the included hashes differ.
   - Recover the signers from each signature: "signed by `0xabc…` (not yet confirmed as owner)."
   - Show the transaction with a banner: **"Not yet checked against the chain."**
2. **First run:** setup (§3.1) comes next.
3. **With an RPC available:**
   - authenticity check,
   - owners, threshold and nonce at a pinned block,
   - each signature validated against the **current** owners,
   - then simulation.
4. The package is saved to that Safe's queue, and the Safe is added to **Recent** (not "My Safes").
5. The main button is **Connect** → **Sign** (if you're an owner who hasn't signed yet) → **Share updated link / code / file**, or **Execute** once the threshold is met.

**Accepted as input:** a full link, a `plainsafe:1:` code, raw JSON, or a dropped `.json` file.

### 3.8 Executing

- **Anyone can execute** once `collectedValidSignatures ≥ threshold`.
- If the executor is an owner who hasn't signed and exactly one signature is missing, the app adds a **pre-validated signature** for them.
- Signatures are **sorted in ascending order by signer address**, as `checkNSignatures` requires.
- The app switches chain, runs `eth_estimateGas` on the real `execTransaction`, and sends the call through wagmi.
- If `eth_estimateGas` fails, `GSxxx` revert codes are translated into plain language (a bundled table from safe-smart-account's error codes).
  - **The inner call's own failure looks different by version** when `safeTxGas` and `gasPrice` are both 0 (the default):
    - **v1.3.0 and v1.4.1** revert with `GS013`.
    - **v1.5.0** passes the inner call's revert data straight through instead.
  - So the translator decodes both: a `GS013` string, or the inner call's error (`Error(string)`, `Panic`, or a custom error decoded with the target's ABI when known).
- The explorer link comes from the chain config. It is **only a link; the app never fetches it**.
- After the transaction is sent, the app waits for the receipt, parses `ExecutionSuccess` or `ExecutionFailure`, marks the package **executed** or **failed** with the transaction hash, and records it in local history.

### 3.9 Queue and local history

Each Safe has a queue of the packages stored locally, grouped by nonce:

| State | Condition |
|---|---|
| Needs signatures | `nonce == onchainNonce` and valid signatures < threshold |
| Ready to execute | `nonce == onchainNonce` and valid signatures ≥ threshold |
| Future nonce | `nonce > onchainNonce` (an earlier nonce must execute first) |
| Conflict | another local package has the same nonce but a different safeTxHash |
| Executed | we recorded its execution (tx hash known) |
| Nonce used | `nonce < onchainNonce` and we didn't see it execute ("executed or replaced") |

- **Merging:** importing a package whose safeTxHash matches one already stored merges the signatures, de-duplicated by signer.
- **Local history** is simply the queue entries in the Executed and Nonce used states. They stay until the user deletes them.
- **Each row's summary** uses the same sources as the review screen (§7.1): clear signing first, then the decoding from chain facts (batches by MultiSend code hash, your ABI library, Sourcify when enabled). Until the target is read, the offline decoding shows only when it decodes the call; otherwise the row says "Decoding…".

### 3.10 Verify page

- **Input:** a pasted link, code, JSON, file, or the individual fields (chainId, Safe address, version, and every SafeTx field).
- **Output:** the domain hash, message hash and safeTxHash, plus the decoded calldata when it can be decoded offline.
- **No wallet and no RPC needed.** An optional **"Check against chain"** button runs the authenticity check and owner validation.

### 3.11 Balances and token lists

Covered in §10.

### 3.12 Settings

- **RPCs for each chain:** edit, test, "use my wallet's RPC," and add a custom chain.
- **Network access:** the capability toggles (§8.2).
- **Network log** (also a drawer reachable from the header).
- **Token lists and My tokens.**
- **Address book.**
- **Clear signing:** descriptors you imported, the trusted auditor list, and the registry commit.
- **ABI library:** ABIs you've pasted, tied to each contract's implementation code hash (§7.3).
- **Currency:** ETH, USD or EUR for fiat values (§10.1).
- **Back up and Restore.**
- **Onchain history:** turn on per Safe (§11, P1).
- **About:** version, commit, registry commit, safe-deployments version, and dependency list.

**Theme:** follows `prefers-color-scheme`, with no toggle. **Fonts:** the system font stack.

### 3.13 Swap (P1, first item, built together with MultiSend)

**Uniswap only.** Quotes, routing and the manipulation check all come from Uniswap contracts through `eth_call`: no Uniswap API, no Uniswap SDK (it depends on ethers v5), and **no 1inch**. The numbers on the swap screen are the numbers that execute. (1inch is used only for the balance display, §10.1.)

- **Inputs:**
  - the token to sell (from balances) and the token to buy (from lists, My tokens, or by address)
  - the amount
  - slippage (default **1%**) and deadline (default **24 h**, since signatures take time), both editable
- **Finding a route:** one multicall of quoter calls at the pinned block.
  - **v3:** `QuoterV2` across fee tiers 100, 500, 3,000 and 10,000.
  - **v4:** `V4Quoter` on hookless pools with the standard (fee, tickSpacing) pairs: (100, 1), (500, 10), (3,000, 60), (10,000, 200). Native ETH is `currency0 = address(0)`.
  - Direct routes, plus two-hop routes through the chain's WETH and USDC. **The best output wins**, and the route is shown.
- **Manipulation check (Uniswap TWAP):**
  - For each hop, read the v3 pool's `observe([1800, 0])` and turn it into a 30-minute time-weighted average price (TWAP).
  - If the quote is **more than 2% worse** than the TWAP implies, show an orange warning.
  - If there's no v3 pool or not enough price history (for example v4-only pairs), show "No TWAP check for this route."
- **The Safe transaction:** a batch sent by delegatecall to **MultiSendCallOnly, checked by code hash** (so the §7.4 delegatecall rule allows it):
  1. `token.approve(Permit2, amount)`, only if the current allowance is too low. A nonzero but too-low allowance is first reset to 0, since some tokens (USDT) refuse to change a nonzero allowance.
  2. `Permit2.approve(token, UniversalRouter, uint160 amount, uint48 expiration = deadline)`
  3. `UniversalRouter.execute(commands, inputs, deadline)`, with the **Safe as recipient** and **`amountOutMinimum = quote × (1 − slippage)`**

  Selling ETH needs no approvals, so it's a single plain call to the router with the ETH as value, not a batch.

  Router commands are encoded with viem, following the router's own source (`Dispatcher.sol` at `universal-router@2.2.0` and the `v4-periphery` commit it pins):
  - **v3:** `V3_SWAP_EXACT_IN`, preceded by `WRAP_ETH` (to the router) when selling ETH, and followed by `UNWRAP_WETH` (to the Safe) when buying ETH. Its input is `(recipient, amountIn, amountOutMin, path, payerIsUser, uint256[] minHopPriceX36)`. 2.2.0 added the last field; we pass it **empty**, which the router treats as "no per-hop check". The overall minimum still applies.
  - **v4:** `V4_SWAP` with the actions `SWAP_EXACT_IN` (whose params also gained `minHopPriceX36`, passed empty), `SETTLE_ALL(currencyIn, amountIn)` and `TAKE_ALL(currencyOut, minOut)`. `TAKE_ALL` pays the caller, which is the Safe.
- **Contract addresses:** a bundled per-chain table (Universal Router, Permit2, `QuoterV2`, `V4Quoter`, the v3 factory, WETH, USDC) taken from Uniswap's deployment docs and `deployments.json` feed. Each is checked with `eth_getCode` before use, and the swap is hidden on chains that lack them.
  - **Which Universal Router:** the most recently deployed one, **2.2.0**. (Agreed 2026-09-26.) A router only executes the route it's given; prices come from the quoters, and every router version reaches the same pools, so there's nothing to gain from using two.
    - First block with code: `0x66a9…` 21,689,092 (2025-01-23), 2.1.1 24,680,568 (2026-03-17), 2.1.2 25,999,984 (2026-09-17), **2.2.0 26,006,366 (2026-09-18)**. On Sepolia, 2.2.0 is also the newest (11,732,372, 2026-09-18).
    - Uniswap's docs page doesn't list 2.2.0 yet; the `deployments.json` feed does.
  - **Mainnet:** Universal Router 2.2.0 `0xab863E752Bf67D8DCDD929EaAe9Be9dc83Fb3BbB`, Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`, `QuoterV2` `0x61fFE014bA17989E743c5F6cB21bF9697530B21e`, `V4Quoter` `0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203`, v3 factory `0x1F98431c8aD98523631AE4a59f267346ea31F984`, WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`.
  - **Sepolia:** Universal Router 2.2.0 `0x5093f1CDED83d99FfEd6602dA6260672ae16787c`, Permit2 (same address), `QuoterV2` `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3`, `V4Quoter` `0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227`, v3 factory `0x0227628f3F023bb0B980b67D528571c95c6DaC1c`, WETH `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`, USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.
  - v3 pool addresses for the TWAP check are computed (CREATE2 from the factory), not looked up.
- **Handling the multisig delay:**
  - At review time and again just before executing, get a **fresh quote** and show *current quote vs. the signed minimum*. The review screen finds the swap by decoding the router call (a direct call, or the one router call in a MultiSend batch; only the shapes this app builds) and re-quotes exactly that route every 30 seconds while it's open, so the quote next to Execute is current.
  - If the fresh quote is below the minimum, the level-1 simulation (§7.5) predicts a revert, which shows red.
  - A passed deadline is red: *"This swap expired. Create a new one."*
- **Front-running:** when executing a swap, a hint suggests sending it through a private RPC in the wallet (for example MEV Blocker's).
- **Rendering: our own decoder (agreed 2026-09-26).** The registry has **no descriptor for any Universal Router** (only SwapRouter02 and Permit2's EIP-712), so clear signing can't render swaps.
  - A call to this chain's Universal Router (from the bundled table) is decoded **command by command** by `src/core/uniswap.ts`: `V3_SWAP_EXACT_IN`, `WRAP_ETH`, `UNWRAP_WETH`, `SWEEP`, and `V4_SWAP` with `SWAP_EXACT_IN`, `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL` and `TAKE_ALL`. It shows as level 3, "Decoded (Universal Router 2.2.0, decoded by Plain Safe)", in plain language ("Swap 0.01 ETH for at least 322.75 USDC… to the caller (this Safe)"), with each recipient labeled relative to the Safe.
  - This works anywhere calldata appears: direct calls and calls inside a batch, the review screen, the queue and history summaries, and the Verify page (offline).
  - Any other command or v4 action is listed as "not decoded". A router call that doesn't decode at all falls back to the router's plain ABI.
  - Permit2's `approve` is in the bundled ABIs, so the approval step in a swap batch decodes too.
  - The §7.4 safety rules apply as usual, plus the swap rules there.
- **Checked 2026-09-26:** the v3 and v4 quoters both return quotes over RPC (1 ETH ≈ 2,681.35 and 2,680.64 USDC), single-hop and two-hop, on Mainnet and Sepolia. `test/integration/swap-mainnet.test.ts` runs four swaps built by the app (v3 and v4, buying and selling ETH, with approvals through MultiSendCallOnly) through a real v1.4.1 Safe against Universal Router 2.2.0 with `eth_simulateV1`.

### 3.14 Creating a Safe (P1)

Agreed 2026-09-26. `#/add/new`, a tab on the Add a Safe screen.

1. **The form:** chain (or "Other chain…"), owners (addresses or ENS names; the first is prefilled with the connected wallet), signatures needed, and an optional name for the address book.
   - Owners are checked before anything else: at least one, no duplicates (in any case), no zero address or `0x…01` sentinel, and a threshold from 1 to the number of owners (the Safe's own `GS200`–`GS204`).
2. **Which contracts:** always **v1.4.1**, the canonical deployment, from the bundled safe-deployments table (§4.2):
   - **`Safe` on Mainnet and Sepolia** (the L1 edition), **`SafeL2` on every other chain**. SafeL2 emits an event for each transaction, which indexers rely on there and our history scan uses (§11).
   - `SafeProxyFactory` 1.4.1 with `createProxyWithNonce`, and the 1.4.1 `CompatibilityFallbackHandler`.
   - `setup()` gets the owners, the threshold and the fallback handler; no modules, no guard, no payment.
   - The `saltNonce` is 32 random bytes, drawn once per form, so the same owners can create more than one Safe.
3. **Review, before the wallet sees anything** (`src/core/create-safe.ts`, `features/safes/create-program.ts`):
   - The **new Safe's address is computed in advance** (CREATE2: `salt = keccak256(keccak256(initializer) ‖ saltNonce)`, code = the factory's `proxyCreationCode` ‖ the singleton), and shown in full.
   - The factory, singleton and fallback handler must have **the official code hash** on this chain. Otherwise the review says which one is missing and Create stays disabled.
   - Nothing may exist at the predicted address yet.
   - The factory is `eth_call`ed exactly as the wallet will send it, and must return **the predicted address**.
   - These checks run again right before sending, from the connected account, with a gas estimate.
4. **Sending:** the wallet sends one transaction to the factory (switching chains first if needed). The receipt's `ProxyCreation` event, from the factory, must name the predicted address.
5. **Afterwards:** the new Safe is loaded and checked like any added Safe (§3.2, §4.2), retrying for a few seconds while the RPC catches up with the receipt. Only a **verified** Safe is saved to My Safes (with its name in the address book, if given), and the app opens its overview.

The proxy creation code for each factory is bundled (read from Mainnet by the gen script, §4.2), so the address needs no request. Unit tests predict the addresses of two real Mainnet Safes (one `Safe`, one `SafeL2`) from their creation calls. `test/integration/create-safe-mainnet.test.ts` creates one through `eth_simulateV1` and reads back its owners, threshold and nonce. Checked 2026-09-26 in the browser: a 2-of-3 Safe on a Sepolia fork (verified `Safe` v1.4.1) and on a Base fork (verified `SafeL2` v1.4.1), and a chain without Safe's contracts, which stops at review.

---

## 4. Safe support and authenticity

### 4.1 Versions

- **Supported:** v1.3.0, v1.4.1 and v1.5.0, including the L2 editions, in their canonical, eip155 and zkSync deployments.
- **Versions before 1.3.0** are shown read-only with an "unsupported version" message. They use a different EIP-712 domain (no chainId), and 1.0.0 uses different SafeTx field names.
- **An unknown singleton**, whether a future version or a fake, is shown **read-only, and signing is refused** until an app update adds its hash.
- **Differences between versions that matter to us** (confirmed from source, §4.4):
  - `ExecutionSuccess`/`ExecutionFailure`: `txHash` is **not indexed in v1.3.0** (it's in `data`) but **is indexed in v1.4.1 and later** (`topics[1]`). The event signature, and so `topics[0]`, is the same.
  - v1.5.0 passes the inner call's revert data through instead of `GS013` (§3.8).
  - v1.5.0 moved `GuardManager` ahead of `OwnerManager` in its inheritance, but the guard lives in a fixed keccak slot, so **the storage layout is unchanged** (§4.3).

### 4.2 Authenticity check (works on any chain)

It needs **no per-chain address tables**; everything is checked by code hash.

1. `keccak256(eth_getCode(safe))` must match a known **proxy runtime** code hash (the table below).
2. The singleton address is read from `eth_getStorageAt(safe, 0)`.
3. `keccak256(eth_getCode(singleton))` must match a known **Safe or SafeL2 singleton** code hash from `safe-deployments`. That match **determines the version**. `VERSION()` is shown for information only and flagged if it disagrees.
   - The canonical and eip155 deployments of v1.3.0 share a code hash.
4. The MultiSend, MultiSendCallOnly and SimulateTxAccessor addresses are checked by code hash the same way before being trusted.

**Proxy code hashes.** `safe-deployments` lists a code hash for each *factory*, but not for the *proxies* it creates. So the gen script derives them:
- Call each factory's `proxyCreationCode()`, append an ABI-encoded singleton address, and run that as a contract-creation `eth_call`. The returned runtime code is the proxy's code, which doesn't include the singleton address.
- For v1.0.0–1.3.0 factories, cross-check against `proxyRuntimeCode()`; they matched when checked.
- **Legacy proxies are included.** A Safe created by an old factory and later upgraded in place to v1.3.0+ keeps its old proxy code. Many long-lived treasuries look like this, and they must still pass.

Measured on Mainnet on 2026-09-26:

| Factory version | Proxy runtime size | Proxy code hash |
|---|---|---|
| v1.0.0 | 110 bytes | `0xf8fffcb9b9c73fbc4ffb6dc52f0001fa998951e0d4177894b1b899f7732b6eaf` |
| v1.1.1 | 170 bytes | `0xaea7d4252f6245f301e540cfbee27d3a88de543af8e49c5c62405d5499fab7e5` |
| v1.3.0 | 171 bytes | `0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000` |
| v1.4.1 | 171 bytes | `0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c` |
| v1.5.0 | 123 bytes | `0x4e381985ca68b3e5d27b4425fa581c19cf33146d3f887a3cfca96f55528ea46f` |

zkSync proxies differ; the gen script adds them when zkSync support is tested. An **unrecognized proxy** gets the same treatment as an unknown singleton: read-only, with the reason shown.

The build script, `scripts/gen-safe-deployments.ts`, writes `src/generated/safe-deployments.json`, which holds:
- the singleton, MultiSend, MultiSendCallOnly and SimulateTxAccessor `{contractName, version, variant, codeHash}` sets
- the derived proxy hashes
- each singleton's deploy block on Mainnet and Sepolia (the floor for history, §11)
- the proxy factories (with each Mainnet factory's `proxyCreationCode`) and the compatibility fallback handlers, for creating a Safe (§3.14)

### 4.3 Storage layout (used for simulation overrides, v1.3.0+)

| Slot | Variable |
|---|---|
| 0 | singleton |
| 1 | modules |
| 2 | owners (linked list) |
| 3 | ownerCount |
| 4 | threshold |
| 5 | nonce |
| 6 | (deprecated domain separator) |
| 7 | signedMessages |
| 8 | approvedHashes |

This layout was confirmed from the source of v1.3.0, v1.4.1 and v1.5.0: `Singleton` → `ModuleManager` → `OwnerManager` → the Safe's own variables. `GuardManager`, `FallbackManager` and the module guard (v1.5.0) use fixed keccak slots. Slots 3, 4 and 5 were also read from real Mainnet Safes of each version and matched `getOwners().length`, `getThreshold()` and `nonce()` (§4.4).

### 4.4 Verification record (2026-09-26)

These checks ran against **real Mainnet Safes** over MEV Blocker, one per version: v1.3.0 (ENS Endowment `0x4F20…FE64`), v1.4.1 L2 (`0x27e9…1614`) and v1.5.0 (`0x7b24…C102`). **Every check passed on all three.**

| Check | What it confirms |
|---|---|
| Singleton code hash is in `safe-deployments` | §4.2 authenticity, version from code hash |
| Slots 3, 4 and 5 match `getOwners().length`, `getThreshold()` and `nonce()` | §4.3 layout |
| Manual domain hash = `domainSeparator()` | §5.1 domain |
| Manual formula **and** viem `hashTypedData` = `getTransactionHash()`, including non-empty calldata, delegatecall, non-zero refund fields and a future nonce | §5.1 hashing |
| An EIP-712 signature from a test key (made an owner through a state override) executes in `eth_simulateV1`, and `ExecutionSuccess` carries our safeTxHash | §5.2 encoding (v = 27 or 28) |
| A pre-validated signature (`r` = owner, `s` = 0, `v` = 1) executes when sent **from** that owner with the threshold overridden to 1, and fails when sent from anyone else | §7.5 level-1 simulation recipe |
| Two signatures sorted ascending execute; the same two sorted descending revert with `GS026` | §5.2 ordering |
| A signature over a different safeTxHash reverts with `GS026` | §5.3 rejection |
| A future nonce set by overriding slot 5 executes, and a 1-wei ETH transfer shows up as a `0xEeee…` pseudo-log | §7.5 overrides and `traceTransfers` |
| `simulateAndRevert(SimulateTxAccessor, simulate(…))` through a plain `eth_call` decodes to success with a gas estimate | §7.5 level 2 |

The script behind this table becomes the repo's **`test/integration/safe-mainnet.test.ts`** (§13).

---

## 5. Hashing and signatures

### 5.1 EIP-712 (v1.3.0+)

- **Domain:** `EIP712Domain(uint256 chainId,address verifyingContract)`, with `verifyingContract` set to the Safe proxy.
- **Type:** `SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)`
- **The three hashes shown:**

  | Hash | How it's computed |
  |---|---|
  | **Domain hash** | the domain separator, `hashDomain` |
  | **Message hash** | the SafeTx struct hash, `hashStruct` |
  | **safeTxHash** | `keccak256(0x1901 ‖ domainHash ‖ messageHash)` |

- These are implemented as **pure TS functions** on viem primitives, and tested against published vectors (§13).

### 5.2 Signature encoding

| Kind | Encoding | Scope |
|---|---|---|
| EOA, EIP-712 | `r ‖ s ‖ v`, with v ∈ {27, 28} (65 bytes) | P0 |
| Pre-validated (the sender is an owner) | `r = owner (left-padded to 32 bytes) ‖ s = 0 ‖ v = 1` | P0 (at execute time) |
| approveHash (onchain) | same as pre-validated; valid if `approvedHashes(owner, hash) != 0` | P1 |
| Contract (EIP-1271, v = 0) | — | Out |
| `eth_sign` (v + 4) | — | Out |

Signatures are concatenated in **ascending order of owner address**.

### 5.3 Validating signatures on import

For each signature:

1. Recover the signer against the **recomputed** safeTxHash. If the claimed `signer` doesn't match, reject it: "belongs to a different transaction or is corrupted."
2. The signer must be in `getOwners()` at the pinned block. If not, keep it but show it as "not an owner (ignored)."
3. Duplicates are dropped.
4. **Validity is re-evaluated live**, so if the owners change, the counts update.

---

## 6. Package format (v1)

```jsonc
{
  "type": "plainsafe/safe-tx",
  "version": 1,
  "chainId": 1,
  "safe": "0x…",               // checksummed
  "safeVersion": "1.4.1",       // claimed; checked against the code hash onchain
  "tx": {
    "to": "0x…",
    "value": "0",               // decimal strings for every uint256
    "data": "0x…",
    "operation": 0,
    "safeTxGas": "0",
    "baseGas": "0",
    "gasPrice": "0",
    "gasToken": "0x0000000000000000000000000000000000000000",
    "refundReceiver": "0x0000000000000000000000000000000000000000",
    "nonce": "42"
  },
  "hashes": {                    // for humans; ALWAYS recomputed, and the package is rejected on mismatch
    "domain": "0x…",
    "message": "0x…",
    "safeTx": "0x…"
  },
  "signatures": [
    { "signer": "0x…", "kind": "eip712", "data": "0x…(65 bytes)" }
    // P1: { "signer": "0x…", "kind": "approvedHash" }, verified onchain
  ],
  "note": "Pay March invoice",   // optional; ALWAYS shown as "Proposer's note (unverified)"
  "createdAt": "2026-09-26T03:00:00Z"
}
```

- The package **never carries address labels**. Labels come only from the local address book, so an attacker can't send a package that labels their own address "Treasury."
- **No encryption.** The transaction becomes public onchain anyway, and tampering is caught by recomputing the hashes and checking signatures.
- **Schema:** `src/schemas/package.ts` (Effect Schema). The version field allows the format to evolve.

---

## 7. Rendering transactions and review rules

### 7.1 How data is rendered, and how much to trust it

The renderer tries each source in order and shows the first that resolves, with a badge:

| Level | Source | Badge |
|---|---|---|
| 1 | ERC-7730 descriptor **with a valid attestation from a trusted auditor** (**not built yet**, see §7.2) | Clear signing ✓ reviewed |
| 2 | ERC-7730 descriptor with no attestation, or one the user imported | Clear signing, not reviewed |
| 3 | Known ABI (bundled, user library, or Sourcify when enabled), or Plain Safe's own Universal Router decoder (§3.13) | Decoded |
| 4 | Signature database match only (Sourcify's signature API, when enabled) | Guessed (possible selector collision) |
| 5 | Nothing | **Unverified: raw calldata** |

- **The bundled ABIs** (`src/core/known-abis.ts`): ERC-20, ERC-721, ERC-1155, WETH, the Safe's own management functions, Permit2, and **ENS** (added 2026-09-26): the registry, resolver record setters (any resolver implements them), the reverse registrar, the .eth registrar controllers (2023 and 2025), and the NameWrapper. The ENS signatures are checked in a unit test against the Mainnet contracts verified on Sourcify.
  - Like ERC-20's, they're matched by selector on any contract. Where the target's bytecode is known (review), a function is used only if its selector is in it (§7.3).
- **Calls inside a multicall:** `multicall(bytes[])` and `multicallWithNodeCheck(bytes32,bytes[])` (OpenZeppelin's and ENS resolvers' Multicallable) call their own contract once per element. Each element is decoded with the same ABIs and the same bytecode check, and shown as "Its calls" under the function; a multicall inside a multicall is decoded one level deep, no further.

The same renderer is used everywhere calldata appears: builder preview, review, queue, history, and the Verify page.

### 7.2 Clear signing (ERC-7730)

- **Library:** [`@ethereum-sourcify/clear-signing`](https://github.com/sourcifyeth/clear-signing): MIT, pure formatting, depends only on `@noble/*`.
- **Descriptors come from [ethereum/clear-signing-erc7730-registry](https://github.com/ethereum/clear-signing-erc7730-registry), pinned to one commit, in three tiers:**
  1. **Bundled, about 95 KB:** Safe's own descriptors and attestations (7 KB gzipped). `scripts/gen-clear-signing.ts` copies them into `src/generated/clear-signing/`, where they're lazily loaded chunks.
     - Plain ERC-20 and ERC-721 calls to tokens in your lists render through the library's **built-in templates** (`trustedTokens`), so they need no registry files at all.
  2. **Manifest, about 75 KB (26 KB gzipped):** for *every* other registry file (descriptors, attestations and the two index files), the path and SHA-256 at the pinned commit.
  3. **Fetched on demand when the capability is on** (§8.2): when a call has no bundled descriptor but the manifest lists one, the app fetches `raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/<commit>/<path>` and **drops it unless its SHA-256 matches the manifest**. GitHub can't change what we render; the worst it can do is not serve the file. Verified files are cached in IndexedDB (a rebuildable cache, §9.5).
  - **Sizes at registry commit `7378786`:** 1.05 MB of descriptors in 399 files, 322 KB of attestations in 174 files, and 236 KB of index files. Leaving them out keeps the default bundle small.
  - The registry commit is shown in About. **A pinned commit also guards against registry poisoning:** a new descriptor only reaches users through a release.
- **User-imported descriptors:** drop in a JSON file. It's stored locally and labeled "user-supplied" (level 2).
- **Resolver:** a custom `DescriptorResolver` over the bundled files, the hash-verified downloads and user descriptors. **The library's default GitHub resolver is never used**, and `netguard` would block it anyway.
  - **A call from a Safe to itself** has `to` set to the proxy. The resolver maps it to the Safe descriptor for the **code-hash-verified** version, on any chain. (Registry descriptors are tied to singleton addresses on only 7 chains.)
- **Rendering order:**
  1. `formatTypedData` on the full SafeTx, using the registry's `eip712-Safe-<version>` descriptors (not attested). They also render the inner call.
  2. If that doesn't resolve, `format()` on the inner call `{chainId, to, value, data}`.
  3. Then ABI decoding (§7.3).
- **`ExternalDataProvider`:**
  - `resolveToken`: token lists first; otherwise read over RPC and mark "not in your lists."
  - `resolveLocalName`: the address book.
  - `resolveEnsName`: ENS over RPC with `ccipRead: false` (P1).
  - `chainClient`: the Mainnet RPC, for the ERC-8176 revocation check once attestations are checked.
- **`trustedTokens`:** built from the enabled token lists and My tokens, so plain ERC-20 and ERC-721 calls render for listed tokens.
- **Attestations (ERC-8176): not checked in this version (agreed 2026-09-26).** Every descriptor shows as level 2, "Clear signing, not reviewed", so nothing can show "reviewed" that isn't.
  - Why it can wait: at the pinned commit, none of the descriptors a Safe transaction uses is attested (see coverage below). The attested descriptors that could apply are SafeMigration 1.4.1 and 1.5.0 only.
  - The trusted-auditor list already exists in settings. It defaults to the auditor in the registry's `auditors/` folder (`eip155-1-0x3846c3A30E62075Fa916216b35EF04B8F53931f6`), is editable in Settings, and says attestations aren't checked yet.
  - **Later:** verify each attestation's signature against a trusted auditor's key, plus the ERC-8176 revocation check over the Mainnet RPC (`chainClient`). With no Mainnet RPC configured, the badge would read "reviewed (revocation not checked)."
- **Registry coverage for Safe** (as of 2026-09-23): calldata descriptors exist for Safe and SafeL2 1.3.0, 1.4.1 and 1.5.0 (`execTransaction`, owner management, `approveHash`), and EIP-712 descriptors for the SafeTx of each version, but **none of them is attested**. The attested `eip712-Safe-Multisig` descriptor belongs to **Ledger Multisig** (its domain is "Ledger Multisig"; it covers messages like `DeleteRequest` and `Delegate`), not to the SafeTx.
- **Owner-change calls always use our own ABI decoding** and before → after view, whatever a descriptor says.
- **Plan B if the library breaks:** the library is at v0.2.2. If it fails, we lose levels 1 and 2 and fall back to level 3. The flow keeps working.

### 7.3 whatsabi (anywhere calldata or ABIs appear)

whatsabi (MIT, one dependency: `ox`) is used in the builder, the review screen, before execution, the queue, and the Verify page (the last only when an RPC is available).

- **Checks that need only the RPC** (shown on the review screen):
  - "Target has no code (an EOA)" when `data ≠ 0x`.
  - "Function `0x…` is not in the target's bytecode," from `selectorsFromBytecode` with proxies followed.
  - "Target is an upgradeable proxy → implementation `0x…`."
- **Following proxies** to the implementation, so Sourcify (when enabled) returns the implementation's ABI.
  - **A proxy pattern whatsabi can't follow** leaves it at the target with no selectors at all (whatsabi 0.29). The Safe ProxyFactory is one: its bytecode embeds GnosisSafeProxy's creation code, and its slot 0 is empty. Without a fallback, every call to it would count as "not in the bytecode" and be filtered out, even with Sourcify's verified ABI.
  - So when whatsabi returns no function selectors, they're read from the jump table of the contract it stopped at (`selectorsFromBytecode` on that contract's own code). A target whatsabi stayed at is not reported as a proxy.
- **Opt-in lookups:** whatsabi's own Sourcify ABI loader and signature lookups are enabled **only** when the matching capability is on. Otherwise `abiLoader: false` and signature lookup is off. (Check the option names against the installed version.)
- **Contract-call builder:** list the functions from the ABI when known. Otherwise list the bare selectors found in the bytecode, and offer "paste ABI" or raw calldata.
- **ABI library, tied to code rather than addresses** (so upgrades can't leave a stale ABI in use):
  - A pasted ABI is saved under **`chainId:implementationCodeHash`**, where the implementation is found by whatsabi following proxies and the hash is `keccak256(eth_getCode(implementation))`. The implementation address and a label are stored for display.
  - When rendering, a saved ABI is used **only if the target's *current* implementation code hash matches**. If the proxy was upgraded, the ABI isn't used, and the app says *"This contract was upgraded since you saved its ABI."* This also catches contracts replaced in place at the same address (redeployed with CREATE2 after self-destructing).
  - Only functions whose selectors appear in the current bytecode are used for decoding.
  - **Sourcify ABIs are never saved.** They live only in the in-memory query cache, keyed by implementation code hash.

### 7.4 Safety rules

These are computed from the decoded transaction and **never from descriptor text**:

| Rule | Severity | Behavior |
|---|---|---|
| `operation = 1` (delegatecall) to anything other than a MultiSend or MultiSendCallOnly verified by code hash | 🔴 Red | "DELEGATECALL to an unknown contract can take over this Safe." You must type a confirmation before signing. |
| Changes owners, threshold, modules, guard or fallback handler | 🟠 Orange | A before → after view of owners and threshold |
| Calldata that can't be decoded | 🟡 Yellow | "Unverified: raw calldata"; the button reads **Sign unverified transaction** |
| Non-zero `gasPrice`, a `gasToken`, or a `refundReceiver` | 🟡 Yellow | Explains how gas refunds can drain funds |
| `nonce ≠ onchainNonce` | ℹ️ Info | Explains that this will replace or wait behind other transactions |
| whatsabi: target has no code but calldata is present; selector not in bytecode | 🟡 Yellow | See §7.3 |
| Unknown or unsupported singleton | 🔴 Red | Signing refused (§4.1) |
| Universal Router: a command sends its output to an address other than this Safe (the Safe, `MSG_SENDER` and the router itself for a following command are fine) | 🔴 Red | "Swap output goes to another address" |
| Universal Router: a command leaves its output in the router and no later command collects it | 🔴 Red | "Leaves tokens in the router": whoever calls the router next can take them |
| Universal Router: commands or v4 actions the decoder doesn't read, or a v4 pool with hooks or a non-standard tick spacing | 🟡 Yellow | "Router commands Plain Safe does not decode" |

### 7.5 Simulation

Everything runs over RPC, with no third-party simulators.

| Level | Method | Result |
|---|---|---|
| **1** | `eth_simulateV1` (viem `simulateBlocks`) on the **real `execTransaction`**, with **state overrides** on the Safe: threshold (slot 4) set to 1, nonce (slot 5) set to `tx.nonce`. It's sent `from` one current owner with a **pre-validated signature**, using `validation: false` and `traceTransfers: true`. | Success or revert with its reason, gas, decoded events, and **balance changes**: ERC-20 `Transfer`, ERC-721 `Transfer`, ERC-1155 `TransferSingle`/`TransferBatch`, and native ETH via `traceTransfers` pseudo-logs at `0xEeee…EEeE`, netted per token for the Safe. Works **before anyone signs**, including for delegatecall and MultiSend. |
| **2** | Safe's `simulateAndRevert(SimulateTxAccessor, simulate(to, value, data, operation))` via a plain `eth_call`. The accessor is checked by code hash. | Success or revert plus gas. No balance changes. |
| **3** | None | A warning, never an error |

**Before execution** there is also `eth_estimateGas` on `execTransaction` with the real signatures, with `GSxxx` codes translated (§3.8).

**Detecting support:**
- Probe with a trivial `eth_simulateV1` call when the user presses **Test** in setup, or otherwise the first time it's needed.
- Remember the result for each RPC URL **in memory, for the session**. It isn't stored: a provider can change what it supports, and one probe per session is cheap.
- "Method not found," "not allowed" or "not whitelisted" means **unsupported**.
- Rate limits, timeouts or odd responses are **temporary**: retry with backoff, and in the meantime fall back to the next level for this request.

**Display rules:**
- A simulation that succeeds is green, with balance changes, labeled "as of block N."
- A simulation that can't run is a **yellow warning**: "Your RPC can't simulate transactions." It is never red.
- **Red only** when a simulation ran and predicts failure. The decoded reason is shown and the button changes to "Sign anyway."

**Support measured on 2026-09-23:** publicnode (Mainnet and Sepolia), drpc, 1rpc, MEV Blocker and evm.stupidtech.net all support `eth_simulateV1`. Flashbots Protect and cloudflare-eth don't. `debug_traceCall` is rare, so it isn't used.

---

## 8. Network policy

### 8.1 `netguard`

- `src/netguard/`: about 100 lines of plain TypeScript, **imported first in `main.tsx`** before any other module runs.
- It wraps `window.fetch`, `WebSocket`, `XMLHttpRequest` and `navigator.sendBeacon`, and the guard itself stays framework-free.
- **Every worker the app starts installs `netguard` first** (for example the history worker, §11). The main thread passes it the allowlist, and the worker forwards its log entries back, so there is one network log.
- **The allowlist** is computed from settings: each chain's RPC origins, plus hosts for enabled capabilities, plus the app's own origin (for lazy chunks and descriptors).
- **Every attempt is logged:** time, host, path, JSON-RPC method (parsed from the body, including batches), which part of the app made it (a tag given to each viem client or fetch wrapper when it's created, for example `balances`, `swap` or `ccip-read`; browsers have no async context to carry it through query functions), and the outcome (**allowed**, **blocked**, or **failed**).
- **The log** is an in-memory ring buffer (for example, the last 1,000 entries) exposed to React through `useSyncExternalStore`. It powers the **Network log** drawer and a header indicator that turns red if anything was blocked.
  - **The drawer groups requests by host** (agreed 2026-09-26). Each host says why it's allowed, from your settings ("Your Ethereum RPC", "Sourcify, from Network access", a token list host you allowed), or why it was blocked ("Signature database is off in Network access", "not in the allowlist"). Hosts with blocked requests come first. Under each host, its requests are listed newest first, with plain words for the tag and the JSON-RPC calls. Your RPCs that haven't been contacted yet are shown greyed out.
- **CSP meta tag** in production builds, as defence in depth:

  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; connect-src https: wss: http://localhost:* http://127.0.0.1:*;
  frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
  ```

  With no token logos, `img-src` is `'self' data:`. `connect-src https: wss:` is broad on purpose: RPCs are user-defined, and `netguard` enforces the real allowlist. Plain `http:` is allowed only for `localhost` and `127.0.0.1`, matching setup, which accepts `http://` only for a local node. **Check that MetaMask and Rabby still inject under this CSP**; they should, as MV3 main-world scripts.
- **`netguard` is our own code, not a library.** It's small, has no dependencies, and must run before everything else, so we write it.

### 8.2 Opt-in capabilities (all off by default)

| Capability | Contacts | Used for |
|---|---|---|
| Token lists by URL or ENS | the list's host; for a `.eth` name, `<name>.limo` (eth.limo serves the name's contenthash: `tokenlist.aave.eth` → `https://tokenlist.aave.eth.limo/`) | importing a Uniswap-standard list by URL or ENS name (paste or upload needs nothing). Plain Safe asks before contacting the host: fetch once, or always allow it |
| Clear-signing descriptors | `raw.githubusercontent.com` (the pinned registry commit only) | descriptors for protocols beyond Safe, each checked against the bundled SHA-256 manifest (§7.2) |
| Sourcify | `sourcify.dev` | ABIs and verified contract names (level 3) |
| Signature database | `api.4byte.sourcify.dev` (Sourcify's signature API, which includes 4byte's data) | guessed function names (level 4) |
| **ENS off-chain lookups (CCIP-read)** | **whichever gateway a name's resolver points to** | names stored off-chain (for example `*.cb.id`, `*.uni.eth`) |

- **How CCIP-read works without listing gateways.** Gateway hosts come from each resolver's `OffchainLookup` revert, so they can't be known ahead of time.
  - The viem client is created with `ccipRead: { request }`, a custom function. It sends the gateway call through `netguard` with the tag `ccip-read`.
  - When the capability is on, `netguard` allows **any `https:` host for `ccip-read`-tagged requests only**. Every gateway call still appears in the network log with its host.
  - When it's off, the custom function returns an error immediately, so no request is attempted and the name shows as "off-chain name (CCIP-read disabled)."
  - Other parts of the app can't use this exception, because the tag is only set inside that one function.
- **Removed:** token logos. A `logoURI` could point anywhere and would reveal the user's IP to each host, which isn't worth it. Balances show a monogram.
- **Not included:** refreshing the clear-signing registry from GitHub, and WalletConnect.
- **The UI:** a toggle for each row in Settings → Network access, showing the exact host (or "any gateway a name points to" for CCIP-read). When a feature needs a disabled capability, it asks in place: *"This list is at `tokens.uniswap.org`. Fetch it once, or always allow?"*

### 8.3 Wallet connection

- wagmi with an `injected` connector and **EIP-6963 discovery** (`multiInjectedProviderDiscovery: true`), and nothing else: no RainbowKit, no WalletConnect, no Coinbase SDK.
- A roughly 50-line connect menu lists the wallets it discovers.
- Once connected, the menu shows the wallet's **ENS primary name** next to its shortened address (§8.5), looked up for the chain the wallet is on, like names for a Safe's chain.
- wagmi is used **only for the wallet**: connecting, reading the account and chain, switching or adding chains, `signTypedData`, and sending `execTransaction`. **Every read goes through our own query hooks** (§9.3).
- wagmi's config sets **`storage: null`**. Its default storage is `localStorage`, which §9.5 rules out, so the wallet connection isn't remembered across reloads: the user reconnects with one click.
- wagmi's chain list comes from settings. The config is rebuilt when chains are added or removed.

### 8.4 RPCs

- **Mainnet default: MEV Blocker** (`https://rpc.mevblocker.io`), as in §3.1.
  - **Checked on 2026-09-24:**
    - CORS works (it echoes the request's Origin and answers the preflight), and batched requests work.
    - `eth_simulateV1` and state overrides work.
    - Every read Plain Safe uses works: `eth_getCode`, `eth_getStorageAt`, `eth_call` and `eth_getBalance` at a pinned block, `eth_estimateGas`, transaction and receipt lookups, the `finalized` block tag, and fee history.
    - Historical logs are complete, in ranges up to 1M blocks, **including pre-Merge**.
    - In a burst test, 120 requests from 12 parallel connections got no 429s (1 timeout).
  - **Risk:** MEV Blocker is a transaction-protection service first. **Its read support, rate limits, logging and terms aren't documented**, so they could change without notice. See §17.
    - **Seen while building:** a burst of reads (the deploy-block search in `scripts/gen-safe-deployments.ts`) got a temporary Cloudflare 1015 rate-limit ban. The script now paces its requests. The app batches each view's reads into one HTTP request (§8.4), which stayed well within the limit in testing.
  - Plain Safe never sends transactions through this RPC; the wallet sends them. So MEV Blocker's protection features don't apply here, only its reads.
- **Every other chain, including Sepolia: evm.stupidtech.net** (`https://evm.stupidtech.net/v1/<chainId>`).
  - It works for any chain on Chainlist, and allows browser requests (`access-control-allow-origin: *`).
  - It supports `eth_simulateV1` and historical logs, **but** each request is raced across 5 random public upstreams, so results aren't deterministic, and some errors come from dead upstreams (tested 2026-09-24). Its limit is 60 requests per minute per IP.
  - **How we handle that:**
    - Reads at a pinned block (below).
    - Retry each error up to 2 times before showing it, since a different upstream may answer.
    - Treat odd errors during capability probing as temporary, not "unsupported."
    - Batch reads with multicall to stay under the rate limit.
- **Use your own RPC:** the setup screen and Settings recommend it for every chain (§3.1). The defaults exist so the app works on first run, not because they're the best choice.
- **publicnode** is no longer a default. It stays on the list of RPCs we tested (§7.5, §11).
- **Consistent reads:** every safety-relevant read for a view is made at **one pinned block number**, using multicall (Multicall3) where possible. The simulation uses the same block. This keeps racing or load-balanced RPCs from mixing state from different blocks.
  - **Keep pins recent:** re-pin to the latest block on every refetch, and never read at a pinned block more than about 100 blocks old. Full nodes prune old state; geth keeps about 128 blocks by default. **No P0 feature needs archive state.**
  - **Views that load together share a pin:** a pin asked for within 1 second of another on the same chain reuses it, so a Safe and its balances are read at the same block with one `eth_blockNumber`.
- **Batching across the app:** viem queues calls per RPC URL for 10 ms and sends them as one JSON-RPC batch, whichever part of the app made them. Parts of a page that don't depend on each other start together so they share batches (the Safe overview and the builder start balances alongside the Safe itself, and the price-oracle check rides in the balances batch). A screen that needs a current Safe re-reads it on entry unless the last read is under 5 seconds old, so moving from one screen to the next doesn't read the same Safe twice. whatsabi reuses contract code already fetched, so no address's code is read twice in one inspection. Loading a Safe's overview takes **4 requests**; each waits on the one before (block → Safe and balances → singleton code and prices → owner names). Each batch is logged with every part that contributed to it (§8.1), e.g. "ENS names + Prices + Safe + Swap".
- **Multicall:** no hardcoded address. The app uses viem's `multicall`:
  - Chains known to `viem/chains` carry their own `contracts.multicall3`.
  - For any other chain, the app passes **`deployless: true`**, which runs Multicall3's bytecode inside an `eth_call` without needing a deployed contract.
- **Errors:** show the endpoint and error, with a retry button. **Never silently fall back to a different RPC.**

### 8.5 ENS names (P0)

- **Which registry:**
  - Mainnet and all other chains resolve against **Ethereum Mainnet ENS** through the Mainnet RPC, since ENS lives on L1.
  - Sepolia Safes resolve against **Sepolia ENS**.
  - Both use the Universal Resolver from viem's chain definitions.
  - If the needed RPC isn't configured, ENS is off and addresses are shown as addresses.
- **Name → address (inputs):**
  - Names are normalized with viem's `normalize` (ENSIP-15). A name that fails normalization is rejected.
  - Resolution uses `getEnsAddress({ name, coinType })` for **the Safe's chain** (ENSIP-9/11/19). A name with no address for that chain is an error; it never silently falls back to the Mainnet address.
    - `coinType` is **60 (the ETH address record) when the Safe is on the registry's own chain**, Mainnet or Sepolia, and `toCoinType(safeChainId)` otherwise. On Sepolia ENS, names keep their Sepolia address in the ETH record, so `toCoinType(11155111)` would find nothing.
  - A typed name is resolved only after it has stopped changing for **400 ms**, so typing `vitalik.eth` makes one lookup, not one per keystroke (`vitalik.et` already looks like a name). Until then the field shows as pending, never an earlier spelling's address. Pasted `0x` addresses need no lookup and apply at once.
  - The resolved address is shown prominently, and the SafeTx stores **the address, never the name**.
- **Address → name (display):**
  - `getEnsName({ address, coinType })`. The Universal Resolver only returns a name whose forward lookup points back to the same address.
  - **A name is always shown next to the shortened address, never alone,** so a look-alike name can't hide a different address.
- **CCIP-read:** off by default; turned on with one toggle (§8.2).
- **Packages never carry ENS names.** Each signer's app resolves names itself.
- **Caching:** query key `['ens', chainId, address]` with a staleness time of a few minutes.

---

## 9. Architecture

### 9.1 Stack

| Concern | Choice |
|---|---|
| Build | Vite + React + TypeScript (static SPA, `base: './'`) |
| Package manager and scripts | Bun (`bun.lock` committed, `--frozen-lockfile` in CI) |
| Formatting and linting | Biome |
| Routing | wouter with hash routing (`useHashLocation`) |
| Server state | TanStack Query (also required by wagmi) |
| Chain access | viem (all reads), wagmi (wallet only) |
| Domain logic | Effect (§9.2) and Effect Schema |
| UI | Tailwind v4 + shadcn/ui (Radix), lucide icons, system fonts |
| Calldata and ABIs | whatsabi |
| Clear signing | `@ethereum-sourcify/clear-signing` with a bundled registry copy |
| Tests | Vitest |
| Storage | IndexedDB through `idb`, behind the Effect `Storage` service; no `localStorage` (§9.5) |
| History (P1) | Our own backwards log scanner in a dedicated Web Worker, stored in IndexedDB (§11) |

### 9.2 Layers

```
main.tsx
  └─ netguard (installed first; plain TS)
components (React, shadcn)          ← no Effect, no direct viem calls
  └─ query hooks (TanStack Query)   ← the only way the app reads data
       └─ runtime.runPromise(program)
            └─ Effect programs (ABI, descriptors, token lists, simulation, …) over services (Rpc, Storage)
                 └─ viem / whatsabi / clear-signing   → fetch → netguard
wallet actions (wagmi hooks)        ← connect, switch chain, sign, execute
core/ (plain TS, pure)              ← hashing, signature encoding, package codec, safety rules, balance-change parsing
```

**How Effect is used:**
- **Effect Schema** decodes *all* untrusted input and saved state: packages, link payloads, token lists, user ABIs, descriptors, backup files, and every stored record (§9.5).
- **Effect programs** cover the steps where failures must be told apart, because the UI shows each one differently:
  - loading and verifying a Safe
  - importing, validating and merging packages
  - the simulation fallback levels
  - checking what an RPC supports
  - loading token lists
  - the ABI fallback chain
- **Services** are provided with `Context.Tag` and `Layer`: `Rpc` (a viem PublicClient per chain from settings) and `Storage`. There is **one `ManagedRuntime`**.
  - ABI lookup, descriptors, token lists and simulation are **Effect programs over those two services**, not services of their own: each is a function that needs only `Rpc` and `Storage`, so tests provide those two layers and nothing else.
- **Error types** (`Data.TaggedError`):
  - Setup and loading: `RpcError`, `NotAContract`, `UnknownSingleton`, `UnsupportedVersion`, `WrongChain`
  - Packages: `PackageDecodeError`, `HashMismatch`, `WrongSafe`, `SignatureInvalid`, `SignerNotOwner`, `StaleNonce`
  - Simulation: `SimulationUnavailable`, `SimulationReverted`
  - Network: `BlockedByNetguard`
  - Storage: `StorageError` (IndexedDB unavailable or failing) and `InvalidRecord` (a stored record that fails its schema, set aside and reported)
- **Not Effect:**
  - pure functions in `core/`, which stay plain TS and are trivially testable
  - React components
  - `netguard`
  - wagmi wallet actions
- **Guardrail, the only Effect APIs used** (checked 2026-09-30 against the installed `effect` 3.22.2: each is stable, none deprecated or experimental). Anything outside this list is agreed first.
  - Programs: `Effect.gen`, `succeed`, `fail`, `sync`, `suspend`, `promise`, `tryPromise`, `map`, `flatMap`, `as`, `all`, `forEach`, `either`, `mapError`, `tapError`, `catchTag`, `catchIf`, `orElseSucceed`, and `Effect.retry` with `Schedule` (`exponential`, `spaced`, `union`)
  - Errors: `Data.TaggedError`
  - Services and running: `Context.Tag`, `Layer.succeed`/`mergeAll`, the one `ManagedRuntime` (the history worker can't share it, so it uses `Effect.runPromise` with `Effect.provide`), and `Exit`/`Cause.squash` to rethrow a program's tagged error
  - Data: `Schema` (with `ParseResult.TreeFormatter` for error text), `Either`, `Option`
  - Not used: fibers, streams, scopes, refs, queues, `Match` and the rest.
  - Check Effect's APIs against its docs (Context7 when available; it wasn't in the build environment) and the installed package's types and source.
- **If Effect slows things down,** pull back to Schema only, with programs as async functions that return tagged-error unions.

### 9.3 Query key convention

All keys come from one factory, `src/queries/keys.ts`:

```ts
['rpc-caps', rpcUrl]
['safe', chainId, address, blockNumber?]
['balances', chainId, safe, tokenSetHash]
['whatsabi', chainId, address]
['sourcify', chainId, implementationCodeHash]
['render', chainId, safeTxHash]
['approvals', chainId, safe, safeTxHash, blockNumber]
['simulation', chainId, safeTxHash, blockNumber]
['queue-simulation', chainId, safe, blockNumber, ...safeTxHashes]
['eth-fiat', 1, currency]
['token-meta', chainId, token]
['ens', chainId, address]
['ens-resolve', chainId, name]     // a typed name resolved for an address field (§8.5)
['swap-contracts', chainId]
['safe-creation', chainId, predictedAddress, from]
['swap-quote', chainId, sell, buy, amountIn]
['requote', chainId, route, amountIn]
['swap-build', chainId, safe, plan]
['signatures', selector]
['history', chainId, safe, 'checkpoint' | 'events']
['history', 'all']                  // every Safe's checkpoint (Settings → Onchain history)
['history-tx', chainId, txHash]      // the transaction that ran an execution (§11)
['executed-signers', safeTxHash, signatures]   // pure: signers recovered from an execution
['share-payload', safeTxHash, signers]         // pure: a package's link payload
['import', payload]                            // pure: a shared link, decoded and verified offline
['clear-signing-bundle']                       // the bundled registry's pinned commit
['user', …]                       // user data read from IndexedDB: settings, safes, packages, lists, …
```

Chain-state keys put the chain ID second. Changing a chain's RPC or a capability invalidates every key for that chain.

### 9.4 Directory layout

```
src/
  main.tsx                 # installs netguard, then renders <App/>
  netguard/                # guard, allowlist, log store
  storage/                 # the only code allowed to touch indexedDB (§9.5): DB schema, migrations, Storage service
  core/                    # pure: eip712, signatures, package codec, safety rules, balance diffs, GS error table
  effect/                  # services, layers, errors, runtime
  schemas/                 # Effect Schema: package, tokenlist, settings, backup, descriptor, abi
  queries/                 # React Query hooks + keys
  wallet/                  # wagmi config (injected + EIP-6963), connect menu, sign/execute hooks
  features/
    setup/  safes/  builder/  review/  share/  queue/  verify/
    balances/  settings/  network-log/
    history/               # local history now; history.worker.ts + scanner later (§11)
  components/ui/           # shadcn
  generated/               # safe-deployments code hashes, clear-signing copy, bundled ABIs, default token list
scripts/
  gen-safe-deployments.ts
  gen-clear-signing.ts
  compute-cid.ts           # P1 (§12)
test/
  integration/safe-mainnet.test.ts   # §4.4 checks against real Safes (needs a Mainnet RPC)
bunfig.toml                # minimumReleaseAge (§16)
docs/
  planning/                # grilling transcript and other planning artifacts
```

#### Screens and routes

Routing is wouter with hash routing (`useHashLocation`), so every route lives after the `#` and is never sent to a server or gateway. `:chainId` is a decimal chain ID; `:address` is a 0x address (any case accepted, shown checksummed). An invalid parameter shows a "Not found" screen with a link home.

| Route | Screen | Spec | Before setup |
|---|---|---|---|
| *(path starts with `/ipfs/` or `/ipns/`)* | **Gateway refusal.** Not a route: `main.tsx` renders it before netguard, storage or the router run (`index.html` preloads the app's code, §12, but it never runs there) | §12 | shown |
| *(while the app loads)* | **Splash.** Not a route: `index.html` shows the header bar, and "Loading…" if loading takes a moment, so a slow load is never a blank page. Inline markup and styles only, so no requests. `app.tsx` removes it once settings have loaded | — | shown |
| `#/setup` | First-run setup: RPCs, Test, "use my wallet's RPC", remove or add chains (at least one), optional network access | §3.1 | shown |
| `#/` | Home: **My Safes** and **Recent**, with "Add a Safe" | §3.2, §3.7 | → setup |
| `#/add` | Add a Safe: chain (or a custom chain ID), address, pinned-block read, authenticity result, owner labels. Tabs: **Existing Safe** and **New Safe** | §3.1, §3.2 | → setup |
| `#/add/new` | Create a Safe: chain, owners, threshold, name; review with the predicted address and contract checks; then the wallet sends it | §3.14 | → setup |
| `#/safe/:chainId/:address` | Safe overview: identity and authenticity badge, owners, threshold, nonce, balances and fiat | §3.2, §10 | → setup |
| `#/safe/:chainId/:address/queue` | Queue, grouped by nonce, with states | §3.9 | → setup |
| `#/safe/:chainId/:address/history` | Local history (onchain history joins it in P1) | §3.9, §11 | → setup |
| `#/safe/:chainId/:address/new` | Builder: pick a preset | §3.3 | → setup |
| `#/safe/:chainId/:address/new/:preset` | Builder form; `:preset` is `eth`, `erc20`, `call`, `owners` or `swap` (P1, only where Uniswap is deployed) | §3.3, §3.13 | → setup |
| `#/safe/:chainId/:address/review` | Review of the builder's **unsaved draft** (held in memory; a reload returns to the builder) | §3.4 | → setup |
| `#/safe/:chainId/:address/tx/:safeTxHash` | Review of a **stored package**: Sign, Execute, and the Share panel | §3.4–§3.8 | → setup |
| `#/import` | Paste a link, `plainsafe:1:` code or JSON, or drop a `.json` file | §3.7 | shown |
| `#/import/:payload` | Opening a shared link: offline decode and hash check first, then setup if needed, then the chain checks; saving it moves to `tx/:safeTxHash` | §3.6, §3.7 | shown (offline part) |
| `#/verify` | Verify page: hashes with no wallet and no RPC; optional "Check against chain" | §3.10 | shown |
| `#/settings` | Settings index | §3.12 | → setup |
| `#/settings/:section` | `rpcs`, `network`, `log`, `tokens`, `addressbook`, `clear-signing`, `abis`, `currency`, `backup`, `about` (P1: `history`) | §3.12 | → setup |
| `#/safe/:chainId/:address/swap` | Swap (P1): the builder with the `swap` preset, linked from the Safe overview | §3.13 | → setup |

- **Before setup is done**, any route marked "→ setup" redirects to `#/setup`. The target is remembered in memory, and **Continue** returns to it (otherwise to `#/add`).
- **Overlays, not routes:** the network log drawer (from the header indicator), the wallet connect menu, the Share panel on the review screen, and the typed delegatecall confirmation.
- **The header** on every screen except the gateway refusal: app name (home link), the network indicator (red if anything was blocked), the connect menu, and Settings.

### 9.5 Storage: where each kind of data lives

**The rule:** anything that must survive a reload goes in **IndexedDB, through the `Storage` service**. **`localStorage` and `sessionStorage` are not used at all.** Which kind of data something is decides whether it's persisted and whether it's backed up:

| Kind of data | Where | In Back up? | Examples |
|---|---|---|---|
| **Chain state**: anything re-readable from the chain | React Query **memory** cache only, never persisted | — | owners, threshold, nonce, balances, prices, swap quotes, simulations, ENS names |
| **User data**: anything the user created, imported or chose | **IndexedDB** | **Yes** | settings (including setup done), Safes and Recent, packages, token lists, My tokens, address book, imported descriptors, saved ABIs |
| **Rebuildable caches**: derived data that's slow or expensive to get again | **IndexedDB** | No | the onchain history index, hash-verified downloaded descriptors |
| **Session-only** | memory | No | the network log, unsaved form input, what each RPC supports (§7.5) |

**Why one storage backend, not two:**
- There's nothing to keep in sync and no "which one?" question for each new feature.
- It works inside Web Workers (the history worker can't use `localStorage`).
- It has no ~5 MB limit, stores values without JSON round-trips, and supports transactions.
- **Nothing needs a synchronous read at startup,** which is the only real reason to use `localStorage`:
  - The path-gateway check doesn't touch storage.
  - `netguard` starts with an empty allowlist and fills it once settings load.
  - The theme is CSS-only.

**Enforced in code:** Biome's `noRestrictedGlobals` rule bans `localStorage` and `sessionStorage` everywhere, and `indexedDB` outside `src/storage/`. The rule's message points to this section.

**Implementation:**
- **Database:** one IndexedDB database, `plainsafe`, with **one object store per domain**. The `idb` library (a very small promise wrapper) sits behind the Effect `Storage` service.
- **Validation:** every record is **decoded with Effect Schema when read**. Invalid records are set aside and reported, never silently used.
- **Upgrades:** the database version is bumped for each schema change, with an explicit migration function.

| Store | Key | Notes |
|---|---|---|
| `settings` | singleton | chains (id, RPC URL or "wallet," explorer), capabilities, trusted auditors, currency, `setupDone` |
| `safes`, `recent` | `chainId:address` | inferred version and last-seen info |
| `packages` | `chainId:safe:safeTxHash` | indexed by `(chainId, safe, nonce)`, with state and execution tx hash |
| `tokenlists`, `mytokens` | list id / `chainId:address` | only the fields we use |
| `addressbook` | `chainId\|*:address` | labels |
| `descriptors` | content hash | user-imported ERC-7730 files |
| `abis` | `chainId:implementationCodeHash` | §7.3 |
| `cache_descriptors` | SHA-256 | rebuildable |
| `cache_rpc_caps` | RPC URL | created in database v1 but **unused**: RPC support is remembered in memory for the session (§7.5) |
| `history_events`, `history_checkpoints` | `chainId:safe:block:logIndex` / `chainId:safe` | P1, §11 |

- **Keeping data:** after setup, call `navigator.storage.persist()`, which makes it less likely the browser clears data under storage pressure.
- **Back up** exports the user-data stores as one JSON file. **Restore** validates the file, shows counts, replaces settings, and **merges packages by safeTxHash**.

---

## 10. Tokens and balances

- **Import:**
  - paste JSON or upload a file (always available)
  - URL or ENS name (needs the capability)
  - Validation uses an Effect Schema that follows the [Uniswap Token Lists](https://github.com/Uniswap/token-lists) structure. **Malformed tokens are skipped one at a time**, with a count, rather than rejecting the whole list.
- **Lists are global.** They apply to every Safe on a matching `chainId`. Each list can be turned on or off.
- **My tokens:** add a token by address; symbol and decimals are read over RPC. You can **export My tokens as a Uniswap-format list**.
- **Built-in list:** a small bundled list with WETH, USDC, USDT, DAI and wstETH on Mainnet, plus common Sepolia test tokens, so the first run isn't empty.
- **Balances:**
  - One viem `multicall` batch of `balanceOf` calls at the pinned block, plus the native balance. It uses `deployless` on chains viem doesn't know (§8.4).
  - **Zero balances are hidden** by default.
- **Fake tokens:** a token is identified by its **address**, never its symbol.
  - When two tokens on a chain share a symbol, show a "duplicate symbol" badge and the shortened address.
  - Reviews show which list a token's symbol came from, and "not in your lists" for tokens you haven't listed.
- **No logos:** every token shows a monogram (§8.2).
- Out of scope: NFTs and token transfer history.

### 10.1 Prices and fiat values (P0, onchain only)

This follows the approach in [gskril/evm-portfolio](https://github.com/gskril/evm-portfolio) (`server/src/price.ts`). **No price API.** Everything is an `eth_call`.

- **Token → ETH:** 1inch's **Spot Price Aggregator** (an onchain contract), `getRateToEth(token, useSrcWrappers = true)`.
  - Address `0x0AdDd25a91563696D8567Df78D5A01C9a991F9B8` on most chains; zkSync uses `0xc9bB6e4FF7dEEa48e045CEd9C0ce016c7CFbD500`.
  - The rate is scaled by `1e18 × 10^(18 − tokenDecimals)`.
  - It's called in the same multicall as the balances.
- **ETH → fiat:** the same aggregator on **Mainnet**, with USDC (`0xA0b8…eB48`) for **USD** and EURC (`0x1aBa…c33c`) for **EUR**. Fiat per ETH = `1 / rate(stablecoin)`.
  - L2 balances are also priced in fiat through Mainnet's ETH/USD rate, so fiat needs the Mainnet RPC.
- **Currency** is picked in Settings (ETH, USD or EUR). Totals are shown per Safe.
- **Where it doesn't work:**
  - If the aggregator has no code on a chain (checked with `eth_getCode` once per chain and remembered), prices are **hidden** there, not zeroed. This includes **Sepolia**, where the aggregator isn't deployed (checked 2026-09-26).
  - Tokens the aggregator can't price show "—".
- **Labeling:** spot prices from DEX pools can be moved within a single block, so they're **for display only**. They're labeled "≈ spot price" and never feed a safety decision. Swaps use Uniswap quotes (§3.13).
- **Why 1inch for display and Uniswap for swaps:** each fits one job.
  - **1inch for display prices:**
    - One call per token, folded into the balances multicall.
    - It averages spot prices across 14 DEX price sources (Uniswap, Curve, Balancer and others), weighted by liquidity, and routes through 8 common tokens automatically.
    - That covers tokens whose liquidity isn't on Uniswap: Curve stablecoins, liquid staking tokens, Balancer pools.
    - The only "dependency" is a contract address and a one-function ABI. No npm package.
  - **Uniswap quoters** give the exact output for a specific amount on a specific route. That's what a swap needs, but it's the wrong tool for pricing a whole portfolio: a search across fee tiers and hops means many heavy `eth_call`s per token, which would blow through the 60-requests-per-minute limit on the default non-Mainnet RPC. It also misses tokens without Uniswap liquidity.
  - **They're never mixed:** the swap screen uses only Uniswap (quote plus v3 TWAP check, §3.13), so its numbers match what executes. 1inch prices only the balance display.
- **Trust note:** the aggregator's owner is an **EOA** (`0x56E4…6dcF`, checked 2026-09-26) that can add or remove price sources. That's fine for display-only prices, and one more reason prices never feed a safety decision.
- **Checked 2026-09-26 on Mainnet via MEV Blocker:** the aggregator gave 1 ETH ≈ 2,684.83 USDC, consistent with Uniswap's v3 quoter (2,681.35) and v4 quoter (2,680.64).

---

## 11. Onchain history (P1)

**P0 ships local history only** (§3.9). The History tab shows it, and the onchain part is built after P0 is done, as described here.

**Plan:**

- **RPC:** history uses **the chain's main RPC only**. There is no separate history RPC.
  - On **Mainnet** the default RPC (MEV Blocker, §8.4) keeps complete log history, so history works out of the box.
  - On **Sepolia and other chains**, the default (evm.stupidtech.net) returned historical logs when tested, but it races random upstreams and allows 60 requests per minute, so a long scan will be slow and the completeness checks matter even more. Using your own RPC is recommended.
- **What it needs from the RPC:**
  - **Logs** back to the Safe's creation, plus **block bodies or transaction lookups** for decoding L1 details.
  - **Block timestamps,** to date each event. Many nodes include `blockTimestamp` in each log (MEV Blocker does), which costs nothing. Otherwise the scanner reads one block header per block with events, with two short retries; a header that can't be read leaves the event undated rather than stalling the scan. Events stored before timestamps were kept (2026-09-26) are dated once, 50 at a time, the next time the scanner runs.
  - **Historical state (archive) is *not* needed.** The owner set at any point can be rebuilt from `SafeSetup`, `AddedOwner` and `RemovedOwner` logs.
- **An empty result doesn't mean "no events."** Nodes that prune receipts can return `[]` for ranges they no longer hold, with no error. A self-hosted node tested on 2026-09-24 kept logs for only about 44,500 blocks (about 6 days) and returned empty arrays beyond that. So the check is whether the history is **complete**, not whether the RPC is reachable.
- **Completeness checks,** run whenever a scan stops:
  1. The Safe's `SafeSetup` event was found.
  2. The number of `ExecutionSuccess` plus `ExecutionFailure` events equals the Safe's current onchain nonce. Every `execTransaction` that doesn't revert increments the nonce exactly once.

  If either check fails, show: *"History incomplete. Your RPC doesn't keep logs back to this Safe's creation. Switch this chain's RPC to one with full log history."* Show the partial history with that banner, never as if it were complete.
- **Refusals** (archive-gated, range-limited even at the smallest chunk, or `4444 pruned history unavailable`) show: *"Your RPC doesn't serve historical logs."*
- **Pre-merge history** (Mainnet blocks before 15,537,394, Sep 2022): nodes that apply history expiry (EIP-4444) drop pre-merge bodies and receipts. Safes created before the Merge need an RPC that still keeps them.
- **Measured on 2026-09-23/24:**

  | RPC | Historical logs |
  |---|---|
  | publicnode free tier | refused |
  | MEV Blocker | complete, 1M-block ranges, including pre-Merge |
  | drpc free plan | 10,000-block ranges |
  | a pruned self-hosted node | about 6 days, then silently empty |

#### The scanner: our own, walking backwards from the tip

We considered [simple-indexer](https://github.com/1001-digital/simple-indexer). It only scans *forward* from a start block, and its strengths (reorg handling and polling at the tip) aren't needed with the finality approach below. So the scanner is our own, about 150 lines of Effect.

- **Why backwards:**
  - **No start-block guess.** The scan stops when the Safe's `SafeSetup` event (its creation) turns up. A forward scan would have to start at the singleton's deploy block, for example about three years of empty ranges for a 2024 Safe on the 1.3.0 singleton.
  - **Recent activity first,** which is what people look at. It also allows "load more" paging.
  - **Progress is known.** The onchain nonce says how many executions exist, so the UI can show "12 of 40 transactions loaded."
- **Floor:** the block where that Safe version's singleton was deployed, bundled for Mainnet and Sepolia by the gen script (0 on custom chains). Reaching the floor without finding `SafeSetup` means the history is incomplete.
- **Chunk sizes:**
  - Start at 100,000 blocks.
  - **Range errors** ("max block range", "ranges over N", "limited to N blocks") halve the chunk until it works. If even a 1-block chunk fails, the RPC counts as refusing.
  - Each success doubles the chunk, up to 1,000,000.
  - **Timeouts, 429s and other temporary errors** retry with exponential backoff (Effect `retry` with `Schedule.exponential`, capped at 8 s, up to 8 retries, about a minute). Public RPCs fail intermittently: MEV Blocker's `eth_getLogs` failed about 4 calls in 10 at times.
  - The working chunk size is remembered per RPC URL.
- **When the scan stops:** `SafeSetup` found (complete), the floor reached (incomplete), the RPC refuses (unavailable), or the user cancels.
- **Finality:**
  - The backwards scan starts at the **`finalized`** block.
  - Blocks above it, the tip window (about 64–96 blocks on Mainnet), are **re-fetched in full on every refresh** and stored separately. Reorgs need no bookkeeping.
  - **The tip window is read before the backwards scan.** A Safe created in the last few minutes has its `SafeSetup` there, above the finalized block, and nothing below it, so the backwards scan doesn't start. A Safe is set up only once and finalized blocks don't change, so this counts as found for good.
- **Later updates:** scan forward from the stored finalized block to the new one (a small range), then re-fetch the tip window. A `SafeSetup` found going forward also counts as found. Without that, a Safe created above the finalized block walks back to the floor.

#### Where it runs: a dedicated Web Worker

- **The worker:** `features/history/history.worker.ts`, created with Vite's `new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module' })`.
- **Leaving the view or the tab:** the scan keeps going when the user switches views or **backgrounds the tab**. The worker runs off the main thread, and its requests aren't slowed by background-tab throttling.
- **Closing the tab** stops the scan, and it **resumes where it left off** next time:
  - After every chunk, the worker writes that chunk's events and a checkpoint `{ scannedDownTo, finalizedHead, chunkSize, status }` to IndexedDB **in one transaction**.
  - Events are keyed by `blockNumber:logIndex`, so writes can be repeated safely. A chunk that was interrupted halfway is simply fetched again.
- **Several tabs:** a Web Lock per Safe (`navigator.locks.request('plainsafe:history:<chainId>:<safe>', …)`) ensures only one worker scans a given Safe. The other tabs read from IndexedDB and get live progress through a `BroadcastChannel`.
- **netguard inside the worker:** a worker has its own `fetch`, so the worker imports `netguard` first, receives the allowlist from the main thread when it starts, and forwards every log entry to the main thread's network log. **Without this, the worker would bypass the network rule.**
- **Settings changes:** a new RPC or chain configuration makes the main thread terminate and restart the worker.
- **When it runs:** once the user turns history on for a Safe, the backfill runs until it finishes while the app is open in any tab (in the background is fine). After that, updates happen only when the History view opens or on a manual refresh. There is no background polling.
- **Why not the alternatives:**
  - **A SharedWorker** has patchy support (notably Chrome for Android).
  - **A Service Worker** is stopped by the browser after short idle periods, so it can't run a long scan. A service worker that persists on an IPFS gateway origin is also a security risk, since it can intercept requests.

#### What it collects

- **Events** (all filtered by the Safe's address):
  - executions: `ExecutionSuccess`, `ExecutionFailure`, `ExecutionFromModuleSuccess`, `ExecutionFromModuleFailure`
  - incoming ETH: `SafeReceived`
  - owners and threshold: `AddedOwner`, `RemovedOwner`, `ChangedThreshold`
  - modules, guard, fallback handler: `EnabledModule`, `DisabledModule`, `ChangedGuard`, `ChangedFallbackHandler`
  - singleton: `ChangedMasterCopy`, which SafeMigration logs in the Safe's context when it upgrades (added 2026-09-26; histories stored before then don't have it until rebuilt)
  - other: `ApproveHash`, `SignMsg`, `SafeSetup`
  - For L2 Safes, also `SafeMultiSigTransaction`.
- **Recovering the details of an executed multisig transaction,** tried in order:
  1. **L2 Safes:** the `SafeMultiSigTransaction` event, which carries every parameter and the signatures.
  2. **L1 Safes:** `eth_getTransactionByHash(log.transactionHash)`. If the node has no transaction index for that block, use `eth_getBlockByNumber(n, true)` and `log.transactionIndex` instead. If it called `execTransaction` on this Safe directly, decode it and **check that the recomputed safeTxHash equals the event's hash**.
  3. A local package with the same safeTxHash.
  4. Otherwise: *"Executed via another contract. Details need tracing,"* showing the safeTxHash, the transaction hash, and the explorer link.
  
  Every recovered transaction goes through the same renderer as a new one (§7.1–7.3).
  - **Each row's one-line summary** is the queue's (§3.9): clear signing first, then the review screen's decoding. That inspects the target over the RPC (whatsabi, cached per address), decodes a MultiSend batch call by call when its code hash matches, and uses your ABI library and Sourcify (when enabled). The offline decoding stands in while the target is read, and for good if it can't be.
- **UI** (the "daily feed with dropdowns" design, agreed 2026-09-26):
  - A progress line: "Scanning back… block N · 12 of 40 transactions found." When the history is complete it reads "Complete: every one of this Safe's N executions is here, read from <RPC host>." with a check; **incomplete** (with the reason) and **unavailable** stay yellow banners.
  - **Refresh**, **Rebuild** (clears the stored history and scans again) and **Turn off**.
  - **Grouped by day** (the local date of the block timestamp), newest first. Each day has a heading ("Monday, September 14", the year when it isn't this one) with its counts, and its rows in one bordered group with a divider between rows. Events not yet dated sit under "Date not read yet". The first 30 rows show; **Show earlier** adds 30 more.
  - **What a row is** (`src/core/history-feed.ts`): events logged in the same transaction before an execution's `ExecutionSuccess`/`ExecutionFailure` (or a module's) belong to that execution: owner and threshold changes, modules, guard, fallback handler, singleton, ETH received. They're folded into its row rather than listed apart. A call to the Safe itself logs receiving its 0 ETH; that line is dropped. Everything else (ETH sent in by others, the Safe's creation, an onchain `approveHash`) is its own row.
  - **Owners and threshold over time** are rebuilt from `SafeSetup`, `AddedOwner`, `RemovedOwner` and `ChangedThreshold` in order, so each execution knows the threshold it was checked against and, when it changed them, the owners before and after. Without the creation in the history, only the differences are known.
  - **A row:** an icon for its kind, the one-line summary (below), then `#nonce · batch of N · k of T signatures` and the time. Failed executions say "inner call failed" in red.
  - **Its dropdown**, rendered only while open:
    - **Call(s):** each call in plain words (ERC-20 amounts with the token's symbol and decimals), then what decoded it ("MultiSendCallOnly v1.4.1, verified by code hash", "on 0x… · ENS standard ABI", "Unverified: raw calldata").
    - **Owners,** when it changed them: "4 → 6 owners · threshold 1 → 2", then the added (green), removed (red) and unchanged owners.
    - **Also logged:** the other events it caused, in words.
    - **Signed by:** each signer recovered from the signatures it carried (`executedSigners`: EIP-712, eth_sign, pre-approved, contract), with "(sent it)" for the owner who sent the transaction, and "k of T needed at the time". An L1 row reads the transaction for these only when opened, if it hadn't already.
    - **safeTxHash** (with copy) and the **transaction** link with its block.
    - The saved package's link, when this browser has it, and **Full decoding and raw fields**: the review screen's decoded view and every field.
- **Storage:** IndexedDB, holding events and a checkpoint for each Safe. It's **left out of Back up/Restore**, since it can be rebuilt.
- **Out of scope:** token transfer history.

---

## 12. Distribution and release (P1, except the gateway rule)

- **Subdomain gateways only (P0 rule).**
  - **Path gateways** (`/ipfs/<cid>`) share one origin across every IPFS site, so any other site there could read and **modify** the app's stored data. For example, it could swap in a malicious RPC URL.
  - So when the app finds `/ipfs/` or `/ipns/` at the start of its path, it **refuses to run**. Before `netguard` or any storage access, it shows one screen with a link to the same CID on a subdomain gateway (`https://<cid>.ipfs.dweb.link/`) and to the ENS name (`plainsafe.eth.limo`).
  - The check is a few lines in `main.tsx` and runs before everything else.
- **Allowed origins:** subdomain gateways (`<cid>.ipfs.<gateway>`), `.eth.limo` and `.eth.link`, `localhost`, and any other normal origin (for example self-hosting).
  - **Subdomain gateways** isolate each release, but every release gets a new, empty origin.
  - **`.eth.limo`** keeps a stable origin across releases, but you trust eth.limo to serve the right files.
  - **Back up and Restore** is how data moves between origins and releases.
- **Build:** `base: './'`, no timestamps in the output, `bun install --frozen-lockfile`.
- **Loading (measured 2026-09-29):** `index.html` preloads the app chunk, the chunks it imports and its CSS (`<link rel="modulepreload">`, added by a small plugin in `vite.config.ts`). Without it the browser finds the app chunk only after `main.tsx` has loaded and run, one gateway round trip later (about 0.4 s on `plainsafe.eth.limo`). A preload fetches but never runs code, so the gateway rule above still holds.
  - Screens are **not** split into lazy chunks. Splitting cut the first download by about a quarter, but each screen's chunk then costs a round trip of its own, which made loads slower at gateway latencies (150 ms: first visit 1.18 s → 1.35 s, returning 0.71 s → 1.15 s).
- **Cloudflare** (Workers Builds, connected in the Cloudflare dashboard) serves `dist/` as static assets, configured in `wrangler.jsonc`. Each pull request gets a preview through `npx wrangler preview`, which needs the file's `previews` block (it can stay empty). It's one more normal origin under the rule above; the release below is unchanged.
- **CID:** `scripts/compute-cid.ts` computes a CIDv1 locally with fixed, documented settings (raw leaves, fixed-size chunker) that match omnipin's. The settings are recorded in `RELEASE.md`.
- **CI** (GitHub Actions, on a tag `v*` or run by hand; the GitHub release in step 3 is only made on a tag):
  1. Install, build, and compute the CID.
  2. **omnipin** uploads the build to SimplePage for `plainsafe.eth`. It does not change ENS; the contenthash is set by hand (below). **CI fails if omnipin's CID differs from ours.**
  3. The GitHub release gets the CID, `dist.zip` (for running locally with `bunx serve dist`), and the list of runtime dependencies.
  4. SimplePage's token is the public ENS name (`OMNIPIN_SIMPLEPAGE_TOKEN=plainsafe.eth`), set in the workflow. Any secret provider tokens would go in GitHub secrets.
- **ENS:** register `plainsafe.eth` before the event. Update the contenthash by hand until the name is owned by a Safe, then publish releases through Plain Safe itself.

---

## 13. Testing

- **Unit tests (Vitest), for pure `core/` code and the schemas:**
  - EIP-712 domain hash, message hash and safeTxHash against **published `safe-tx-hashes-util` examples**: v1.3.0 and v1.4.1 (v1.5.0 if vectors exist), on Mainnet and Sepolia.
  - Signature recovery, sorting and encoding, including pre-validated signatures.
  - Package codec round-trip: JSON, link payload and `plainsafe:1:` code, plus rejection when hashes don't match.
  - The safety-rule classifier, one case per rule in §7.4.
  - Balance-change parsing from `eth_simulateV1` logs, including ETH pseudo-logs.
  - Token list schema: valid and invalid lists, and partial acceptance.
  - `netguard`: allowed, blocked, and JSON-RPC batch parsing.
  - The storage-slot layout (§4.3) against safe-smart-account artifacts.
  - The version-specific revert translation: `GS013` for v1.3.0 and v1.4.1, and passed-through inner revert data for v1.5.0 (§3.8).
- **Integration test against Mainnet** (`test/integration/safe-mainnet.test.ts`): the §4.4 verification script, turned into a test.
  - It runs against real v1.3.0, v1.4.1 (L2) and v1.5.0 Safes through a Mainnet RPC set by an environment variable, and is skipped when none is set.
  - It covers hashes against `getTransactionHash()`, the storage slots, test-key signatures through `eth_simulateV1` with overrides, sort order, pre-validated simulation, `traceTransfers` and `simulateAndRevert`.
  - It also re-derives the proxy code hashes from the factories and compares them with the bundled table.
  - `test/integration/create-safe-mainnet.test.ts` creates a Safe as the app sends it, through `eth_simulateV1` (§3.14).
  - *When history is built (§11):*
    - the chunk-size logic, against recorded range-error messages from real RPCs
    - resuming from a checkpoint after a chunk is interrupted
    - both completeness checks, including the case where a pruned node returns `[]` and the execution count doesn't match the nonce
    - `netguard` running inside the worker
- **Manual end-to-end test on Sepolia**, with a 2-of-3 Safe (v1.4.1, plus v1.3.0 if available):
  1. Signer A (MetaMask) builds an ERC-20 transfer, signs, and copies the link.
  2. Signer B (Rabby, a **fresh browser profile**) opens the link, sees the hashes before any request, completes setup, checks the chain, signs, and executes.
  3. The network log shows **only** the configured RPC.
  4. Repeat for owner management (add an owner, change the threshold).
- **Before submission:** one small real transaction on Mainnet.

---

## 14. Repo, hackathon logistics and AI usage

- **Repo:** a public GitHub repo, `gskril/plainsafe`. The first commit comes any time after **Fri Sep 25, 21:00 JST** and adds this `SPEC.md`. Commit in small steps so the history shows progress; ETHGlobal disqualifies large single commits.
- **README:**
  - what the app is and why
  - how to run it locally (`bun install && bun run dev`, or `bunx serve dist`)
  - the network promise and how to confirm it
  - **an AI usage section**, required: which tools, and which files or areas they helped with
  - credits for bundled open-source data (the clear-signing registry copy, safe-deployments)
- **`docs/planning/`:** this spec's grilling transcript and any other planning artifacts, which ETHGlobal requires for spec-driven work.
- **Submission:** by **Sun Sep 27, 09:00 JST**. A 2–4 minute demo video (720p or higher, no AI voiceover) is optional. Prizes are not a goal.
- **Before the event** (non-code only, per Classic rules):
  - Register `plainsafe.eth`.
  - Fund 2–3 Sepolia EOAs.
  - Create Sepolia test Safes (2-of-3; v1.4.1 and v1.3.0 if possible) with any existing tool.
  - Have MetaMask and Rabby installed.
  - (For P1 IPFS releases) Subscribe `plainsafe.eth` on SimplePage.
- **Uniswap prize (if we build the swap, §17):** it needs a public repo, a `FEEDBACK.md`, the Uniswap developer feedback form, and a README that points to the Uniswap integration code.

---

## 15. Security notes (from the incidents)

- **Bybit:** the UI showed one transaction while the wallet signed another, a **delegatecall** to a malicious contract. Our defenses:
  - the delegatecall rule (red, typed confirmation)
  - the three hashes always visible for comparison with the device
  - code-hash-verified MultiSend
  - IPFS and local distribution, so no hosted JavaScript can be swapped out
- **Radiant:** malware changed the calldata sent to the hardware wallet. Our defenses: hashes displayed for comparison with the device, and an independent Verify page.
- **WazirX:** the UI showed a routine transfer while the signatures authorized an upgrade. Our defenses: safety rules computed from decoded calldata (never from descriptors), and the "unverified" treatment for anything we can't decode.
- **Other attack paths we close:**
  - a poisoned package with fake labels (packages never carry labels)
  - registry poisoning (descriptors pinned to a commit, attestation levels)
  - a same-origin gateway tampering with storage (refusing to run on path gateways; Schema-decoded storage)
  - a malicious or compromised npm release (`minimumReleaseAge` of 2 days, frozen lockfile)
  - a contract that pretends to be a Safe (proxy and singleton code hashes, including legacy proxies)
  - dependencies quietly calling home (`netguard` blocks them)
  - inconsistent RPC reads (pinned block)

---

## 16. Build order and cut order

**Supply-chain rule, set up before the first `bun add`:** a `bunfig.toml` at the repo root holds:

```toml
[install]
# Only install package versions published at least 2 days ago (seconds)
minimumReleaseAge = 172800
```

Also: `bun.lock` is committed, CI uses `--frozen-lockfile`, and exceptions go in `minimumReleaseAgeExcludes` only with a comment explaining why.

Built in this order. If time runs short, cut from the bottom of the list. Items 1–12 are the must-haves.

1. Scaffold (Vite, Bun, Biome, Tailwind, shadcn, wouter, **`bunfig.toml`**), the path-gateway check, **netguard**, settings schema, and the setup screen
2. `core/` hashing and signatures with test vectors, plus the Mainnet integration test (§4.4)
3. Adding a Safe, the authenticity check (proxy and singleton hashes), and pinned-block reads
4. Builder: ETH, ERC-20, owners and threshold, contract call (whatsabi)
5. Review screen: hashes, safety rules, ABI decoding, whatsabi checks
6. Signing, the package codec, sharing (link, code, file), import with validation and merge
7. Execution: estimate, send, receipt, version-aware error translation
8. Token lists, My tokens, balances, and **prices and fiat** (§10.1)
9. **ENS names** (§8.5), including the CCIP-read toggle
10. Queue and local history
11. Clear signing (library, descriptors, resolver, trust levels)
12. Simulation (levels 1 and 2)
13. Verify page
14. Capability toggles, the network log drawer, address book, Back up and Restore
15. P1, in this order: MultiSend and **Swap** (§3.13), `approveHash`, cancel, queue simulation, onchain history (§11), IPFS release and omnipin workflow (§12), ENS contenthash through a Safe

---

## 17. Open questions and follow-ups

**Open:**
- **Final confirmation of this spec as a whole:** Greg's review is in progress.

**Decided (2026-09-26):**
- **Swap:** the first P1 item, built with MultiSend, Uniswap only (§3.13).
- **ABI library:** tied to implementation code hashes (§7.3).
- **Clear signing:** Safe's descriptors bundled, everything else fetched on demand and checked against a SHA-256 manifest (§7.2).
- **Storage:** IndexedDB for everything that persists, `localStorage` banned, with a documented split by kind of data (§9.5).
- **Default RPC for every chain except Mainnet, Sepolia included: [evm.stupidtech.net](https://evm.stupidtech.net/) prefilled** (§8.4), with a note to use your own RPC. This replaces the earlier "suggest, don't prefill" decision. Test results (`POST /v1/<chainId>`, any chain on Chainlist, 2026-09-24):
   - **Pros:**
     - `access-control-allow-origin: *`
     - correct chain IDs
     - `eth_simulateV1` and even `debug_traceCall` worked
     - one historical `eth_getLogs` over 1M blocks returned 58 logs
   - **Cons:**
     - It **races 5 random public upstreams for every request** and returns the first "successful" response, so results aren't deterministic. The same historical `getLogs` returned 58 logs once and an upstream error the next time. A Sepolia `eth_call` with state overrides returned a dead upstream's error ("Blast API is no longer available").
     - The rate limit is 60 requests per minute per IP.
     - More parties see your queries.

**Follow-ups (not blocking):**
- **MEV Blocker as the Mainnet default** (§8.4): before relying on it long-term, ask the CoW/MEV Blocker team whether a wallet UI can depend on their read endpoint, and what their rate limits and logging policy are. If the answer is no, switch the Mainnet default to evm.stupidtech.net like other chains.

---

## 18. References

- RFP: https://initiatives.thedao.fund/initiative/production-ready-local-first-safe-ui
- ETHGlobal Tokyo 2026: https://ethglobal.com/events/tokyo2026 · rules: https://ethglobal.com/events/tokyo2026/info/details
- Existing work: [localsafe.eth](https://github.com/Cyfrin/localsafe.eth), [Eternal Safe](https://github.com/eternalsafe/wallet), [safe-tx-hashes-util](https://github.com/pcaversaccio/safe-tx-hashes-util)
- Safe contracts: https://github.com/safe-global/safe-smart-account · deployments: https://github.com/safe-global/safe-deployments
- ERC-7730: https://eips.ethereum.org/EIPS/eip-7730 · registry: https://github.com/ethereum/clear-signing-erc7730-registry · clearsigning.org
- Clear-signing library: https://github.com/sourcifyeth/clear-signing
- whatsabi: https://github.com/shazow/whatsabi
- simple-indexer (considered for history, not used): https://github.com/1001-digital/simple-indexer
- MEV Blocker: https://docs.mevblocker.io/
- omnipin: https://github.com/omnipin/omnipin
- Uniswap Token Lists: https://github.com/Uniswap/token-lists
- `eth_simulateV1`: https://github.com/ethereum/execution-apis (viem `simulateBlocks`)
