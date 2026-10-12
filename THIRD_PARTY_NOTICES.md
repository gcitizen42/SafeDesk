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
