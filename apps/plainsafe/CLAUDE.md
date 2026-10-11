# Plain Safe

A static, local-first web UI for Safe multisigs. **`SPEC.md` is the source of truth**; read the relevant section before changing anything. If the spec is wrong or incomplete, stop and ask. Don't quietly diverge. When a change is agreed, update `SPEC.md` in the same commit.

## Rules that must not be broken

- **Stack:** TypeScript, Bun, Biome, Vite + React, viem for **all** reads, wagmi **only** for the wallet (connect, switch chain, sign, send), TanStack Query, wouter (hash routing), Tailwind v4 + shadcn/ui. Effect only as SPEC §9.2 allows (its guardrail lists the APIs in use; anything else is agreed first).
- **Dependencies:** `bunfig.toml` enforces `minimumReleaseAge = 172800`. Don't add a dependency SPEC §9.1 doesn't list without asking. `bun.lock` is committed.
- **Network:** the RPC is the only default outbound request. `netguard` (`src/netguard/`, our own code, SPEC §8.1) is imported first in `main.tsx` and first in every worker. Never add a hosted API, analytics or telemetry. Opt-in capabilities are SPEC §8.2 only.
- **Storage:** anything persistent goes through the IndexedDB `Storage` service (`src/storage/`, SPEC §9.5). No `localStorage`/`sessionStorage`; `indexedDB` only inside `src/storage/`. Biome enforces this. Every stored record is decoded with Effect Schema on read.
- **Safety:** warnings are computed from decoded calldata, **never** from clear-signing descriptor text (SPEC §7.4). Safes are verified by proxy **and** singleton code hash, never by `VERSION()` (SPEC §4.2). The domain hash, message hash and safeTxHash are visible on every review screen. Imported hashes are always recomputed.
- **Tests:** automated signing uses viem local accounts (`generatePrivateKey`) and `eth_simulateV1` state overrides. Never real keys.
- **Library APIs:** check against the installed version (`node_modules/<pkg>` types and source) and its docs. Don't guess.

## Commands

```sh
bun install --frozen-lockfile
bun run dev          # Vite dev server
bun run test         # Vitest unit tests (NOT `bun test`, which is Bun's own runner)
bun run test:integration   # Mainnet checks (SPEC §4.4); needs MAINNET_RPC_URL, skipped otherwise
bun run lint         # Biome check (lint + format check)
bun run format       # Biome check --write
bun run typecheck    # tsc --noEmit
bun run build        # typecheck + production build to dist/
bun run cid dist     # IPFS CID of the build, matching omnipin (RELEASE.md)
bun run contenthash <name> <cid>   # ENS setContenthash calldata for a release
bun run gen:safe-deployments       # regenerate src/generated/safe-deployments.json
bun run gen:clear-signing          # regenerate the bundled clear-signing registry files
```

## Layout

See SPEC §9.4 for the directory layout and the screen/route map. Layers (SPEC §9.2): components never call viem or Effect directly; reads go through query hooks in `src/queries/` → Effect programs → services; `src/core/` is pure TS.

## Working

- Build in SPEC §16 order; P0 before P1.
- After each step: `bun run test`, `bun run lint`, `bun run typecheck`, run the app and check the network log shows only the RPC, then commit.
- Small, frequent commits on `main` (ETHGlobal disqualifies large single commits).
- Keep the README "AI usage" section current.
