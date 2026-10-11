# Planning transcript: Plain Safe spec session

The conversation that produced `SPEC.md`. It was run in Claude Code with the `grilling` skill: Claude asked questions in rounds, and the user answered.

**Included:** only the messages between the user and Claude, in order.

**Removed:** tool calls, tool output (web fetches, RPC probes, scripts), Claude's internal reasoning, and message timestamps. Dates inside messages are part of what was said and are kept.

**Redacted:** a personal RPC endpoint and local file paths. The scripts behind the Mainnet checks are in `docs/planning/verification/`.

---

## Greg (1)

I'm participating in a hackathon this weekend, and I want to build a project around Safe, the smart contract wallet on Ethereum. This is roughly the product spec (unrelated to the hackathon) https://initiatives.thedao.fund/initiative/production-ready-local-first-safe-ui. This is the hackathon https://ethglobal.com/events/tokyo2026/

/grill-me to come up with a solid product spec which will serve as the foundation for our weekend of hacking

---

## Claude

Now the hackathon page.

Reading the RFP and ETHGlobal Tokyo prize/rules pages. A few more facts to check (Continuity Track rules, submission deadline), then I'll send the first round of questions.

I read both pages and looked at your existing `localsafe.eth` checkout.

**Hackathon facts**
- **Hacking window:** Fri Sep 25 at 9pm JST to **Sun Sep 27 at 9am JST**, when submissions are due. That's about 36 hours.
- **Finalist judging:** a 4-minute demo plus 3 minutes of Q&A. Judges score Technicality, Originality, Practicality, Usability and WOW.
- **Continuity Track (new this year):** you can build on an existing repo. On the "From Scratch" (Classic) track, no project code or designs can exist before Friday 9pm. A written spec is fine, but it has to be committed to the repo.
- **Partner prizes:** only **ENS** fits naturally. The rest are World ID, 1inch, Uniswap, Sui, and Intercepta (for x402 agent payments). World ID and Intercepta both need a hosted backend or SaaS, which the RFP's "RPC only" requirement rules out.

**RFP facts**
- The $120k bounty is at $0 funded so far.
- Milestone A covers the whole Safe flow without any Safe servers: load the Safe from chain, build the transaction, sign on Ledger and Trezor while checking the hashes on the device, pass signatures around as files or links, and execute. The browser network panel should show nothing but RPC calls.
- It also needs a hash CLI, reproducible IPFS builds, and an ENS name pointing to the release.
- Bids are judged partly on having **fewer runtime dependencies** than existing work.

**Your local checkout:** `~/Desktop/crypto/localsafe.eth` is on branch `patch-1` with uncommitted changes. Its fork remote (`gskril/localsafe.eth`) returns 404. Cyfrin's upstream is at v0.3.1 (June 18, 2026).

---

❓ **Q1** - **What's the goal for the weekend?** This decides most of what follows.
- **(A) Win the hackathon:** optimize for the finalist stage and ENS prizes, even if it drifts from the RFP.
- **(B) Build the base for an RFP bid:** a boring, correct core with minimal dependencies that you keep building after the event and show as your track record.
- **(C) Both, with the RFP as the backbone:** build a hackathon-sized cut of Milestone A. The pitch is Bybit, Radiant and WazirX: "the software showing you a transaction isn't part of the trust boundary, so here's a UI you can check on your own."

➡️ **C.** The RFP hard requirements already make a sharp scope, and the Bybit story gives you the WOW. Showing the network panel with nothing but one RPC endpoint is a strong demo moment. It also gives you a real artifact to show backers while the RFP raises money. Pure (A) makes you build things the RFP rules out later.

---

❓ **Q2** - **Who's on the team, and what hardware do you have?**
- How many people, and who's strongest at frontend, contracts/EIP-712, and design/demo?
- Which hardware wallets will you have in Tokyo? For example Ledger Nano S+/X/Flex/Stax, or Trezor One/Model T/Safe 3/Safe 5. The model matters: some can only show hashes, and some can show the parsed EIP-712 data.
- Do you control a Mainnet Safe, ideally one v1.3.0 and one v1.4.1, whose signers you could demo with? Or would you rather demo on a Mainnet fork (anvil) or on Sepolia?

➡️ Ideally 2–3 people, with one person owning hardware-wallet integration full time, because that's where the surprises come from. Bring **one Ledger and one Trezor** so the demo can pass a transaction between two different devices. If you don't have a Mainnet Safe you're comfortable using, a Mainnet fork keeps the real contracts and chain ID 1 without real money at stake.

---

❓ **Q3** - **Where do you start from?**
- **(A) Fresh build, Classic track.** Start from an empty repo on Friday 9pm with viem plus a small UI stack. You can read localsafe.eth and Eternal Safe for reference but not copy them.
- **(B) Extend localsafe.eth on the Continuity track.** You'd start with a working lifecycle. But that track is meant for a repo you already maintain, and Cyfrin maintains this one. Partner-prize eligibility "may vary" there, and finalist eligibility isn't spelled out. It also carries Next.js, RainbowKit, WalletConnect (whose relay servers count as hosted SaaS), a CoinGecko call, and three Ethereum libraries (Safe protocol-kit, ethers and viem). The RFP explicitly wants fewer dependencies than that.
- **(C) Extend Eternal Safe.** It's a GPL fork of the full Safe{Wallet}, so it's heavy, and you'd be competing with its own maintainer.

➡️ **A.** Safe's EIP-712 hashing for v1.3.0 and v1.4.1 fits in about 50 lines with viem's `hashTypedData`, so you don't need protocol-kit. The hard parts are hardware-wallet signing, the signature-package format, and verification UX, and a fork wouldn't give you those in a form the RFP accepts anyway. The Classic track keeps every prize open, and "zero dependencies beyond an RPC endpoint" becomes both your pitch and your advantage in an RFP bid.

---

## Greg (2)

I think I'd rather start from scratch than extend the existing one on the continuity track

---

## Claude

Settled: **fresh build on the Classic track.**

That makes two things matter now:
- **Classic rules:** no project code, designs or assets can exist before Friday 9pm JST. This spec is fine to write now, but it has to be committed to the repo along with your AI prompts and planning files.
- **New risk on Trezor:** without a fork, you write your own hardware-wallet integration. Ledger is easy. Its `signEIP712HashedMessage` call over WebHID puts the domain hash and message hash on the device screen, which is exactly what the RFP asks for ([Ledger Safe signing spec](https://hackmd.io/@sednaoui/rJMAxWqFle)). Trezor is the problem. Trezor Connect only lets `trezor.io` and `localhost` skip its popup; every other site must open a popup served from `connect.trezor.io` ([connect-web docs](https://connect.trezor.io/9/readme/connect-web/), [Init](https://connect.trezor.io/9/methods/other/init/)). The RFP rules out vendor popups. The workaround is to talk to the device directly with `@trezor/transport` and `@trezor/protobuf`, which Trezor says you "probably don't want" to do ([@trezor/transport](https://www.npmjs.com/package/@trezor/transport)). That's feasible, but it's the riskiest item this weekend.

Q1 and Q2 are still open and block most of the rest, so I'm asking them again. Two questions that the start-from-scratch decision opened up are below them.

---

❓ **Q1** - **What's the goal for the weekend?** (still open)
- **(A)** Win the hackathon.
- **(B)** Build the base for an RFP bid.
- **(C)** Both, with the RFP as the backbone.

➡️ **C.** Build a hackathon-sized cut of Milestone A and pitch it with the Bybit story, "the UI isn't part of the trust boundary."

---

❓ **Q2** - **Who's on the team, and what hardware do you have?** (still open)
- How many people, and what is each person strongest at?
- Which Ledger and Trezor models will you have in Tokyo?
- Will you demo with a real Mainnet Safe, a Mainnet fork (anvil), or Sepolia?

➡️ 2–3 people, with one owning hardware wallets full time. Bring one Ledger and one Trezor Model T, Safe 3 or Safe 5 (the Trezor One can only sign hashes). Demo on a Mainnet fork unless you have a Safe you're happy to use live.

---

❓ **Q4** - **What can you do before Friday 9pm?** The rule forbids project code, designs and assets. It doesn't forbid learning.
- **(A) Spec and reading only.** Finish this spec, read the Safe contracts, the Ledger and Trezor docs and the prize docs, and check device firmware and Ledger settings (blind signing on, transaction hash display on). You can run vendor example apps, but write no code of your own.
- **(B) Throwaway spikes.** Try Trezor WebUSB signing in a scratch folder outside the repo and delete it. This is the rule's gray area. If anyone asks, "we tested this on Wednesday" is hard to defend.
- **(C) Nothing until Friday.**

➡️ **A.** Also write down the Trezor WebUSB approach in detail: which protobuf messages to send and the order of the handshake. Then the first hours on Friday night go into a known path, not research. Put a firm time limit on the Trezor work Friday night, for example "working by Saturday 6am JST, or we demo Ledger only and keep Trezor as a roadmap slide."

---

❓ **Q5** - **Which license?** The RFP accepts MIT or GPL-3.0, and the repo must be public from the first funded commit.
- **MIT:** you can borrow from localsafe.eth (also MIT), and it's the easiest for others to adopt.
- **GPL-3.0:** you can borrow from Eternal Safe and Safe's own monorepo, and forks must stay open.

➡️ **MIT.** Making the repo public from the first commit on Friday doubles as the commit history ETHGlobal wants to see.

---

## Greg (3)


Honestly, we can skip the hardware wallet integration for the sake of the hackathon and just focus on EOA wallets. For your first question, the goal just to build a good product. I don't really care about winning anything. It's just for the product to exist. For your second question, the people is just me. I'm a full stack engineer, although this application should be entirely static, so front-end is basically all that matters. I do have experience with blockchain tech, including VIEM and Wagmi libraries, which we should use. Testing on mainnet and sepolia are preferred, not Anvil before Friday. I only planned to build out a detailed spec, which is what we're trying to do right now in this conversation. And as far as license is concerned, everything should be MIT licensed


---

## Claude

Settled so far:

| Decision | Answer |
|---|---|
| Goal | A good product that exists. The RFP is a reference, not something we're bound to. No optimizing for prizes. |
| Team | Just you (full-stack). Fully static frontend, viem + wagmi. |
| Signers | EOA wallets only, no direct hardware-wallet integration. A Ledger connected through MetaMask or Rabby still works as a normal wallet. |
| Networks | Mainnet and Sepolia, no anvil. |
| Starting point | Fresh repo on the Classic track, spec only before Friday. |
| License | MIT |

The tree opens up a lot now. These six don't depend on each other:

---

❓ **Q6** - **Network rule: is it strictly "the only outbound request is the RPC"?** This is the product's main promise, and it decides several things at once.
- **(A) Strict.** The page only talks to the RPC endpoint and the wallet extension already in the browser. That means:
  - Only extension wallets, found automatically through EIP-6963. No WalletConnect or other phone wallets, no Coinbase SDK, no RainbowKit; you write a roughly 50-line connect menu with wagmi.
  - No token prices or logos.
  - No 4byte or Sourcify lookups to name unknown calldata.
  - Set `ccipRead: false` in viem. Some ENS names (off-chain resolvers) quietly make HTTP calls to their own servers, and this stops that.
  - Fonts are system or bundled, and there's no analytics.
- **(B) Strict by default, with opt-in extras.** Settings toggles for WalletConnect, Sourcify and 4byte, each off by default and labeled with where it connects.
- **(C) Pragmatic:** use whatever is convenient.

➡️ **A** for the weekend, with every non-RPC request going through one small module so B can be added later. "Open DevTools: the only thing in the network panel is the RPC" is the clearest pitch this product has, and strict is also the least work.

---

❓ **Q7** - **What's in scope for the weekend?** Here's a proposed cut for one person over 36 hours:

**P0: the full flow works on Sepolia and Mainnet**
1. **Add a Safe** by address and chain. Read owners, threshold, nonce, version and ETH balance over RPC.
2. **Transaction builder** with these presets: send ETH, send ERC-20, contract call (ABI-based or raw calldata), and owner management (add, remove or swap an owner, change the threshold). Owner changes are just calls from the Safe to itself, so they use the same builder.
3. **Review screen:** all SafeTx fields, calldata decoded (or labeled **"unverified raw bytes"** if it can't be), and the domain hash, message hash and safeTxHash shown prominently.
4. **Sign** with `eth_signTypedData_v4` from the connected owner.
5. **Export and import** through a file or a link. On import, check that every signature recovers to a **current** owner for **this** safeTxHash, then merge the signatures.
6. **Execute** once the threshold is met. If the person executing is an owner, their own signature doesn't need a separate step.
7. **Verify page:** paste the transaction fields and get the three hashes, with no wallet needed.

**P1: if there's time**
- `approveHash` on-chain as another way to sign.
- Warnings for a stale nonce, an already-executed transaction, or two packages competing for one nonce.
- A one-click cancel (an empty transaction at the same nonce).
- Batching with MultiSendCallOnly, decoded recursively.
- ENS names shown for addresses (over RPC).

**P2 / after the weekend**
- Safes owned by other Safes (EIP-1271). This follows from "EOA signers only."
- Signing Safe messages, and a CLI for hashes.
- Transaction history built from event logs.
- Creating new Safes, and managing modules and guards.
- Direct hardware-wallet support, reproducible IPFS builds, and ENS for releases.

➡️ This cut. P0 is the flow the RFP describes, with EOAs in place of hardware wallets. Tell me what to move between tiers.

---

❓ **Q8** - **Which Safe versions, and how do you know an address is really a Safe?**
- **Versions:** v1.3.0, v1.4.1 and v1.5.0, both the L1 and L2 editions. They all hash transactions the same way, so supporting all three is almost free. Versions before 1.3.0 hash differently (no chain ID in the domain; 1.0.0 even uses different field names), so show those as read-only, with a clear "unsupported version" message.
- **Authenticity:** a malicious contract can return any `VERSION()` string it likes. Before trusting an address, read the proxy's singleton address (storage slot 0) and check it against a bundled list of official Safe deployment addresses. If it doesn't match, show a loud warning and refuse to sign.

➡️ Both as described. The address list is a small JSON file copied from `safe-deployments` at build time, so the app makes no network request for it.

---

❓ **Q9** - **Which chains does the product support?**
- **(A)** Only Mainnet and Sepolia.
- **(B)** Mainnet and Sepolia, plus the major L2s preconfigured (Base, OP, Arbitrum, Gnosis).
- **(C)** Any chain: the user enters a chain ID and RPC URL.

➡️ **A**, but kept in a config table so each new chain is one entry: chain, default RPC, and Safe and MultiSend addresses. The hashing code doesn't care which chain it's on, so adding B later is a data change. The same goes for C, as long as each chain's singleton addresses are known.

---

❓ **Q10** - **What does a signature package look like, and how do links work?**
- **Format:** your own versioned JSON:
  ```json
  {
    "v": 1,
    "chainId": 1,
    "safe": "0x…",
    "safeVersion": "1.4.1",
    "tx": { "to": "…", "value": "…", "data": "…", "operation": 0, "safeTxGas": "0", "baseGas": "0", "gasPrice": "0", "gasToken": "0x0…", "refundReceiver": "0x0…", "nonce": "…" },
    "hashes": { "domain": "…", "message": "…", "safeTx": "…" },
    "signatures": [ { "signer": "0x…", "type": "eip712", "data": "0x…" } ]
  }
  ```
  The hashes in the file are only for people to compare by eye. The app always recomputes them on import and rejects the package if they don't match.
- **Links:** `<origin>/#/import/<base64url(deflate(json))>`. Everything after the `#` never leaves the browser, so an IPFS gateway never sees the payload. Compression uses the browser's built-in `CompressionStream`, so no extra dependency. Also offer **"copy code"**: the raw payload string, which can be pasted into *any* copy of the app, not just the one that made the link.
- **Encryption:** none. The transaction ends up public on-chain anyway. The real threat is tampering, and recomputing the hashes plus checking the signatures already catches that.
- **Interoperability:** importing Safe Transaction Builder JSON is P2.

➡️ All as described. If a link gets too long for chat apps (large MultiSend calldata, say over 4 KB), have the UI suggest a file instead.

---

❓ **Q11** - **Stack and tooling** (viem and wagmi are already decided)
- **Build:** Vite + React + TypeScript. Next.js' static export adds complexity a single-page app doesn't need.
- **Package manager and scripts:** Bun. Biome for formatting and linting.
- **Routing:** a hash router, so the app works on IPFS gateways and any static host. `wouter` with `useHashLocation` is about 2 KB; React Router works too.
- **State:** TanStack Query (which wagmi needs anyway). Saved Safes, drafts and signature packages go in `localStorage`, with an export/import of everything as a backup.
- **UI:** Tailwind v4 + shadcn/ui. The components are copied into the repo, so you only depend on Radix. System fonts.
- **Tests:** Vitest, checking the hashing against published examples from `safe-tx-hashes-util`, for v1.3.0 and v1.4.1 on both chains.

➡️ All of the above. Push back on anything that doesn't match your habits.

---

## Greg (4)

For question six, let's go with option B strict by default and options to open up other capabilities. For question seven, I'd like to be ambitious and consider everything P0 But realistically the most important things are to add a safe, build transactions, review transactions, sign the transactions, and send that link around where other people could add their signature to it, executing transactions, and then ultimately seeing the balance of a wallet after you add manual token lists. And by the way, token lists should support Uniswap's standard so that you could easily import batches of tokens. Nested safes and any CLI can be considered out of scope for this weekend, including direct hardware wallet support. IPFS build is in scope. P1 stuff i can take it or leave it.

For question eight, we should support everything after version 1.3.0, including an authenticity check. For question nine, we should really be able to support any chain, but with a strong focus on mainnet and Sepolia during development. I think your suggestion for question 10 is good. There should be a JSON format that you can easily see, and then there should be a way to share it in a link. Not having encryption is okay. For question eleven, everything you suggested is fine. I don't have a strong opinion on routing, but everything else, I support your choices

---

## Claude

Updated decisions:

| Decision | Answer |
|---|---|
| Network rule | Strict by default: only the RPC. Other network capabilities can be turned on one at a time. |
| Weekend scope | Everything in the old P0 is in. The core path is: add a Safe → build a transaction → review it → sign → share a link that others add signatures to → execute → see balances using token lists you add (Uniswap token list standard). The IPFS build is in scope. P1 is optional. |
| Out of scope | Safes owned by other Safes, a CLI, direct hardware-wallet support |
| Safe versions | Every version from 1.3.0 on, with an authenticity check |
| Chains | Any chain, with Mainnet and Sepolia as the focus |
| Package and link | Readable JSON plus a shareable link, no encryption |
| Stack | Vite, React, TS, Bun, Biome, Tailwind with shadcn, Vitest, TanStack Query, and saved data in `localStorage`. For routing I'll use **wouter with hash routing** unless you object. |

One thing I checked: `safe-deployments` includes a **`codeHash`** for every contract variant, including v1.5.0, the L2 editions and zkSync. So the authenticity check can hash the code at the address instead of comparing it against a per-chain address list. That works on *any* chain with no extra data. It shapes Q14 below.

---

❓ **Q12** - **Which opt-in capabilities exist, and how do they look in the app?** Proposed list, all **off** by default:

| Capability | Contacts | Why it's needed |
|---|---|---|
| Load token lists from a URL or ENS name | the list's host or an IPFS gateway | importing Uniswap-standard lists by URL (pasting or uploading a file needs nothing) |
| Token logos | whatever host each `logoURI` points to | nicer balances; also leaks your IP address to those hosts |
| Sourcify | sourcify.dev | fetches ABIs and verified contract names for decoding |
| Function-signature database | a 4byte/Sourcify signature database | guesses unknown function selectors. Always shown as "guessed", never as "verified", because two functions can share a selector |
| ENS off-chain lookups (CCIP-read) | each name's resolver server | resolving names stored off-chain |

Not included: **WalletConnect**, which needs a Reown project ID and a large dependency, so it waits until after the weekend. **Prices** are left out completely, so no fiat values anywhere.

How it looks in the app:
- **Settings → Network access**, listing each toggle with the exact host it contacts.
- **A prompt when a feature needs one**, for example "This list lives at `tokens.uniswap.org`. Fetch it once, or always allow?"
- **A small "Network log" drawer** listing every request the app has made, RPC included. The product's promise is then visible from inside the app, not only in DevTools.

➡️ This list and this design. The network log is about an hour of work: one wrapper around the viem transport and `fetch`.

---

❓ **Q13** - **Token lists and balances**
- **Import:** paste JSON or upload a file (always allowed), or load from a URL (needs the capability from Q12). Check each token for `chainId`, `address`, `decimals`, `symbol` and `name`. Skip malformed tokens one at a time instead of rejecting the whole list.
- **Where lists apply:** lists are global and apply to every Safe on a matching chain. Tokens you add by address (metadata read over RPC) go into a local "My tokens" list, which you can **export as a Uniswap-format list**.
- **Built-in list:** a small bundled list with WETH, USDC, USDT, DAI and wstETH on Mainnet, plus Sepolia test tokens, so balances aren't empty on first run.
- **Reading balances:** batch the calls through Multicall3 with viem's `multicall`. Fall back to one call per token on chains without Multicall3. Hide zero balances by default.
- **Fake tokens:** a token is identified by its **address**, never its symbol. If two tokens on one chain share a symbol, show a "duplicate symbol" badge and the shortened address. When reviewing an ERC-20 transfer, show which list the symbol came from.
- **NFTs:** out of scope.

➡️ All of the above.

---

❓ **Q14** - **Supporting any chain: RPCs and the authenticity check**
- **Adding a chain:** the user enters a chain ID, an RPC URL, a name and the native currency symbol. The app calls `eth_chainId` to confirm the RPC matches the chain ID.
- **Authenticity:** the proxy's code hash must match a known SafeProxy hash, and the singleton's code hash (read from storage slot 0) must match a known Safe singleton. That match also tells you the version, without trusting `VERSION()`. Bundle the canonical, eip155 and zkSync hashes. For batching in P1, verify MultiSend the same way.
- **Unknown singleton** (a future Safe version, or a fake): show the Safe read-only with a clear reason, and **refuse to sign**.
- **Default RPCs:** Mainnet and Sepolia ship with a public endpoint that needs no API key. It's always visible in the header and one click to change. Custom chains have no default.
- **Optional mode:** "Use my wallet's RPC", which sends reads through the extension so the page itself makes no requests.
- **Chain switching:** MetaMask rejects `signTypedData` when the domain's chain ID doesn't match the wallet's active chain, so the app asks the wallet to switch (or add) the chain before signing.

➡️ All of the above, including refusing to sign on an unknown singleton.

---

❓ **Q15** - **IPFS distribution.** There's a trap here:
- **Path gateways** (`ipfs.io/ipfs/<cid>`) put every IPFS site on one origin, so any other site on that gateway can read and **change** your `localStorage`. An attacker could swap in their own RPC URL, and a lying RPC can report fake owners.
- **Subdomain gateways** (`<cid>.ipfs.dweb.link`) isolate each site, but every release is a new origin with empty storage.
- **An ENS name served through `.eth.limo`** keeps the same origin across releases, but you're trusting eth.limo to serve the correct files.

Proposal:
- Vite `base: './'` so the build works under any path.
- A reproducible build, plus a script that computes the CIDv1 on your machine with fixed settings: raw leaves, 256 KiB chunks, CIDv1.
- A GitHub Action on each tag that builds, computes the CID, pins it and lists it in the release notes, along with a `dist.zip` for running locally with `bunx serve`.
- The app **detects a path gateway** (`/ipfs/` in the URL) and shows a warning banner.
- **"Back up everything" / "Restore"** as JSON, for moving data between origins and releases.
- For the ENS name, bonus points: have a **Safe own the name** and publish each release by updating its contenthash with a transaction built and signed *in the app itself*.

Also: which pinning service do you use (Pinata, Filebase, Storacha, your own Kubo)? It's only used when publishing, so it doesn't break the "RPC only" rule for users.

➡️ Everything above. Publishing a release through the app itself is a great story, but it's the first thing to cut if time runs short.

---

❓ **Q16** - **What does a co-signer see when they open a link?** This is the least technical user, so it should drive the UX. Proposal: the link opens straight to one **transaction page**:
1. **Safe identity:** address (and ENS name if enabled), chain, version, and the authenticity badge.
2. **A plain-language summary** ("Send 1,000 USDC to 0xAbc…"), then the decoded details, then the raw fields folded away.
3. **The three hashes**, with copy buttons and a note to compare them with the wallet screen or an independent tool.
4. **Signature progress**, for example "1 of 2". It lists every owner and marks who has signed (checked) and who hasn't.
5. **One main button**, which changes with the situation:
   - **Connect** when no wallet is connected.
   - **Sign** when you're an owner who hasn't signed yet.
   - **Share updated link / code / file** after you sign.
   - **Execute** once the threshold is met; anyone can execute.
6. The package is **saved automatically** to that Safe's local queue, and the Safe goes into a "Recent" list, separate from "My Safes."

**The queue for each Safe** groups packages by nonce and shows a state:
- **Needs signatures**
- **Ready to execute**
- **Future nonce**: an earlier nonce has to go first.
- **Nonce used**: the Safe's current nonce has passed it, so it was executed or replaced.

Importing a package with the same safeTxHash merges its signatures. If it has a different safeTxHash at the same nonce, show a **conflict** badge. That covers most of the P1 nonce warnings for free.

➡️ This flow.

---

❓ **Q17** - **Safety rules on the review screen** (lessons from Bybit and WazirX)
- **Delegatecall** (`operation = 1`) is allowed quietly only to a MultiSend contract whose code hash checks out. Anything else gets a red banner, "DELEGATECALL to an unknown contract can take over this Safe," and you must type a confirmation before signing. The builder only ever produces delegatecall for batches.
- **Calls that change who controls the Safe** (owners, threshold, modules, guard, fallback handler) get an orange banner with a **before → after** view of owners and threshold.
- **Calldata that can't be decoded** gets an "Unverified: raw calldata" label, and the button reads **"Sign unverified transaction."**
- **Non-zero refund fields** (`gasPrice`, `gasToken`, `refundReceiver`), which can be used to drain funds through gas refunds, get a warning.
- **A nonce other than the current one** gets a note explaining what that means.

➡️ All five rules.

---

❓ **Q18** - **Product name.** Your folder is `local-safe`, but `localsafe.eth` belongs to Cyfrin. Also, "Safe" is the Safe Ecosystem Foundation's brand. localsafe and Eternal Safe use it anyway, but a name without it avoids the question entirely.

ENS names I checked:
- **Available:** `plainsafe.eth`, `sparesafe.eth`, `safecopy.eth`, `rpcsafe.eth`, `quorumui.eth`
- **Taken:** `walkaway`, `failsafe`, `lifeboat`, `understudy`, `cosigner`

➡️ **Plain Safe** (`plainsafe.eth`), which says "nothing but the chain." If you want to avoid the Safe brand, give me a few ideas and I'll check them.

---

❓ **Q19** - **Weekend schedule and where to cut** (JST, 36 hours)
- **Fri 21:00–03:00:** scaffold, chain and RPC config, the network log, loading a Safe with the code-hash check, and the hashing library with tests against published examples.
- **Sat 09:00–18:00:** builder, review screen and safety rules, signing, package, link, import and merge, execute. **Checkpoint:** on Sepolia, two signers pass a link back and forth and execute.
- **Sat 18:00–24:00:** token lists and balances, the queue, the Verify page.
- **Sun 00:00–06:00:** reproducible IPFS build and pinning, then the same flow on Mainnet, with Settings → Network access.
- **Sun 06:00–09:00:** README (listing what AI tools did), demo video, submission.

**Where to cut:** if the Saturday 18:00 checkpoint slips, drop the Verify page and the opt-in capabilities first. Token lists and the IPFS build stay in.

➡️ This schedule and cut order.

---

## Greg (5)

For question twelve, I agree with your suggestion. Same as thirteen. I also agree with fourteen. I honestly wouldn't consider IPFS distribution a number one priority for this hackathon, but generally, I'm aligned with your suggestions to question fifteen. I agree with your suggestion for question 16 as well. In order to do the plain language summary, you should look at clear signing, which is a newer standard in the Ethereum ecosystem. I agree with your suggestions to question 17. For question 18, I think the plain safe name is fine. For question 19, I'm not too concerned about the timing. I think all of this will move faster than you expect

---

## Claude

Looking into ERC-7730 clear signing: the Ethereum Foundation registry and Sourcify's TS library. Nearly done; the next round of questions follows.

Settled this round:

| Decision | Answer |
|---|---|
| Q12 opt-in capabilities | Accepted as proposed |
| Q13 token lists and balances | Accepted |
| Q14 chains, RPCs, code-hash check | Accepted, including refusing to sign on an unknown singleton |
| Q15 IPFS | The approach is right, but it's a **stretch goal**. Base path, gateway warning and backup/restore still go in because they're cheap. |
| Q16 co-signer flow and queue | Accepted. The plain-language summary should come from **clear signing (ERC-7730)** |
| Q17 safety rules | Accepted |
| Q18 name | **Plain Safe** (`plainsafe.eth`) |
| Q19 schedule | Timing isn't a concern. The priority order still decides what gets cut. |

**What I found on clear signing:**
- **Who runs it:** ERC-7730 v2 is the standard. Ledger handed the standard, its descriptor registry and its governance over to the Ethereum Foundation in May 2026 ([clearsigning.org](https://clearsigning.org/build/), [Ledger docs](https://developers.ledger.com/docs/clear-signing/overview)).
- **The registry** ([ethereum/clear-signing-erc7730-registry](https://github.com/ethereum/clear-signing-erc7730-registry)): 57 projects, about 1,100 JSON files, 5.7 MB. **Safe descriptors exist** for v1.3.0, v1.4.1 and v1.5.0, L2 editions included. They cover `execTransaction` (with the inner call decoded), add/remove/swap owner, change threshold, `approveHash`, and **an EIP-712 descriptor for the SafeTx itself**. There's also a generic ERC-20 descriptor.
- **Binding:** Safe's descriptors are tied to the **singleton** address on 7 chains. A call from a Safe to itself goes to the *proxy* address, so nothing matches unless we map the proxy to its singleton first. We already do that in the code-hash check.
- **Auditor attestations (ERC-8176):** auditors sign each descriptor with EAS. There are 174 attestations so far, all from one auditor (`0x3846…31f6`). Among Safe's descriptors, **only the SafeTx EIP-712 descriptor and SafeMigration are attested**. The `execTransaction` and owner-management descriptors are not.
- **Library** ([@ethereum-sourcify/clear-signing](https://github.com/sourcifyeth/clear-signing)): v0.2.2, MIT, and its only dependencies are `@noble/hashes` and `@noble/curves`. It only formats; it makes no RPC or token calls of its own. External data comes from hooks you provide: `resolveToken`, `resolveLocalName`, `resolveEnsName`, and a `chainClient` for checking revocations. **By default it downloads descriptors from GitHub**, but you can give it a custom resolver backed by a bundled copy. It also takes a `trustedTokens` map that renders ERC-20 and ERC-721 calls for any token you list, which fits our token lists exactly. The README says unattested descriptors are for "testing only."

---

❓ **Q20** - **Where do descriptors come from?**
- **(A) A bundled copy of the registry, pinned to one commit.** It's code-split, so each descriptor loads from the app's own files only when needed. The About page shows the registry commit.
- **(B) Descriptors the user imports:** drag in a JSON file for your own protocol. It's saved locally and labeled "user-supplied."
- **(C) "Refresh from the registry,"** a new opt-in capability that contacts GitHub.

➡️ **A and B for the weekend. C after.** A copy pinned to a commit also blocks registry-poisoning attacks: a new descriptor only reaches users through a release, not silently in the middle of a session.

---

❓ **Q21** - **How far to trust each kind of rendering.** Proposed levels, shown as a badge on the review screen:
1. **Clear signing ✓ reviewed:** the descriptor has a valid attestation from an auditor you trust. Revocation is checked through the Mainnet RPC. With no Mainnet RPC configured, it shows "revocation not checked."
2. **Clear signing, not reviewed:** a registry descriptor with no attestation, or one the user supplied. The intent sentence is still shown, labeled clearly.
3. **Decoded:** a known ABI (bundled, user-supplied or from Sourcify) but no descriptor. Shows the function name and arguments.
4. **Guessed:** only a match in the signature database.
5. **Unverified raw bytes**

Two firm rules:
- **The Q17 safety banners never read descriptor text.** Delegatecall, owner changes and refund fields are worked out from the decoded call itself. A poisoned descriptor can make the summary lie, but it can't hide a warning.
- **Owner-change calls** always use our own ABI decoding and before → after view, whatever a descriptor says.

➡️ These five levels and both rules. The trusted auditor list starts with the auditor listed in the registry's `auditors/` folder and can be edited in Settings.

---

❓ **Q22** - **Use the Sourcify library, or write our own formatter?**

Wiring the library in would look like this:
- **Descriptors:** a custom resolver over the bundled copy. It handles calls from a Safe to itself by mapping the proxy address to the Safe descriptor for the checked version, on any chain.
- **`resolveToken`:** token lists first. Tokens not in any list are read over RPC and marked "not in your lists."
- **`trustedTokens`:** built from the token lists you've turned on.
- **`resolveLocalName`:** the address book (see Q23). **`resolveEnsName`:** ENS over RPC with CCIP-read off.
- **Rendering order:** first run `formatTypedData` on the full SafeTx, whose attested descriptor also renders the inner call. If that doesn't resolve, fall back to `format()` on the inner call, then to plain ABI decoding.

➡️ **Use the library.** Its dependencies overlap with viem's, and it keeps us current with the standard. It is v0.2.2, but plain ABI decoding (level 3) is needed anyway, so if the library breaks, we lose a rendering level, not the flow.

---

❓ **Q23** - **Address book and labels.** The library's `resolveLocalName` needs one, and signers should see "Alice (Ledger)" instead of `0x71C…`.
- **Scope:** entries are keyed by (chain, address), plus "all chains" entries. Owners of saved Safes can be labeled from the Safe page. The address book is part of Back up / Restore.
- **Labels are never taken from a shared package.** Otherwise an attacker could send a package labeling their own address "Treasury."

➡️ Both. It's local only, and a package carries no labels, only the transaction and signatures.

---

❓ **Q24** - **Loose ends.** Each has a default:
- **(a) Signing method:** only `eth_signTypedData_v4`, with no `eth_sign` fallback. The `approveHash` option (P1) covers wallets that can't sign typed data.
- **(b) Phones:** co-signers will open links in Telegram or Signal on their phone. The layout should work on a phone for reading and checking. Signing works inside a wallet's built-in browser (MetaMask or Rabby mobile), which injects a provider just like the extensions do.
- **(c) Registering `plainsafe.eth`:** do it before the event. It isn't code, so it's allowed, and nobody can take it. Having a Safe own it can come later.
- **(d) Repo:** a public GitHub repo such as `gskril/plainsafe`. The first commit on Friday 21:00 JST adds `SPEC.md`. The README includes an **AI usage** section, which ETHGlobal requires, and this spec session goes in `docs/` as a planning artifact.
- **(e) Pinning service:** decided if and when the IPFS stretch goal happens. The CID script works without one.

➡️ All five defaults.

---

## Greg (6)

On question twenty, I don't really have enough context to answer this question, so I'll go with your recommendation

Same thing for question twenty-one

For question 22, using the library is fine. Maybe whatsabi library overlaps here? I know that's good too. Don't have to use it.

23 - agree
24- agree all, though first commit should be anytime after that, doesn't have to be exactly then. Pinning service would use omnipin via filecoin i guess, or one of the other suggested providers from omnipin. Could run in github workflow

I'm going to bed for now. We can resume this in the morning

---

## Claude

Sleep well. I've saved the project context to memory so a new session can pick it up.

Settled:
- **Q20 and Q21:** my recommendations. The registry copy and your own imported descriptors ship; refreshing from GitHub comes later. The five trust levels go in, and safety banners never read descriptor text.
- **Q22:** use the Sourcify clear-signing library.
- **Q23:** local address book only; packages never carry labels.
- **Q24:** all five defaults, except the first commit can be any time after Friday 21:00. Pinning is done with omnipin from a GitHub workflow.

What I found on whatsabi and omnipin:
- **whatsabi** is v0.29, MIT, with one dependency, `ox`, which viem is built on. It overlaps with the clear-signing library less than you might think; they do different jobs:
  - Offline it can list the function selectors present in a contract's bytecode, and it can follow proxies to their implementation over RPC.
  - Its Sourcify, 4byte and OpenChain lookups are optional and can be switched off.
- **omnipin** is v3.1, MIT. It pins a site to several IPFS or Swarm providers at once, updates ENS through a Safe, and is built for CI.

Three last questions:

---

❓ **Q25** - **What would whatsabi do?** Proposed jobs, none on the critical path:
1. **Sanity checks on the review screen, using only the RPC:**
   - "Target has no code (an EOA)" when the transaction carries calldata.
   - "Function `0xa9059cbb` isn't in the target's bytecode."
   - "Target is an upgradeable proxy → implementation `0x…`"
2. **Following proxies**, so an opt-in Sourcify lookup gets the *implementation's* ABI.
3. **Its Sourcify and 4byte lookups** power the opt-in capabilities from Q12, instead of writing that fetch code ourselves.

➡️ All three. Job 1 is a cheap and genuinely useful check of the kind that caught nothing at Bybit because nobody looked. If time runs short, drop whatsabi entirely; clear signing plus plain ABI decoding still covers the flow.

---

❓ **Q26** - **Should the network log also block requests?** The network log (Q12) records every request. Enforcing means wrapping `fetch` and WebSocket globally: any host that isn't the configured RPC or an enabled capability is **blocked and logged as blocked**. It's backed by a CSP meta tag that restricts where scripts can load from. This catches dependencies that quietly call home. For example, the clear-signing library's default GitHub resolver or a wagmi connector would show up as a red "blocked" entry instead of slipping through.

➡️ **Enforce.** It's about the same amount of code as logging only, and it turns the product's promise from a convention into something the code guarantees.

---

❓ **Q27** - **Release workflow.** On each tag `v*`, GitHub Actions would:
1. Run `bun install --frozen-lockfile` and build.
2. Compute the CID with our own script.
3. Run `omnipin` to pin to at least 2 providers, and fail if its CID doesn't match ours.
4. Publish the CID and `dist.zip` in the GitHub release.

Provider tokens live in GitHub secrets. The **ENS contenthash is updated by hand** until `plainsafe.eth` is registered and owned by a Safe. I haven't checked how omnipin's Safe flow works (it may use the Safe Transaction Service), so I'll look into it when we get to that step.

➡️ This workflow. It's a stretch goal like the rest of the IPFS work.

---

**Defaults I'll write into the spec unless you object:**
- **Explorer links:** each chain's config has a block explorer URL. Links only; the app never fetches from it.
- **Proposer notes:** a package can carry a free-text `note`, always shown as "Proposer's note (unverified)."
- **Contract-call builder:** takes pasted ABI JSON; bundled ABIs for ERC-20, ERC-721, ERC-1155, Safe, MultiSend and WETH; Sourcify when enabled; or raw calldata.
- **RPC errors:** show the endpoint and the error with a retry button. Never fall back to a different RPC silently.
- **Old packages:** executed and replaced packages stay in the queue history until you delete them.
- **Tests:** Vitest for hashing, signature checks, package encode/decode, and the safety rules. The end-to-end check is done by hand on Sepolia with two owners; no Playwright this weekend.
- **Theme:** follows the system light/dark setting.

Once you've answered these, every decision is made. I'll then show you the full spec to confirm and write `SPEC.md` into `local-safe/`.

---

## Greg (7)

25 - all. basically anywhere we have calldata/abi stuff, whatsbi should be used. creating custom transactions, viewing proposed transactions, reviewing execution, etc

26 - yes, build this on top of react query if possible to keep all requests clean and consistent. you can also use effect.ts if it helps keep code clean

27 - yep sounds good

additionally - use publicnode as the default RPC, though let a user set a custom one during the setup screen before importing a Safe and making any requests. use Effect.ts to manage code if it makes sense and helps keep things clean. Theme should follow css media queries, doesn't need a toggle

---

## Claude

Settled:
- **Q25:** whatsabi is used anywhere calldata or ABIs appear: building custom transactions, viewing proposed ones, and reviewing before execution.
- **Q26:** enforce the network rule, with requests organized around React Query. Effect.ts is fine where it helps.
- **Q27:** release workflow as proposed.
- **Default RPC:** publicnode. I checked both endpoints: `ethereum-rpc.publicnode.com` returns chain `0x1` and `ethereum-sepolia-rpc.publicnode.com` returns `0xaa36a7`, and both send `access-control-allow-origin: *`. A setup screen comes before anything else.
- **Theme:** follows `prefers-color-scheme`, no toggle.

One finding: **publicnode's free tier refuses historical queries.** `eth_getLogs` 1,000 blocks back works; 50,000 back returns "Archive requests require a personal token." Nothing in P0 is affected, since it all reads current state and the queue works from the nonce. It does affect transaction history (P2) and figuring out *which* transaction used a nonce.

Four last questions:

---

❓ **Q28** - **How the network rule and React Query fit together.** React Query can't enforce the rule by itself. viem transports, whatsabi and the clear-signing library all call `fetch` directly, underneath React Query. So I'd split it into two layers:
1. **`netguard`** is about 100 lines of plain TS, installed in `main.ts` before any other code runs.
   - It wraps `fetch` and `WebSocket` and allows only the configured RPCs and enabled capabilities.
   - Every attempt is logged: host, JSON-RPC method, which part of the app made it, and whether it was allowed, **blocked** or failed.
   - The log is an in-memory store the UI reads through `useSyncExternalStore`. It's a stream of events, not server data, so it doesn't belong in React Query.
2. **React Query is the only way the app reads data.**
   - Every read is a query hook with one key convention: `['safe', chainId, address]`, `['balances', chainId, safe]`, `['abi', chainId, address]`, `['descriptor', …]`, `['simulation', safeTxHash]`.
   - Query functions are the only code that calls viem, whatsabi or the clear-signing library.
   - wagmi is used **only for the wallet**: connecting, `signTypedData`, sending the execute transaction. All reads go through our own hooks on viem clients.
   - Changing an RPC or a capability invalidates the affected queries.

➡️ This split. The guard enforces the rule, and React Query keeps every request consistent.

---

❓ **Q29** - **How much Effect.ts?** Your global instructions say to ask before adding abstraction layers, so here's the proposed boundary:
- **Use Effect Schema** to decode *every* piece of untrusted input: packages and link payloads, token lists, user ABIs, descriptors, backup files, and saved settings. One tool, with good error messages. It replaces hand-written validation.
- **Use Effect** for the pipeline where failures must be told apart, because the UI shows each one differently:
  - loading and verifying a Safe: `RpcError`, `NotAContract`, `UnknownSingleton`, `UnsupportedVersion`
  - importing a package: `HashMismatch`, `SignerNotOwner`, `WrongSafe`, `StaleNonce`
  - executing: simulation and gas estimation
  
  Services would be few (Rpc, Storage, Abi, Descriptors), run through one `ManagedRuntime` that query functions call.
- **Don't use Effect for:**
  - pure functions (hashing, encoding, safety rules), which stay plain TS
  - React components
  - `netguard`

➡️ This scope. If Effect slows you down over the weekend, pull back to Schema only; the pipeline turns into async functions that return tagged errors.

---

❓ **Q30** - **First-run setup, including arriving through a link.** No request leaves the browser until setup is done.
- **Setup screen:**
  - The product's promise in one sentence.
  - Mainnet and Sepolia RPCs, prefilled with publicnode and editable, each with a **Test** button (`eth_chainId`, the first request, made on purpose).
  - A "Use my wallet's RPC" option.
  - A folded "Optional network access" section with every capability off.
  - A **Continue** button that leads to adding a Safe.
- **Custom chains:** adding a Safe on a chain with no RPC set asks for that chain's RPC inline. Custom chains get no default.
- **Opening a shared link first, before setup:**
  - The package is decoded and validated, and its **hashes computed offline**. Hashing needs only the chain ID, Safe address and version, all taken from the package.
  - Signatures are recovered offline as well: "signed by `0xabc…` (not yet confirmed as owner)".
  - A banner says "Not yet checked against the chain."
  - Then RPC setup, then the full on-chain check.

➡️ This flow. A co-signer sees the hashes before *any* request happens, which is a nice property in itself.

---

❓ **Q31** - **Simulation.** This came up from your "reviewing execution" point and hasn't been discussed. Everything here works over RPC alone:
- **Before signing:** Safe's `simulateAndRevert` (built into every Safe from 1.3.0 on) runs the transaction through `SimulateTxAccessor` in a single `eth_call`. It reports "would succeed right now," or "reverts: \<reason\>," plus gas used. It works for delegatecall too. The accessor address comes from `safe-deployments` and is checked by code hash; on chains without one, it shows "simulation unavailable."
- **Before executing:** `eth_estimateGas` on the real `execTransaction` with the collected signatures. Safe's error codes (`GS013`, `GS026`, …) are translated into plain language.
- **Not included:** previews of balance changes. Those need `debug_traceCall` or state diffs, which public RPCs don't offer.

➡️ Both, in P0. Each is roughly one query hook, and "will this revert?" is the question signers most often can't answer today.

---

That's the last branch I can see. After your answers I'll write up the full spec for a final confirmation, then write `SPEC.md` into `local-safe/`.

---

## Greg (8)

28 - sure that works
29 - honestly speaking, i've never used effect.ts before but see it get a lot of praise online from developers i trust. so i defer to you on how much to use it, but generally i err on the side of yes
30 - sounds good
31 - both is good. ideally also RPC simulation if the URL supports it. i assume there is a way to test this? it should be displayed yes or gracefully fallback if not. maybe add a warning if its not available, but i guess this depends on how common it is in public RPCs today. if not common, simply hide when its not available. if it is common, give a warning when a simulation isn't available but never an error unless simulation is available and it expects the transaction to fail.

---

## Claude

Settled:
- **Q28:** the split as proposed.
- **Q30:** setup flow as proposed.
- **Q29:** you left it to me, leaning yes. My decision is below.
- **Q31:** both, plus richer RPC-based simulation where the endpoint supports it. How common that is decides whether a missing simulation gets a warning, so I tested 12 public RPCs:

| RPC | `eth_simulateV1` | `eth_call` with state overrides | `debug_traceCall` |
|---|---|---|---|
| publicnode Mainnet (default) | ✅ | ✅ | ❌ |
| publicnode Sepolia (default) | ✅ | ✅ | ❌ |
| drpc (Mainnet) | ✅ | ✅ | ✅ |
| 1rpc | ✅ | ✅ | ❌ |
| MEV Blocker | ✅ | ✅ | ❌ |
| Flashbots, Cloudflare | ❌ | ❌ | ❌ |

eth.merkle.io and Tenderly's public gateway hit rate limits on the simulation probe, though both handled state overrides. llamarpc and rpc.sepolia.org returned web pages instead of RPC responses. drpc's free plan doesn't cover Sepolia.

**Result:** `eth_simulateV1` is common and supported by the default RPC; tracing is rare. So by your rule, a missing simulation gets a **warning**. An **error** appears only when a simulation actually ran and predicts failure.

**Simulation design:**
- **Level 1, `eth_simulateV1`** (through viem's `simulateBlocks`):
  - It simulates the real `execTransaction` with **state overrides**: threshold set to 1, nonce set to the transaction's nonce, and the call sent from one owner using the pre-validated signature form.
  - That means it works **before anyone has signed**, and for delegatecall and MultiSend too.
  - With `traceTransfers` on, it returns success or revert, gas, decoded events, and **balance changes**: ERC-20, ERC-721 and ERC-1155 transfers plus native ETH.
- **Level 2, `simulateAndRevert`:** success or revert plus gas only, over a plain `eth_call`.
- **Level 3, none:** a yellow warning, "Your RPC can't simulate transactions."
- **Checking support:** probe once per RPC URL (the setup screen's Test button, otherwise the first time it's needed) and remember the result. "Method not found" or "not allowed" means unsupported. Rate limits and timeouts count as temporary: retry, and show a warning meanwhile.
- **Display:** success is green with balance changes, labeled "as of block N." Unavailable is yellow. Red appears only for a predicted failure, with the decoded reason.
- **P1:** simulating the whole queue (nonce N, N+1, …) in a single `simulateV1` call.

**My decision on Effect (Q29):**
- **Use Effect for:**
  - Schema for all untrusted input and saved settings.
  - The pipeline as Effect programs with `Data.TaggedError` errors: loading and verifying a Safe, importing, merging and checking packages, the simulation fallbacks (`Effect.orElse`), checking RPC support, loading token lists, and the ABI fallback chain.
  - Services via `Layer`: Rpc, Storage, Abi (whatsabi), Descriptors, TokenLists. One `ManagedRuntime`; each React Query function is `runtime.runPromise(program)`.
- **Don't use Effect for:** pure functions (hashing, encoding, safety rules), which stay plain TS and are easy to test; components; or `netguard`.
- **Guardrail:** stick to a small subset (`Effect.gen`, Schema, `TaggedError`, `Context.Tag` with `Layer`, `ManagedRuntime`, `catchTag`/`orElse`, `retry` with `Schedule`), and look up Effect's docs through Context7 while building.

---

Every decision is made now. Here's the spec as it will go into `SPEC.md`:

**1. Product.** Plain Safe (`plainsafe.eth`), MIT. A static, local-first Safe interface. By default the only outbound request is the RPC you chose. It's built solo at ETHGlobal Tokyo on the From Scratch track, as a product in its own right; the RFP is only a reference.

**2. Scope**
- **P0:**
  - First-run setup.
  - Add a Safe on any chain, with the code-hash check.
  - Builder presets: send ETH or ERC-20, contract call via whatsabi or raw calldata, owner and threshold changes.
  - Review screen: clear signing, five rendering levels, safety banners, whatsabi checks, simulation.
  - Signing with `signTypedData_v4`.
  - Package as file, link or code; import, check and merge.
  - Execute with gas estimate and translated Safe error codes.
  - Queue per Safe; Verify page; token lists and balances.
  - Opt-in capabilities, and a network guard that blocks and logs.
  - Address book; backup and restore; gateway warning.
- **P1, optional:** `approveHash`, MultiSend batches, ENS display and input, chained queue simulation.
- **Stretch:** reproducible IPFS build, omnipin workflow, ENS contenthash updated through a Safe.
- **Out:** Safes owned by other Safes, a CLI, direct hardware-wallet support, WalletConnect, prices, NFTs, creating Safes, history built from event logs.

**3. Stack**
- Vite, React, TS, Bun, Biome, Tailwind v4 with shadcn, wouter with hash routing.
- TanStack Query, viem, and wagmi for the wallet only.
- Effect, as scoped above.
- whatsabi, and `@ethereum-sourcify/clear-signing` with a bundled registry copy pinned to a commit.
- Vitest. Theme follows `prefers-color-scheme`.

**4. Network.**
- `netguard` wraps `fetch` and `WebSocket` and allows only the configured RPCs and enabled capabilities; everything else is blocked and logged.
- Nothing is sent until setup is done. publicnode is the default and can be edited.
- CCIP-read is off.
- Opt-in capabilities: token lists by URL, token logos, Sourcify, the signature database, ENS off-chain lookups.

**5. Safe support.** v1.3.0 and later, L1, L2 and zkSync variants. The proxy and singleton code hashes are compared against `safe-deployments`. An unknown singleton is shown read-only and signing is refused. Any chain works through its chain ID and RPC.

**6. Review screen**
- **Rendering levels:** clear signing reviewed, clear signing not reviewed, decoded, guessed, raw bytes.
- **Safety rules** (never read from descriptors): delegatecall, owner changes shown before → after, calldata that can't be decoded, refund fields, nonce.
- **whatsabi checks:** target has no code, function not in bytecode, target is a proxy.
- **Always visible:** the three hashes and simulation.

**7. Packages.** Versioned JSON: chain ID, Safe, version, transaction, hashes, signatures, and an optional note shown as unverified. Links use `#/import/<base64url(deflate)>`, with a file suggested above 4 KB. No labels and no encryption. Imports recompute every hash and check every signature against current owners.

**8. Data.** Stored in `localStorage` and decoded with Schema: settings, Safes and recent Safes, queue, token lists, "My tokens", address book, user-supplied descriptors and ABIs, and the cache of which RPCs support what. All of it can be backed up and restored.

**9. Tests.** Vitest covers hashing against published examples (v1.3.0 and v1.4.1, both chains), signature recovery, package round-trips and the safety rules. End-to-end testing is by hand on Sepolia with two owners.

**10. Repo.** Public `gskril/plainsafe`. The first commit comes after Friday 21:00 JST and adds `SPEC.md`. The README has an AI-usage section, and this session goes in `docs/`.

Does this match what you have in mind? Once you confirm, I'll write the full `SPEC.md`, with every decision above and the reasoning behind it, into `local-safe/`, and export this conversation to `docs/` as the planning record.

---

## Greg (9)

do you have a plan for transaction history? maybe we can use a simple indexer if the user enables the feature? https://github.com/1001-digital/simple-indexer

or maybe a more naive custom implementation? or is this a lot of work and out of scope?

---

## Claude

I tested how much historical log access public RPCs give and went through the simple-indexer repo. Here's where transaction history stands.

**The current plan** left on-chain history out (P2). The only history was the local queue, whose packages turn "nonce used (executed or replaced)" once the Safe's nonce passes them. That costs zero requests.

**What I found:**
- **The default RPC can't do it.** publicnode rejects every historical `eth_getLogs` ("Archive requests require a personal token"), even a 10,000-block range.
- **Other public RPCs, querying one Safe's logs:**

  | RPC | Largest historical range |
  |---|---|
  | MEV Blocker | **1M blocks** worked (58 logs); a query from genesis to latest didn't |
  | drpc | 10,000 blocks on the free plan |
  | 1rpc | 50 blocks, which is useless |
  | merkle | rate-limited |

  A Mainnet Safe created in 2021 is about 13.5M blocks back. That's roughly 14 requests on MEV Blocker, or about 1,350 on drpc.
- **Reconstructing the details** from logs alone depends on the Safe:
  - **L2 Safes** emit `SafeMultiSigTransaction` with every parameter and signature, so their history is complete.
  - **L1 Safes** (most Mainnet Safes) only emit `ExecutionSuccess` with the safeTxHash. To get details you fetch the transaction and decode its input, which works when an account called `execTransaction` directly. If it went through a relayer, another Safe or a multicall, you'd need tracing, which almost no public RPC offers.
- **simple-indexer** ([repo](https://github.com/1001-digital/simple-indexer)) fits well technically:
  - Browser-first, stores in IndexedDB, viem as its only peer dependency, MIT, about 2,800 lines.
  - Adjusts the block range per request on its own (doubling on success, shrinking on errors), which matters when RPC limits range from 50 blocks to 1M.
  - Handles reorgs and resumes backfills where it left off.
  - Can filter by event arguments.
  
  The catch: it's **v0.1.0 and not published on npm**. Its package points to a `dist/` folder that isn't committed, so installing from GitHub won't work. You'd copy it into the repo or alias its `src/` in Vite.

**Is it a lot of work?** It's moderate, about half a day. The indexing is the easy part, especially with simple-indexer. The real work is decoding L1 transaction details and the "which RPC can even do this" UX.

---

❓ **Q32** - **Where does history land in scope?**
- **Local history, P0 and free:** the queue already knows every package you've seen. When the app executes one, it records the transaction hash, so that package is shown as **executed** rather than "nonce used."
- **On-chain history, P1 and opt-in per Safe:** the Safe's own events, built by an indexer.
- **Token transfer history, P2:** `Transfer` events to or from the Safe for every token in your lists. This multiplies the requests and runs into RPC caps on long address lists.

➡️ This split. On-chain history is the **first P1 item**, since it's the most visible gap compared with Safe{Wallet}.

---

❓ **Q33** - **simple-indexer, or a custom implementation?**
- **simple-indexer:** adaptive ranges, IndexedDB, reorgs, resuming and filtering come built in. You'd copy it into `vendor/simple-indexer` with its MIT license and pin the commit (the Classic track allows open-source libraries if you're transparent). Or ask 1001-digital to publish it; you may know them.
- **Custom:** about 200 lines of Effect. Sync only up to the **finalized** block, so reorgs never come up. Adaptive chunking falls out of `retry`/`Schedule`, and you store a cursor per Safe in IndexedDB. You'd have less code overall, but you'd be solving problems that have already been solved.

➡️ **simple-indexer, copied into the repo.** Two settings matter: `finalityDepth: 64` (about finalized on Mainnet) and syncing **only while the History view is open**, so it doesn't keep polling the RPC in the background.

---

❓ **Q34** - **Which RPC does history use?** Since the default can't do it:
- **(A)** An optional **"History RPC" for each chain** in Settings. The main RPC stays the default and history uses this one. It's still an RPC you chose, so the network rule is unchanged.
- **(B)** Only the main RPC. If it can't serve historical logs, history is unavailable.

In both cases, when you turn history on, the app checks with one historical `eth_getLogs` call. If the RPC can't, it says "History needs an RPC with historical log access" and offers a History RPC field, suggesting MEV Blocker or a paid provider as examples.

➡️ **A.** Someone who wants history can add an Alchemy key or their own node without routing every other request through it.

---

❓ **Q35** - **What history shows and where the details come from**
- **Events,** all filtered by the Safe's address:
  - executions: `ExecutionSuccess`/`Failure` and the module versions
  - incoming ETH: `SafeReceived`
  - owners and threshold: `AddedOwner`, `RemovedOwner`, `ChangedThreshold`
  - modules, guard and fallback handler
  - `ApproveHash`, `SignMsg`, and `SafeSetup` (creation)
- **Details of an executed multisig transaction,** tried in order:
  1. The L2 event.
  2. Decode the transaction that carried it, if it called `execTransaction` directly, and **check that the recomputed safeTxHash matches the event**.
  3. A local package with the same hash.
  4. "Executed via another contract. Details need tracing." Show the safeTxHash and transaction hash.
  
  Every recovered transaction goes through the same review renderer (clear signing, whatsabi) as a new one.
- **Start block:** the block where that Safe version's singleton was deployed, bundled for Mainnet and Sepolia, since no Safe can predate its singleton; custom chains start at 0. The user can type the Safe's creation block to skip ahead, and a progress bar shows the backfill.
- **Storage:** the history index is left out of Backup/Restore because it can be rebuilt.

➡️ All of the above.

---

## Greg (10)

you can also try https://evm.stupidtech.net/ RPC

32 - token transfers are definitely out of scope. Lets to local history to start, and add a part of the app for onchain history but mark the setting as "coming soon" for now. Still write a plan of how to implement it in the spec

33- simple-indexer is good for me, either gitsubmodule or just copy paste with a reference in a readme.md

34 - B

35 - all

going away now

---

## Claude

evm.stupidtech.net turned out to be a good find, with some caveats (details at the end). Since you're away, I've turned everything into a **draft spec** you can review when you're back.

The draft spec is ready for review: [SPEC.md](SPEC.md). It holds every decision from this session and the reasoning behind each.

**History decisions recorded:**
- Token transfer history is out of scope.
- Local history ships this weekend.
- On-chain history appears in the app as "coming soon," and §11 has the full plan for building it. It uses the chain's main RPC only; if that RPC can't serve historical logs, history is unavailable.
- simple-indexer gets copied into `vendor/`, with its source commit noted in a README. A git submodule wouldn't avoid anything: the repo doesn't commit its `dist/` folder, so we'd still have to point Vite at its source files either way.

**evm.stupidtech.net test results:**
- **Good:** it works for any chain at `/v1/<chainId>`, allows browser requests, supports `eth_simulateV1`, and even supports `debug_traceCall`.
- **Catch:** each request goes to whichever of 5 random public providers answers first, so results vary. The same historical log query returned 58 logs once and an error the next time. One Sepolia call came back with an error from a provider that no longer exists ("Blast API is no longer available").
- **Limit:** 60 requests per minute per IP.

**Two things I need from you:**
1. **Default RPC for other chains** (§17). I suggest not prefilling stupidtech. Instead, the custom-chain form would offer it as a one-click "Use evm.stupidtech.net/v1/<chainId>" button with a note on how it works. The spec currently assumes that answer.
2. **A final OK on the spec.** Change anything you like, either in the file or here.

When the repo exists on Friday, I'll export this conversation into `docs/planning/`, since ETHGlobal wants planning artifacts committed.

---

## Greg (11)

can you check if <personal RPC URL, redacted> works

---

## Claude

It works as an RPC, but **a browser page can't call it**, so Plain Safe couldn't use it as things stand.

| Check | Result |
|---|---|
| `eth_chainId` / `eth_blockNumber` | ✅ Mainnet (`0x1`), at the current block |
| Batched requests | ✅ |
| `eth_simulateV1` | ✅ |
| `eth_call` with state overrides | ✅ |
| `debug_traceCall` | ❌ Method not found |
| Historical `eth_getLogs` | ✅ up to **100,000 blocks** per request (1M is rejected with "max block range 100000") |
| Historical state (e.g. a balance at block 16M) | ❌ "state at block … is pruned" (full node, not archive) |
| **CORS** | ❌ **No `Access-Control-Allow-Origin` on responses, and the `OPTIONS` preflight returns 405** ("POST is required") |

**Why CORS matters:** a browser sends a preflight `OPTIONS` request before any `POST` with `Content-Type: application/json`, which is what viem sends. When that gets a 405, every request fails in the browser. It works from curl, and it would work as MetaMask's or Rabby's RPC, because extensions aren't subject to the page's CORS rules. So Plain Safe's "Use my wallet's RPC" mode would already work with it.

**The fix:** from the response headers it's served through Cloudflare, and the "POST is required" message suggests a Worker (I couldn't find its source under `~/Desktop/crypto`). If so, it needs to answer the preflight and add the CORS header to every response:

```ts
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
// …existing POST handling, then add `cors` to the response headers
```

**If you add CORS, it becomes the best RPC we've tested for Plain Safe.** It supports simulation, and its 100,000-block log ranges would make the on-chain history plan (§11) practical. A backfill from 2021 would take about 135 requests; publicnode can't do it at all. The history plan doesn't need archive state, since it only reads logs and transactions.

The path includes `<redacted>`, which looks like it might be an access key. If it is, keep in mind that anything entered as an RPC in Plain Safe ends up in your backup file.

---

## Greg (12)

Yeah, this would just be my specific RPC. It shouldn't be a default in the app for everyone on GitHub. I see it doesn't work with historical state. Does it need to or are logs enough?

---

## Claude

Short answer: logs are enough. Let me check your node against the three things the history plan actually relies on.

Logs are enough, and historical state isn't needed at all. But more testing turned up a problem that changes what I said earlier: **your node only keeps about 6 days of logs.** So it couldn't power on-chain history either, even with CORS added.

**What Plain Safe needs from an RPC:**
- **The main app (P0) needs only recent state.** Every read happens at a block that's seconds or minutes old. Your node serves state 10,000 blocks back, which is plenty.
- **On-chain history needs logs** back to when the Safe was created, **plus old blocks or transactions** (to decode L1 Safe details). Historical state isn't needed: the owner list at any point can be rebuilt from the `SafeSetup`, `AddedOwner` and `RemovedOwner` logs.
- **Only out-of-scope features would need an archive node,** such as balances as of a past date.

**What your node keeps:**

| Data | How far back |
|---|---|
| State | ✅ 10,000 blocks; pruned at 100,000 |
| Old blocks and transaction lookup | ✅ at 1M blocks back |
| **Logs** | ⚠️ **only about 44,500 blocks (about 6 days)** |
| Anything before the Merge | ❌ `4444 pruned history unavailable` |

Beyond that 6-day window, `eth_getLogs` returns an **empty array instead of an error**. USDT has transfers in almost every block, yet your node reported 0 logs 100,000 blocks back, while MEV Blocker reported 25 at 5M back. An indexer would take that at face value and show a Safe with no history.

I've updated [SPEC.md](SPEC.md) with what this showed:
- **§11:** the history plan no longer treats an empty result as proof of "no events." After every backfill it runs two checks:
  1. The Safe's creation event (`SafeSetup`) was found.
  2. The number of executions (`ExecutionSuccess` plus `ExecutionFailure`) equals the Safe's on-chain nonce.

  If either check fails, the app shows "History incomplete…" instead of a history that looks complete but isn't. These checks work on any chain and with any RPC. §11 also notes that Safes created before the Merge need an RPC that still keeps pre-Merge history.
- **§8.4:** pinned blocks are refreshed on every refetch and never used once they're more than about 100 blocks old, and the spec now states that nothing in P0 needs archive state.

Your RPC isn't mentioned anywhere in the spec, and none of these changes add it. With CORS added, you could enter it yourself on the setup screen. Until then it still works through your wallet, via "Use my wallet's RPC."

---

## Greg (13)

Does the MEV blocker RPC have a documented rate limit? If it's generous, then maybe we should just use that as a default

---

## Greg (14)

Also, does the simple indexer work from tip backwards or the other way around? I think it'd be more efficient if it starts from tip so that we can stop once we reach a transaction versus starting at Genesis

---

## Claude

Two answers, then two quick decisions.

**MEV Blocker rate limit: not documented.** Its [docs](https://docs.mevblocker.io/) and [endpoint reference](https://docs.mevblocker.io/reference/api/transaction-endpoints) only cover *sending* transactions: the `/fast`, `/noreverts` and `/fullprivacy` endpoints and so on. They say nothing about reads, rate limits, logging or terms. What I measured:
- **Burst test:** 120 requests from 12 parallel connections gave **119 successes and 1 timeout, with no 429s** (22 seconds end to end).
- **CORS:** ✅ it echoes the request's Origin back and answers the preflight.
- **Batched requests:** ✅
- **Historical logs:** ✅ complete, in 1M-block ranges.
- **No Sepolia.** Neither `sepolia.` nor `rpc-sepolia.mevblocker.io` responded.

**simple-indexer only scans forward,** from `startBlock` up to the chain head (with an optional `endBlock`). Your backwards idea is better for our case, for three reasons:
- **No start-block guess.** Walk down from the tip and **stop when the Safe's `SafeSetup` (creation) event turns up**. A forward scan has to start at the singleton's deploy block. For a 2024 Safe on the 1.3.0 singleton, that's about three years of empty chunks before the Safe even exists.
- **Recent activity first,** which is what people look at. It also allows "load more" paging, where the scan stops once a page is full.
- **Built-in progress:** the on-chain nonce says how many executions exist, so the UI can show "12 of 40 transactions loaded". The completeness check becomes "reached `SafeSetup` and found as many executions as the nonce."

One thing a backwards scan doesn't fix: on a node like yours, which returns empty arrays for pruned ranges, the scan never finds `SafeSetup`. So it still needs a floor (the singleton deploy block) and still ends with "History incomplete."

---

❓ **Q36** - **Should MEV Blocker be the default RPC?**
- **(A) Keep publicnode** as the default for Mainnet and Sepolia. Mention MEV Blocker in the "History incomplete / unavailable" message as an RPC known to keep full log history.
- **(B) Switch Mainnet to MEV Blocker** and keep publicnode for Sepolia.

➡️ **A.** MEV Blocker's only advantage is historical logs, and only the "coming soon" history feature uses them. It's a transaction-protection service first, with no published terms or limits for reads, so the read side could change without notice. publicnode covers everything P0 needs. Let's revisit when history is actually built. Ideally, ask the CoW/MEV Blocker team then whether a wallet UI can rely on their reads.

---

❓ **Q37** - **How should the backwards scan be built?**
- **(A) Our own backwards scanner, dropping simple-indexer.** About 150 lines of Effect:
  - Adaptive chunk sizes via `retry`/`Schedule`, walking down from the **finalized** block until it finds `SafeSetup`, fills a page, reaches the floor, or the RPC refuses.
  - Events stored per Safe in IndexedDB, with markers for how far down and up it has scanned.
  - On each open: scan forward from the last finalized block to the new one, then re-fetch the roughly 64-block unfinalized window at the tip. That window is re-read every time, so **no reorg bookkeeping is needed.**
- **(B) Hybrid:** a backwards pass to find the creation block, then simple-indexer scans forward from there. It's simple to wire up, but it reads the same range twice.
- **(C) Contribute a reverse mode to simple-indexer upstream.** Good for open source, but it adds more time to a feature that's already deferred.

➡️ **A.** The part simple-indexer does best, reorgs and polling at the tip, is exactly what "finalized plus re-fetching the tip window" makes unnecessary. What's left is small enough that copying the whole library in costs more than it saves. If you agree, I'll rewrite §11 around the backwards scanner and remove simple-indexer from the spec.

---

## Greg (15)

36- yes mev
37- A.  Note that it needs to handle the user leaving the browser tab during indexing. So maybe it should work in a background worker or whatever setup you think is most efficient. But I agree that building our own to work from the tip backwards is probably the best solution here.

---

## Claude

Almost done updating the spec: three small edits left (network guard in workers, tests, and follow-ups).

I've updated [SPEC.md](SPEC.md) with both decisions.

**Q36, MEV Blocker as the default:** I took "yes mev" to mean MEV Blocker becomes the **Mainnet** default. Sepolia stays on publicnode, because MEV Blocker has no Sepolia endpoint. Tell me if you meant only mentioning it as a suggestion.
- **Checked first:** it handles every read method Plain Safe uses, including reads at a specific block, gas estimation, receipts and the finalized block. It also returned pre-Merge logs and blocks.
- **Bonus:** on-chain history will work on Mainnet with the default RPC once it's built.
- **Follow-up in §17:** its read limits and logging policy aren't documented, so it's worth asking the CoW/MEV Blocker team before relying on it long-term. If they say no, only history is affected, and we'd go back to publicnode.

**Q37, a backwards scanner in a Web Worker (§11 rewritten, simple-indexer removed):**
- **Direction:** it walks down from the finalized block and stops at the Safe's creation event.
  - The chunk size adjusts to each RPC's range limits, and timeouts and rate limits are retried.
  - The last ~64–96 blocks above finalized are simply re-fetched on each refresh, so reorgs need no special handling.
- **Leaving the tab:** it runs in a **dedicated Web Worker**, so it keeps going when you switch views or put the tab in the background.
- **Closing the tab:** each chunk's events and a checkpoint are saved to IndexedDB together, so the scan **resumes where it left off** next time.
- **Several tabs:** a lock per Safe ensures only one tab scans it, and the other tabs see progress live.
- **Network rule:** a worker has its own `fetch`, so the network guard is installed inside it too and its entries show up in the same network log. Without that, the worker would get around the network rule. §8.1 now requires this for every worker.
- **Alternatives rejected:**
  - A SharedWorker isn't well supported on Android Chrome.
  - Browsers stop a Service Worker after a short idle period, so it can't run a long scan. On an IPFS gateway it could also intercept requests, which is a security risk.

Still open in §17:
1. **evm.stupidtech.net** as a one-click suggestion on the custom-chain form, not a prefilled default. That's my recommendation, and the spec assumes it for now.
2. **A final OK on the whole spec.** Once you confirm, every decision is made and it's ready for Friday.

---

## Greg (16)

1-yes
2-I don't have time to read the whole thing right now. Keep this one pending

---

## Claude

I've updated [SPEC.md](SPEC.md):
- **evm.stupidtech.net** is decided: it's offered as a one-click suggestion when adding a custom chain, not prefilled.
- **Your final read-through** is marked pending. The status line now calls the spec the working plan, with every design decision made.

Nothing else is open. When you have a few minutes, these sections cover most of what you'll build:
- **§2** Scope and priority
- **§3.7** What a co-signer sees when opening a link
- **§7.4** Safety rules
- **§16** Build order and cut order

When the repo exists on Friday, I'll export this conversation into `docs/planning/` to go alongside the spec.

---

## Greg (17)

reviewing now:

* is netguard a specific library you propose we use, or a custom implementation?
* uniswap has a prize for integrating any of their tech -  maybe we can integrate a native swap feature with them? but only if we can use an onchain price oracle - no API to generate calldata since that breaks the hard requirements https://ethglobal.com/events/tokyo2026/prizes/uniswap-foundation
* ENS resolution support should be P0 - agree with CCIP Read off by default since its blocked by netguard but we should have a way to enable it without adding each gateway to our network policy
* Everything in Stretch/Coming Soon should be moved to P1, i think we can be ambitious
* Prices and fiat values should be supported in P0 using onchain tools. I've done this in https://github.com/gskril/evm-portfolio before - use it for reference
* re 3.12 Settings > "ABI library" - i understand the benefit here but i'm imagining an edge case where this breaks or shows wrong data for upgradable contracts... do you have a plan for how to prevent issues here? if its unavoidable, maybe its safe to just not store ABI fragments locally? maybe i'm misunderstanding 
* re 4.2 through 6: i didn't research the details here but trust you to do so. do a double and triple check across Safe docs and code because this is very important
* re 7.2: how big is a copy of all clear signing outputs? i'm afraid thats large on disk or slow on IPFS. this app being somewhat minimal out of the box is important to me, even though i know it can get large once the user enables indexing and stuff
* where will token logos come from if the user opts into them? i feel like this isn't really worth it
* Re 8.4: MEV Blocker should be the mainnet default but we should have a note that encourages users to enter their own URL. maybe better to use stupidtech for all others chains? no reason to hardcode publicnode i think. Also in this point - we shouldn't need to hardcode a multicall3 contract address - this functionality is built into viem
* Re 9.5 - any downside to using indexedDB for token lists from the start if you suspect they might become an issue later?
* Re 12 - its ok to let it only work on subdomain-based IPFS gateways. thats stronger security and easier setup overall so lets do it
* Re 16 - security is important, we should have a bunfig rule to prevent packages newer than 2 days. Otherwise looks good

---

## Claude

Most of these are clear calls, so I'll apply them. A few need research first: evm-portfolio, the Uniswap on-chain quoting design, clear-signing size, and a proper check of the Safe internals against the contracts and real on-chain transactions. Starting with the research.

No response requested.

---

## Greg (18)

resume

---

## Claude

The only file in the project is still `SPEC.md`. Rather than cloning the whole Safe repo, I'm fetching just the relevant contract files.

Running the end-to-end Safe check against the three real Mainnet Safes now.

Still updating the spec: done with scope and setup, now the Safe internals, networking, prices and IPFS sections.

Updating the tokens and prices section, then history, IPFS, tests and build order.

I've updated [SPEC.md](SPEC.md) with your review. Answers first, then four questions.

**Answers**
- **netguard** is our own code (about 100 lines, no dependencies). It has to wrap `fetch` before any other code loads, and no library does that. The spec says this explicitly now.
- **Safe internals (§4.2–6):** I checked them three ways:
  - **Contract source:** read for v1.3.0, v1.4.1 and v1.5.0.
  - **`safe-deployments`:** compared against it.
  - **Live test:** ran against real Mainnet Safes (ENS Endowment on v1.3.0, plus one v1.4.1 L2 and one v1.5.0).
  
  **All 54 checks passed.** Our hashes match each Safe's own `getTransactionHash()`, the storage slots match, and the rest behaves as specced: test-key signatures, sort order, pre-validated simulation, `traceTransfers` and `simulateAndRevert`. The record is in §4.4, and the script becomes an integration test. It found three things the spec had wrong or missed:
  1. **`safe-deployments` has no code hashes for the proxies themselves.** I worked them out from each factory, including the older 1.0.0 and 1.1.1 proxies. Safes created long ago and upgraded later still use those, so the old spec would have **rejected many old treasuries**. The hashes are now listed in §4.2.
  2. **v1.5.0 no longer reverts with `GS013`** when the inner call fails; it passes that call's own error through instead. The error translation now handles both.
  3. **`ExecutionSuccess.txHash` is indexed from v1.4.1 on but not in v1.3.0.** History decoding needs to handle both.
- **Token logos:** removed. `img-src` in the CSP is back to `'self' data:`.

**Applied as you asked**
- **ENS in P0** (§8.5):
  - Names are shown next to the address and accepted in inputs.
  - Addresses are looked up for the Safe's own chain (`coinType`).
  - **CCIP-read is one toggle.** Gateway calls go through viem's custom `ccipRead.request`, tagged so `netguard` allows any HTTPS gateway for those calls only. Every gateway still shows in the network log.
- **Everything from Stretch and Coming soon is now P1.**
- **Prices and fiat in P0** (§10.1): the 1inch Spot Price Aggregator, the same way evm-portfolio does it, with USD and EUR from the USDC and EURC rates.
  - I checked it live on Mainnet: about 2,684.83 USDC per ETH, within 0.2% of Uniswap's v3 and v4 quoters.
  - **It isn't deployed on Sepolia, so there are no prices there.**
- **RPCs:**
  - MEV Blocker is the Mainnet default, with a note to use your own RPC.
  - `evm.stupidtech.net/v1/<chainId>` is the default for Sepolia and every other chain. publicnode is gone.
  - Multicall has no hardcoded address: chains known to viem include one, and other chains use viem's `deployless: true` (confirmed in viem 2.56).
- **IPFS:** subdomain gateways only. On a path gateway, the app refuses to start and links to the subdomain URL.
- **`bunfig.toml`:** `minimumReleaseAge = 172800` (the key and its unit, seconds, are confirmed in Bun's docs), plus a frozen lockfile in CI.

---

❓ **Q38** - **A native Uniswap swap.** It's possible without any Uniswap API, and I checked the key parts live:
- **Quotes:** Uniswap's own quoter contracts (v3 `QuoterV2`, v4 `V4Quoter`), called with `eth_call`. Both returned real quotes over MEV Blocker.
- **Route search:** direct pools at each standard fee tier (v4 pools without hooks only), plus two-hop routes through WETH or USDC. The best output wins.
- **Sanity check:** compare the quote with the 1inch spot price, and warn if they differ by more than about 2%.
- **Calldata:** built in the app with viem, for Universal Router (`0x66a9…`). **No Uniswap SDK**, since it depends on ethers v5.
- **From a Safe, a swap is a three-step batch:** `approve(Permit2)`, then `Permit2.approve(router)`, then `router.execute(…)`. So the swap needs **MultiSend**.
- **Multisig delay:** the quote gets older while signers sign.
  - The transaction locks in a minimum output of `quote × (1 − slippage)` (default 1%) and a deadline (default 24 hours). Both are editable.
  - At review and execution time, the app gets a fresh quote and shows "current quote vs. signed minimum." Simulation predicts a revert if the minimum can't be met.
- **Front-running:** when executing a swap, a hint suggests sending it through a private RPC in the wallet.
- **Clear signing:** the registry already has Uniswap descriptors, so our own swaps render as clear signing.
- **Prize:** the Classic track's Uniswap prize ($6k) needs a `FEEDBACK.md` and their feedback form. That's noted in §14.

➡️ **Build it as the first P1 item, together with MultiSend.** It's the most impressive P1 feature, but it depends on MultiSend, and the core signing flow has to be solid first.

---

❓ **Q39** - **ABI library and upgradeable contracts.** You're right: an ABI saved per *address* goes stale when the proxy is upgraded, and could decode new calldata with wrong names. The fix:
- **Save ABIs against the implementation's code hash, not the address.** whatsabi already follows proxies to the implementation, and reading that code is one `eth_getCode`.
- When rendering, a saved ABI is used **only if the current implementation's code hash still matches**. If it doesn't, show: *"This contract was upgraded since you saved this ABI."*
- Use only the functions whose selectors actually appear in the current bytecode.
- Sourcify ABIs are **never saved**; they stay in the in-memory query cache, keyed by code hash.
- **Alternative:** don't save ABIs at all, and paste one each time.

➡️ **Tie saved ABIs to code hashes.** It's a few lines on top of what whatsabi already gives us, and it removes the stale-ABI risk entirely.

---

❓ **Q40** - **Size of the clear-signing bundle.** Measured at registry commit `7378786`:

| Part | Size |
|---|---|
| Whole repo | 5.7 MB (1.8 MB is test fixtures) |
| Descriptors only | 1.05 MB in 399 files (about 92 KB gzipped) |
| Attestations | 322 KB in 174 files |
| Index files | 236 KB (30 KB gzipped) |
| **Safe's own descriptors and attestations** | **95 KB (7 KB gzipped)** |

- **(A)** Bundle all descriptors, attestations and the index: about 1.6 MB, loaded lazily, so the initial load doesn't change.
- **(B)** Bundle only Safe's descriptors. The clear-signing library already has built-in ERC-20 and ERC-721 templates, so your listed tokens still render clearly. Other protocols fall back to ABI decoding or descriptors you import.
- **(C)** B, plus an opt-in capability that fetches any other descriptor from GitHub at the pinned commit. Each download is checked against a bundled table of SHA-256 hashes (about 40 KB), so GitHub can't change what we render.

➡️ **C.** It stays minimal by default (about 135 KB), and full clear signing is one toggle away without trusting GitHub. If time is short this weekend, ship B first; C only adds to it.

---

❓ **Q41** - **IndexedDB from the start?** There's no real downside:
- It's asynchronous, but every read already goes through Effect and React Query.
- It needs a small wrapper, such as `idb-keyval` (about 600 bytes).
- Private browsing supports it in current Safari and Firefox.

And it has **one strong upside:** `localStorage` doesn't exist in Web Workers, and the history worker needs storage.

➡️ **IndexedDB for all app data,** behind one Storage service, not only token lists. After setup, call `navigator.storage.persist()` so the browser is less likely to clear it.

---

## Greg (19)

> I checked it live on Mainnet: about 2,684.83 USDC per ETH, within 0.2% of Uniswap's v3 and v4 quoters.

would you recommend we use 1inch or uniswap for erc20 quotes? i assumed 1inch is more accurate since its an aggregator but maybe not worth the extra dependency? i trust your judgement here

---

## Claude

Use both, each for a different job: **1inch for the prices you display, and Uniswap for swap quotes.**

**Why 1inch for display prices:**
- **One call per token**, which fits into the same multicall as the balances.
- **It covers more tokens.** I checked the contract on Mainnet: it averages across 14 DEX price sources (Uniswap, Curve, Balancer and others), weighted by liquidity, and routes through 8 common tokens automatically. That covers tokens whose liquidity isn't on Uniswap, like Curve stablecoins, liquid staking tokens and Balancer pools.
- **It adds no real dependency:** a contract address and a one-function ABI, no npm package.

**Why not Uniswap for display prices:** Uniswap's quoters answer a different question: "what exact amount would I get for *this* size on *this* route." Pricing a whole portfolio that way needs a route search across fee tiers and hops, which means many heavy `eth_call`s per token. That would quickly hit stupidtech's 60-requests-per-minute limit, and it still misses tokens without Uniswap liquidity. For the value of a holding, a spot price is the right measure anyway.

**For swaps, the Uniswap quote is the only one that counts,** since it's what gets executed. The 1inch price then serves as an independent check: if the two disagree, the Uniswap pool might be manipulated.

**One thing I found while checking:** the aggregator's owner is a regular wallet address (`0x56E4…6dcF`), not a multisig or timelock, and it can add or remove price sources. That's acceptable because these prices are display-only and never feed a safety decision. It's also a good reason to keep it that way.

I've added this reasoning and the owner note to [SPEC.md](SPEC.md) §10.1. Q38–Q41 from my last message are still open.

---

## Greg (20)

* 38: sounds good, i agree with your plan. we should use uniswap quoter instead of 1inch here so it lines up
* 39: sure code hashes work
* 40: agree with C
* 41: to be clear - i thought we were always going to use indexedDb for the indexer. I was only suggesting we also use it for tokens since you said it might get large. i don't really have an opinion on whether we should use it for other small one-off things like onboarding status. i defer to you. what do you think? i'd like to have a clear split documented of when we should use 1 vs the other to stay clean over time

---

## Claude

Two small follow-ups so the stack table and directory layout match the new storage rule.

All four are in [SPEC.md](SPEC.md). The only thing still open is your final read-through.

**Q41, storage: my recommendation is IndexedDB for everything, and no `localStorage` at all.** I've added this split to §9.5 as the rule to follow over time:

| Kind of data | Where | Backed up? |
|---|---|---|
| **Chain state** (owners, balances, prices, quotes, simulations, ENS) | memory only (React Query), always re-read from the chain | — |
| **User data** (settings incl. onboarding status, Safes, packages, token lists, address book, descriptors, ABIs) | IndexedDB | yes |
| **Rebuildable caches** (history index, RPC capabilities, downloaded descriptors) | IndexedDB | no |
| **Session-only** (network log, unsaved form input) | memory | no |

**Why one storage mechanism instead of two:**
- **Nothing needs to be read synchronously at startup,** which is the only real advantage `localStorage` has. The path-gateway check doesn't touch storage, the network guard starts empty and fills in once settings load, and the theme is CSS-only. So small items like onboarding status gain nothing from `localStorage`.
- **Workers can't use `localStorage`,** and the history worker needs storage.
- **There's no "which one?" decision** to make for every new feature.

**It's enforced in code:** a Biome lint rule bans `localStorage` and `sessionStorage` everywhere, and `indexedDB` outside `src/storage/`. The rule's message points to §9.5, so the split stays clean without anyone remembering it.

**The other three:**
- **Q38, swap** (new §3.13): Uniswap only, so the swap screen shows the numbers that actually execute. The manipulation check is now **Uniswap v3's 30-minute TWAP** instead of 1inch, with a warning if the quote is more than 2% worse. v4-only pairs show "No TWAP check for this route." 1inch stays for the balance display. It's the first P1 item, built together with MultiSend.
- **Q39:** saved ABIs are tied to `chainId` plus the implementation's code hash. If the proxy is upgraded, the ABI isn't used and the app says so. This also catches a contract redeployed at the same address. Sourcify ABIs are never saved.
- **Q40:** only Safe's descriptors are bundled (about 95 KB). Every other descriptor is fetched on demand from GitHub at the pinned commit, and dropped unless its SHA-256 matches a bundled manifest (about 40 KB). It's one new opt-in capability.

---

## Greg (21)

This all sounds great! So spec.md has everything needed to let another agent start being productive working on this project from the ground up?

---

## Greg (22)

What prompt should i give the agent to start alongside the spec?

---

## Claude

The spec covers **what** to build and **why** well enough to start. Before handing it off, I fixed one gap and there are three more:

1. **Fixed:** the verification scripts behind §4.4 were only in my temporary folder. They're now in [docs/planning/verification/](docs/planning/verification/README.md), so the agent can turn them into the integration test instead of rewriting them.
2. **No `CLAUDE.md` yet.** The spec is 1,100 lines, and a new session won't read all of it on every turn. A short `CLAUDE.md` with the non-negotiable rules keeps every later session on track. The prompt below has the agent write one first.
3. **Some details were left to check at build time on purpose:** which Universal Router version to use, whatsabi's option names, the clear-signing library's resolver interface. The prompt tells the agent to check these against the installed versions rather than guess.
4. **No list of screens and routes.** The flows are described, but not the URL map. The agent should write one down during scaffolding.

Here's the kickoff prompt:

```text
You're building Plain Safe, a local-first Safe multisig UI, solo with me at ETHGlobal Tokyo 2026 (Classic "From Scratch" track; submission due Sun Sep 27, 09:00 JST). SPEC.md in the repo root is the source of truth. Read all of it before writing any code. docs/planning/verification/ has scripts that already checked the spec's Safe assumptions against Mainnet.

Rules that must not be broken (details are in SPEC.md):
- TypeScript, Bun, Biome, Vite + React, viem (all reads), wagmi (wallet only), TanStack Query, Effect used only as SPEC §9.2 allows.
- Before the first `bun add`, create bunfig.toml with `[install] minimumReleaseAge = 172800`. Don't add dependencies the spec doesn't list without asking me.
- The RPC is the only default outbound request. netguard (our own code, §8.1) loads before everything else, including inside workers. Never add a hosted API, analytics or telemetry.
- Persistent data goes only through the IndexedDB Storage service (§9.5). No localStorage or sessionStorage.
- Safety warnings are computed from decoded calldata, never from clear-signing descriptors (§7.4). Safes are verified by proxy and singleton code hash (§4.2). The three hashes are always visible.

How to work:
1. First, write a short CLAUDE.md with these rules, the commands (dev, test, lint, build) and a pointer to SPEC.md. Then write the screen and route map (hash routes) and add it to SPEC §9.4.
2. Build in SPEC §16 order. P0 first; don't start P1 until P0 works end to end on Sepolia.
3. After each numbered step: run the tests and lint, run the app and check that the network log shows only the RPC, then commit with a clear message. Keep commits small and frequent; ETHGlobal disqualifies large single commits.
4. Port docs/planning/verification/safe.ts into test/integration/safe-mainnet.test.ts during step 2. For automated signing tests, use viem local accounts and eth_simulateV1 state overrides; never use real keys.
5. Check library APIs (clear-signing, whatsabi, Effect, viem, Universal Router) against the installed versions and their docs (use Context7). Don't guess.
6. If the spec turns out to be wrong or incomplete, stop and tell me. Don't quietly diverge. When we agree on a change, update SPEC.md in the same commit.
7. Keep an "AI usage" section in the README up to date as you go (ETHGlobal requires it).

Start with SPEC §16 step 1 (scaffold, bunfig, CLAUDE.md, the path-gateway check, netguard, settings schema, setup screen). Show me the route map before building screens.
```

Two notes:
- **The repo:** `local-safe/` still isn't a git repo. The prompt assumes the agent can run `git init` there, or you can create `gskril/plainsafe` first and clone it.
- **Planning transcript:** ETHGlobal wants this conversation in `docs/planning/` too. I can export it there now, or you can do it once the repo exists.

---

## Greg (23)

its now a git repo. yes export this conversation to docs/planning, removing any potentially sensitive data and times - should be messages only. only change to the prompt is instructions to regularly save progress as git commits to main branch. send the revised prompt again then we're good to go
