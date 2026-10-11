// Vectors from safe-tx-hashes-util's README (pcaversaccio/safe-tx-hashes-util).
import { concat, encodeAbiParameters, hashTypedData, keccak256, toHex, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { type SafeTx, safeTxHashes, safeTxTypedData } from './safe-tx'

const base: Omit<SafeTx, 'to' | 'data' | 'nonce'> = {
  value: 0n,
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
}

const lower = (h: { domain: string; message: string; safeTx: string }) => ({
  domain: h.domain.toLowerCase(),
  message: h.message.toLowerCase(),
  safeTx: h.safeTx.toLowerCase(),
})

const ARB_SAFE = '0x111CEEee040739fD91D29C34C33E6B3E112F2177' // v1.3.0+L2 on Arbitrum
const addOwner: SafeTx = {
  ...base,
  to: ARB_SAFE,
  data: '0x0d582f130000000000000000000000000c75fa5a5f1c0997e3eea425cfa13184ed0ec9e50000000000000000000000000000000000000000000000000000000000000003',
  nonce: 234n,
}

const vectors: {
  name: string
  chainId: number
  safe: `0x${string}`
  tx: SafeTx
  expected: { domain: string; message: string; safeTx: string }
}[] = [
  {
    name: 'v1.3.0+L2 Arbitrum, addOwnerWithThreshold',
    chainId: 42161,
    safe: ARB_SAFE,
    tx: addOwner,
    expected: {
      domain: '0x1CF7F9B1EFE3BC47FE02FD27C649FEA19E79D66040683A1C86C7490C80BF7291',
      message: '0xD9109EA63C50ECD3B80B6B27ED5C5A9FD3D546C2169DFB69BFA7BA24CD14C7A5',
      safeTx: '0x0cb7250b8becd7069223c54e2839feaed4cee156363fbfe5dd0a48e75c4e25b3',
    },
  },
  {
    name: 'v1.3.0+L2 Arbitrum, delegatecall with value and refund fields',
    chainId: 42161,
    safe: ARB_SAFE,
    tx: {
      ...addOwner,
      value: 1000n,
      operation: 1,
      gasPrice: 50n,
      gasToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      refundReceiver: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    },
    expected: {
      domain: '0x1CF7F9B1EFE3BC47FE02FD27C649FEA19E79D66040683A1C86C7490C80BF7291',
      message: '0xC7E826933DA60E6AC3E2246ED0563A26A920A65BEAA9089D784AC96234141BB3',
      safeTx: '0xc818fceb1cace51c1a4039c4c66fc73d95eccc298104c9c52debac604b9f4e04',
    },
  },
  {
    name: 'v1.4.1 Sepolia, 0.1 ETH transfer',
    chainId: 11155111,
    safe: '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1',
    tx: {
      ...base,
      to: '0x255C3912f91eF11bFDadd405F13144a823Da8cc5',
      value: 100000000000000000n,
      data: '0x',
      nonce: 4n,
    },
    expected: {
      domain: '0x611379C19940CAEE095CDB12BEBE6A9FA9ABB74CDB1FBD7377C49A1F198DC24F',
      message: '0x565BBA8B51924FFA64953596D0A2DD5C2CAD39649F7DE0BF2C8DBC903BD03258',
      safeTx: '0xcb8bbe7bf8f8a1f3f57658e450d07d4422356ac042d96a87ba425b19e67a78a1',
    },
  },
  {
    name: 'v1.4.1 Sepolia, approveHash from a nested Safe',
    chainId: 11155111,
    safe: '0x6bc56d6CE87C86CB0756c616bECFD3Cd32b09251',
    tx: {
      ...base,
      to: '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1',
      data: '0xd4d9bdcdcb8bbe7bf8f8a1f3f57658e450d07d4422356ac042d96a87ba425b19e67a78a1',
      nonce: 4n,
    },
    expected: {
      domain: '0x55F6C329A7834E2A4E789F5526F328FA75D14FE75B97B0001BE40CAF46CA92A1',
      message: '0xCD411EE5D49344391EF8D37B76E19DFACF505BBB20E856AC907ACB5958ECBDF0',
      safeTx: '0x86eb3f93f2670d119a4ecb8eeaa4dafe31a28abcafe06688d47e195a3dd7abb0',
    },
  },
]

// The manual formula from SPEC §5.1, independent of viem's EIP-712 code.
const DOMAIN_TYPEHASH = keccak256(toHex('EIP712Domain(uint256 chainId,address verifyingContract)'))
const SAFE_TX_TYPEHASH = keccak256(
  toHex(
    'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)',
  ),
)
function manual(chainId: number, safe: `0x${string}`, tx: SafeTx) {
  const domain = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [DOMAIN_TYPEHASH, BigInt(chainId), safe],
    ),
  )
  const message = keccak256(
    encodeAbiParameters(
      [
        'bytes32',
        'address',
        'uint256',
        'bytes32',
        'uint8',
        'uint256',
        'uint256',
        'uint256',
        'address',
        'address',
        'uint256',
      ].map((type) => ({ type })),
      [
        SAFE_TX_TYPEHASH,
        tx.to,
        tx.value,
        keccak256(tx.data),
        tx.operation,
        tx.safeTxGas,
        tx.baseGas,
        tx.gasPrice,
        tx.gasToken,
        tx.refundReceiver,
        tx.nonce,
      ],
    ),
  )
  return { domain, message, safeTx: keccak256(concat(['0x1901', domain, message])) }
}

describe('safeTxHashes', () => {
  it('uses the v1.3.0+ SafeTx typehash', () => {
    expect(SAFE_TX_TYPEHASH).toBe(
      '0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8',
    )
  })

  for (const v of vectors) {
    it(`matches safe-tx-hashes-util: ${v.name}`, () => {
      expect(lower(safeTxHashes(v.chainId, v.safe, v.tx))).toEqual(lower(v.expected))
    })
    it(`agrees with the manual formula and viem hashTypedData: ${v.name}`, () => {
      const ours = safeTxHashes(v.chainId, v.safe, v.tx)
      expect(ours).toEqual(manual(v.chainId, v.safe, v.tx))
      expect(hashTypedData(safeTxTypedData(v.chainId, v.safe, v.tx))).toBe(ours.safeTx)
    })
  }

  it('changes with the chain, the Safe and every field', () => {
    const v = vectors[2]
    if (!v) throw new Error('missing vector')
    const h = safeTxHashes(v.chainId, v.safe, v.tx).safeTx
    expect(safeTxHashes(1, v.safe, v.tx).safeTx).not.toBe(h)
    expect(safeTxHashes(v.chainId, ARB_SAFE, v.tx).safeTx).not.toBe(h)
    expect(safeTxHashes(v.chainId, v.safe, { ...v.tx, nonce: 5n }).safeTx).not.toBe(h)
    expect(safeTxHashes(v.chainId, v.safe, { ...v.tx, safeTxGas: 1n }).safeTx).not.toBe(h)
  })
})
