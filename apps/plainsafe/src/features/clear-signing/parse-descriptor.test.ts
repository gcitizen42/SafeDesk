import { createHash } from 'node:crypto'
import { Either } from 'effect'
import { describe, expect, it } from 'vitest'
import bundle from '@/generated/clear-signing/bundle.json'
import { parseUserDescriptor } from './parse-descriptor'

// A self-contained descriptor, shaped like the registry's WETH one
const weth = {
  $schema: '../../specs/erc7730-v1.schema.json',
  context: {
    $id: 'WETH',
    contract: {
      deployments: [{ chainId: 11155111, address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14' }],
      abi: [
        { type: 'function', name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable' },
      ],
    },
  },
  metadata: { owner: 'WETH', contractName: 'WETH9' },
  display: {
    formats: {
      'deposit()': {
        intent: 'Wrap',
        fields: [{ path: '@.value', label: 'Amount', format: 'amount' }],
      },
    },
  },
}

describe('importing a descriptor file', () => {
  it('accepts a self-contained descriptor, keeps it whole, and uses its SHA-256 as the id', async () => {
    const text = JSON.stringify(weth, null, 2)
    const r = await parseUserDescriptor(text, 'weth.json')
    expect(Either.isRight(r)).toBe(true)
    if (Either.isLeft(r)) return
    expect(r.right.id).toBe(createHash('sha256').update(text).digest('hex'))
    expect(r.right.descriptor).toEqual(weth)
    expect(r.right.name).toBe('WETH9')
  })

  it('explains that a descriptor with `includes` must be merged first', async () => {
    const text = JSON.stringify(
      (bundle.files as Record<string, unknown>)['registry/safe/calldata-Safe-1.4.1.json'],
    )
    const r = await parseUserDescriptor(text)
    expect(Either.isLeft(r) && r.left).toMatch(/includes another file \(common-Safe\.json\)/)
  })

  it('rejects files that are not JSON or not ERC-7730', async () => {
    expect(Either.isLeft(await parseUserDescriptor('not json'))).toBe(true)
    expect(Either.isLeft(await parseUserDescriptor('{"context":{}}'))).toBe(true)
  })

  it("doesn't mistake a JSON array's or string's `includes` method for an included file", async () => {
    for (const text of ['[]', '"descriptor"']) {
      const r = await parseUserDescriptor(text)
      expect(Either.isLeft(r) && r.left).toMatch(/^This isn't an ERC-7730 descriptor/)
    }
  })
})
