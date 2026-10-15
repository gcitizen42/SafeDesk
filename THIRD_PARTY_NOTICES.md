# Third-Party Notices

## PlainSafe

SafeDesk includes a modified, vendored copy of PlainSafe, created by Greg
Skriloff at ETHGlobal Tokyo 2026. This is a code integration, not only visual
inspiration. SafeDesk is not an official Safe or PlainSafe product and is not
endorsed by Apple, Safe or the upstream author.

- Repository: https://github.com/gskril/plainsafe
- Pinned upstream commit: `9a23f9ab38501cf09bb5464b2b5684314e9fb7d5`
- Source: `apps/plainsafe/`
- Upstream copyright: Copyright (c) 2026 Greg Skriloff
- License: MIT, preserved verbatim in `apps/plainsafe/LICENSE`
- Local integration notes: `apps/plainsafe/SAFEDESK.md`

Keep the original license and copyright notice with redistributed source or
builds. Other dependencies retain their own licenses, listed in installed
packages and in the management app's About screen.

## Chainlist

The public EVM chain catalogue is loaded on request from
https://chainlist.org/rpcs.json. Metadata is untrusted until parsed, and RPC
chain IDs must be verified before use. Inclusion is not an endorsement of a
chain, endpoint, privacy policy or Safe deployment. No private RPC settings
are uploaded to Chainlist.

## Native Sui / MSafe

The Other Chains backend uses the pinned `@mysten/sui` 2.35.0 SDK for native
public-key/address derivation, transaction serialization and gRPC/GraphQL
reads/simulation. SDK license and notices remain in the installed dependency.
Source: https://github.com/MystenLabs/ts-sdks .

MSafe's nonce-specifier format is derived from `src/account.ts` and
`src/constants.ts` distributed in the official `@msafe/sui3-utils` 5.1.0 npm
package, consistent with https://doc.m-safe.io/sui/faq/glossary . The MSafe SDK
is not installed, its proprietary/private backend is not copied, and no
MSafe authentication or execution integration is included. SafeDesk is not
an official MSafe product and does not claim endorsement.
