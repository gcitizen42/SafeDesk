// End-to-end verification of SPEC §4–§7.5 against real Mainnet Safes (v1.3.0, v1.4.1, v1.5.0).
import {
  type Address,
  type Hex,
  concat,
  createPublicClient,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  hashTypedData,
  http,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
  toHex,
  zeroAddress,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

const client = createPublicClient({ chain: mainnet, transport: http('https://rpc.mevblocker.io') })
const DEP = 'https://raw.githubusercontent.com/safe-global/safe-deployments/main/src/assets'

const safes: Address[] = [
  '0x4F2083f5fBede34C2714aFfb3105539775f7FE64', // ENS Endowment (1.3.0)
  '0x27e9f607817A05669D9C3794fb9Cd43724f61614', // from 1.4.1 factory
  '0x7b2486f2fc0e1DAC78D866b8b7fb04b19c66C102', // from 1.5.0 factory
]

const safeAbi = parseAbi([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function VERSION() view returns (string)',
  'function domainSeparator() view returns (bytes32)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
  'function simulateAndRevert(address targetContract, bytes calldataPayload)',
  'event ExecutionSuccess(bytes32 txHash, uint256 payment)',
])
const accessorAbi = parseAbi([
  'function simulate(address to, uint256 value, bytes data, uint8 operation) returns (uint256 estimate, bool success, bytes returnData)',
])
const SafeTx = [
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
  { name: 'operation', type: 'uint8' },
  { name: 'safeTxGas', type: 'uint256' },
  { name: 'baseGas', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' },
  { name: 'gasToken', type: 'address' },
  { name: 'refundReceiver', type: 'address' },
  { name: 'nonce', type: 'uint256' },
] as const
const DOMAIN_TYPEHASH = keccak256(toHex('EIP712Domain(uint256 chainId,address verifyingContract)'))
const SAFE_TX_TYPEHASH = keccak256(
  toHex(
    'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)',
  ),
)
const EXEC_SUCCESS_TOPIC = keccak256(toHex('ExecutionSuccess(bytes32,uint256)'))
const ETH_PSEUDO = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

// singleton code hash -> label, from safe-deployments
const singletonHashes: Record<string, string> = {}
const accessors: Record<string, Address> = {}
for (const [v, files] of Object.entries({
  'v1.3.0': ['gnosis_safe.json', 'gnosis_safe_l2.json'],
  'v1.4.1': ['safe.json', 'safe_l2.json'],
  'v1.5.0': ['safe.json', 'safe_l2.json'],
})) {
  for (const f of files) {
    const j = await (await fetch(`${DEP}/${v}/${f}`)).json()
    for (const [kind, d] of Object.entries<any>(j.deployments)) singletonHashes[d.codeHash.toLowerCase()] = `${j.contractName} ${v} (${kind})`
  }
  const a = await (await fetch(`${DEP}/${v}/simulate_tx_accessor.json`)).json()
  accessors[v] = a.deployments.canonical.address
}

const slot = (n: number) => pad(numberToHex(n), { size: 32 })
const ownersSlot = (a: Address) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [a, 2n]))
const ok = (b: boolean) => (b ? 'PASS' : 'FAIL')
const results: string[] = []
const check = (name: string, cond: boolean, extra = '') => {
  results.push(`${ok(cond)}  ${name}${extra ? ` — ${extra}` : ''}`)
}

for (const safe of safes) {
  results.push(`\n=== ${safe}`)
  const block = await client.getBlockNumber()
  const [owners, threshold, nonce, version, onchainDomain] = await Promise.all([
    client.readContract({ address: safe, abi: safeAbi, functionName: 'getOwners', blockNumber: block }),
    client.readContract({ address: safe, abi: safeAbi, functionName: 'getThreshold', blockNumber: block }),
    client.readContract({ address: safe, abi: safeAbi, functionName: 'nonce', blockNumber: block }),
    client.readContract({ address: safe, abi: safeAbi, functionName: 'VERSION', blockNumber: block }),
    client.readContract({ address: safe, abi: safeAbi, functionName: 'domainSeparator', blockNumber: block }),
  ])
  const vkey = `v${version}`
  results.push(`VERSION()=${version} owners=${owners.length} threshold=${threshold} nonce=${nonce}`)

  // §4.2 authenticity: singleton from slot 0, code hash lookup
  const s0 = await client.getStorageAt({ address: safe, slot: slot(0), blockNumber: block })
  const singleton = `0x${s0!.slice(26)}` as Address
  const sCode = await client.getCode({ address: singleton, blockNumber: block })
  const label = singletonHashes[keccak256(sCode!).toLowerCase()]
  check('singleton code hash is a known safe-deployments hash', !!label, label ?? keccak256(sCode!))

  // §4.3 storage layout
  const [s3, s4, s5] = await Promise.all([3, 4, 5].map((n) => client.getStorageAt({ address: safe, slot: slot(n), blockNumber: block })))
  check('slot 3 == ownerCount', BigInt(s3!) === BigInt(owners.length))
  check('slot 4 == threshold', BigInt(s4!) === threshold)
  check('slot 5 == nonce', BigInt(s5!) === nonce)

  // §5.1 hashes: manual formula vs viem hashTypedData vs on-chain getTransactionHash
  const tx = {
    to: '0x000000000000000000000000000000000000dEaD' as Address,
    value: 0n,
    data: '0x' as Hex,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce,
  }
  const domainHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [DOMAIN_TYPEHASH, 1n, safe]))
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      [SAFE_TX_TYPEHASH, tx.to, tx.value, keccak256(tx.data), tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, tx.nonce],
    ),
  )
  const manualSafeTxHash = keccak256(concat(['0x1901', domainHash, structHash]))
  const typed = { domain: { chainId: 1, verifyingContract: safe }, types: { SafeTx }, primaryType: 'SafeTx' as const, message: tx }
  const viemSafeTxHash = hashTypedData(typed)
  const onchainHash = await client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: 'getTransactionHash',
    args: [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, tx.nonce],
    blockNumber: block,
  })
  check('domain hash == on-chain domainSeparator()', domainHash === onchainDomain)
  check('manual safeTxHash == on-chain getTransactionHash()', manualSafeTxHash === onchainHash)
  check('viem hashTypedData == on-chain getTransactionHash()', viemSafeTxHash === onchainHash)
  // non-trivial calldata + delegatecall flag + refund fields too
  const tx2 = { ...tx, value: 12345n, data: '0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead0000000000000000000000000000000000000000000000000000000000000001' as Hex, operation: 1, safeTxGas: 7n, baseGas: 8n, gasPrice: 9n, gasToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F' as Address, refundReceiver: '0x000000000000000000000000000000000000bEEF' as Address, nonce: nonce + 5n }
  const onchain2 = await client.readContract({ address: safe, abi: safeAbi, functionName: 'getTransactionHash', args: [tx2.to, tx2.value, tx2.data, tx2.operation, tx2.safeTxGas, tx2.baseGas, tx2.gasPrice, tx2.gasToken, tx2.refundReceiver, tx2.nonce], blockNumber: block })
  check('viem hash == on-chain (calldata, delegatecall, refunds, future nonce)', hashTypedData({ ...typed, message: tx2 }) === onchain2)

  // helper: run execTransaction via eth_simulateV1 with state overrides
  const execData = (t: typeof tx, sigs: Hex) =>
    encodeFunctionData({ abi: safeAbi, functionName: 'execTransaction', args: [t.to, t.value, t.data, t.operation, t.safeTxGas, t.baseGas, t.gasPrice, t.gasToken, t.refundReceiver, sigs] })
  const sim = async (t: typeof tx, sigs: Hex, from: Address, diff: { slot: Hex; value: Hex }[], balance?: bigint) => {
    const [res] = await client.simulateBlocks({
      blockNumber: block,
      blocks: [{ stateOverrides: [{ address: safe, stateDiff: diff, ...(balance ? { balance } : {}) }], calls: [{ from, to: safe, data: execData(t, sigs) }] }],
      traceTransfers: true,
      validation: false,
    })
    return res.calls[0]
  }
  const random = privateKeyToAccount(generatePrivateKey()).address

  // T1: EOA EIP-712 signature (65 bytes r||s||v, v∈{27,28}) from a test key made owner via override
  const k1 = privateKeyToAccount(generatePrivateKey())
  const sig1 = await k1.signTypedData(typed)
  const r1 = await sim(tx, sig1, random, [
    { slot: slot(4), value: slot(1) },
    { slot: ownersSlot(k1.address), value: slot(1) },
  ])
  const evtHash = r1.logs?.find((l) => l.topics[0] === EXEC_SUCCESS_TOPIC)
  check('T1 EIP-712 EOA signature executes (simulateV1)', r1.status === 'success', `v=${parseInt(sig1.slice(-2), 16)}`)
  check('T1 ExecutionSuccess carries our safeTxHash', !!evtHash && (evtHash.topics[1] === onchainHash || evtHash.data.startsWith(onchainHash)))

  // T2: pre-validated signature (r=owner, s=0, v=1) sent from a real owner, threshold overridden to 1
  const owner0 = owners[0]
  const preValidated = concat([pad(owner0, { size: 32 }), pad('0x0', { size: 32 }), '0x01'])
  const r2 = await sim(tx, preValidated, owner0, [{ slot: slot(4), value: slot(1) }])
  check('T2 pre-validated signature from real owner executes (simulation level 1 recipe)', r2.status === 'success')
  const r2b = await sim(tx, preValidated, random, [{ slot: slot(4), value: slot(1) }])
  check('T2b pre-validated signature from NON-owner sender is rejected', r2b.status === 'failure')

  // T3: two signers, threshold 2 — ascending order passes, descending fails (GS026)
  const k2 = privateKeyToAccount(generatePrivateKey())
  const sig2 = await k2.signTypedData(typed)
  const pairs = [
    { a: k1.address, s: sig1 },
    { a: k2.address, s: sig2 },
  ].sort((x, y) => (BigInt(x.a) < BigInt(y.a) ? -1 : 1))
  const diff2 = [
    { slot: slot(4), value: slot(2) },
    { slot: ownersSlot(k1.address), value: slot(1) },
    { slot: ownersSlot(k2.address), value: slot(1) },
  ]
  const r3 = await sim(tx, concat(pairs.map((p) => p.s)), random, diff2)
  const r3b = await sim(tx, concat([...pairs].reverse().map((p) => p.s)), random, diff2)
  check('T3 two signatures sorted ascending by signer execute', r3.status === 'success')
  check('T3b same signatures in descending order revert', r3b.status === 'failure', r3b.error?.message?.match(/GS0\d\d/)?.[0] ?? String(r3b.error?.message).slice(0, 60))

  // T4: signature for a different nonce (different safeTxHash) is rejected
  const sigWrong = await k1.signTypedData({ ...typed, message: { ...tx, nonce: nonce + 1n } })
  const r4 = await sim(tx, sigWrong, random, [
    { slot: slot(4), value: slot(1) },
    { slot: ownersSlot(k1.address), value: slot(1) },
  ])
  check('T4 signature over a different safeTxHash is rejected', r4.status === 'failure', r4.error?.message?.match(/GS0\d\d/)?.[0] ?? '')

  // T5: future nonce via nonce override (slot 5) + ETH transfer visible via traceTransfers
  const txF = { ...tx, value: 1n, nonce: nonce + 3n }
  const sigF = await k1.signTypedData({ ...typed, message: txF })
  const r5 = await sim(txF, sigF, random, [
    { slot: slot(4), value: slot(1) },
    { slot: slot(5), value: pad(numberToHex(nonce + 3n), { size: 32 }) },
    { slot: ownersSlot(k1.address), value: slot(1) },
  ], 10n ** 18n)
  check('T5 future nonce via slot-5 override executes', r5.status === 'success')
  check('T5 native ETH transfer appears as 0xEeee… pseudo-log (traceTransfers)', !!r5.logs?.some((l) => l.address.toLowerCase() === ETH_PSEUDO))

  // T6: simulation level 2 — simulateAndRevert(SimulateTxAccessor, simulate(...)) via plain eth_call
  const accessor = accessors[vkey]
  const payload = encodeFunctionData({ abi: accessorAbi, functionName: 'simulate', args: [tx.to, 0n, '0x', 0] })
  let l2 = 'no revert data'
  try {
    await client.call({ to: safe, data: encodeFunctionData({ abi: safeAbi, functionName: 'simulateAndRevert', args: [accessor, payload] }), blockNumber: block })
  } catch (e: any) {
    const raw: Hex | undefined = e?.walk?.((x: any) => x?.data && typeof x.data === 'string')?.data ?? e?.data
    if (raw) {
      const success = BigInt(raw.slice(0, 66)) === 1n
      const len = Number(BigInt(`0x${raw.slice(66, 130)}`))
      const response = `0x${raw.slice(130, 130 + len * 2)}` as Hex
      const [estimate, innerSuccess] = decodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'bytes' }], response)
      l2 = `delegatecall ok=${success}, inner success=${innerSuccess}, estimate=${estimate}`
    }
  }
  check('T6 simulateAndRevert + SimulateTxAccessor decodes', l2.includes('inner success=true'), `${accessor}: ${l2}`)
}

console.log(results.join('\n'))
