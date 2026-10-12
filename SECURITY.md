# Security and Operational Boundaries

SafeDesk is unaudited. Local hosting, passing tests and dependency scans are
not a security certification. Do not use it for unattended treasury execution.
Test a disposable wallet/fork and independently review the exact transaction
before using production assets.

## Default Controls

- Bind only to localhost. Do not expose the local API to the internet or a
  shared proxy. Host/Origin checks and session tokens protect batch routes.
- Management and rotations run on separate origins. Only a public,
  sanitised Chainlist catalogue is shared; no private settings/signatures.
- Management wallet actions start disabled. `--enable-wallet-actions` is
  an explicit opt-in, not an agent action. Review every wallet request.
- Each signature binds all ten SafeTx fields plus chain ID and Safe address.
  EIP-712 and Safe personal-sign formats are verified separately. Contract
  signatures are not accepted as plain EOA signatures.
- Editing creates an unsigned draft. Never reuse signatures after changing
  nonce, chain, Safe, operation, calldata, value or gas/refund fields.
- Builder imports preserve operation. CALL-only batching uses a code-hash
  verified MultiSendCallOnly. Never silently convert a delegatecall to CALL.
- Proposal publication is not execution. The proposal desk still requires
  a matching successful simulation and current owners/nonce/hash checks.
- Ordinary wallet broadcasts may be public. There is no private-relay
  implementation; do not use this for the Republic incident execution.

## Keep Private

Private RPC URLs, Tenderly keys, signature files, browser backups and live
operation records must not be uploaded to GitHub, screenshots or issue
reports. `operations/`, `secrets/`, local config and environment files are
ignored. IndexedDB and local private files are not encrypted by SafeDesk.

Run `npm run check:public -- --history` before publishing. This checks
tracked paths, keyed Ankr URLs and locally known credential/signature
fingerprints. It is not a complete secret scanner and cannot recognise every
new credential. Manually review staged files too.

## Reporting

Do not post exploitable details, signatures, seed phrases or credentials in
public issues. Use GitHub's private vulnerability-reporting route if enabled;
otherwise contact the repository owner privately before disclosure. Real
wallet signing, mainnet execution, private-relay operation and EIP-1271
support require separate review and testing.
