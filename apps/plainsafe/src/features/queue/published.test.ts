import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Either } from 'effect'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { type Address, concat, type Hex, slice, zeroAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { makePackage, type VerifiedPackage, verifyPackage } from '@/core/package'
import { classifyQueue } from '@/core/queue'
import { type SafeTx, safeTxTypedData } from '@/core/safe-tx'
import { normalizePersonalSignature, prevalidatedSignature } from '@/core/signatures'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { fetchPublishedQueue, publishedQueryOptions } from '@/queries/published'
import {
  mergePublishedPackages,
  parsePublishedQueue,
  publishedQueueComplete,
  publishedSafeUrl,
  publishedSnapshot,
} from './published'
import { QueueScreen } from './queue-screen'

const view = vi.hoisted(() => ({
  snapshot: undefined as SafeSnapshot | undefined,
  packages: [] as {
    verified: VerifiedPackage
    execution?: { status: 'executed'; txHash: Hex; at: string }
  }[],
  save: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/queries/safes', () => ({
  useSafe: () => ({ data: view.snapshot, dataUpdatedAt: 1, refetch: vi.fn() }),
}))
vi.mock('@/queries/packages', () => ({
  usePackages: () => ({ data: { packages: view.packages, invalid: [] }, refetch: vi.fn() }),
  useSavePackage: () => ({ mutate: view.save }),
  useDeletePackage: () => ({ mutate: view.remove }),
}))
vi.mock('@/queries/settings', () => ({ useChain: () => undefined }))
vi.mock('@/queries/simulation', () => ({ useQueueSimulation: () => ({}) }))
vi.mock('@/features/review/tx-summary', () => ({ useTxSummary: () => ({ text: 'Transaction' }) }))
vi.mock('@/features/history/onchain-history', () => ({ OnchainHistory: () => null }))
vi.mock('@/features/safes/use-safe-params', () => ({
  useSafeParams: () => ({ chainId: 1, address: safe }),
}))

const safe: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const alice = privateKeyToAccount(generatePrivateKey())
const bob = privateKeyToAccount(generatePrivateKey())
const nonOwner = privateKeyToAccount(generatePrivateKey())
const hash = `0x${'12'.repeat(32)}` as Hex
const checkedAt = '2026-10-12T12:00:00.000Z'
const snapshot: SafeSnapshot = {
  chainId: 1,
  address: safe,
  block: 100n,
  balance: 0n,
  singleton: zeroAddress,
  authenticity: {
    status: 'verified',
    version: '1.4.1',
    l2: false,
    singleton: zeroAddress,
    singletonName: 'Safe',
    codeHash: hash,
    proxy: { codeHash: hash, size: 171, factories: [] },
  },
  // Deliberately disagrees: the package must use the code-verified version instead.
  reportedVersion: '1.5.0',
  owners: [alice.address, bob.address],
  threshold: 2n,
  nonce: 4n,
}
const tx: SafeTx = {
  to: '0x255C3912f91eF11bFDadd405F13144a823Da8cc5',
  value: 13n,
  data: '0x010203',
  operation: 1,
  safeTxGas: 123456n,
  baseGas: 987n,
  gasPrice: 123n,
  gasToken: alice.address,
  refundReceiver: bob.address,
  nonce: 4n,
}

function row(t = tx) {
  const pkg = makePackage({ chainId: 1, safe, safeVersion: '1.4.1', tx: t, createdAt: checkedAt })
  return {
    safeTxHash: pkg.hashes.safeTx,
    tx: pkg.tx,
    confirmations: [] as unknown[],
    reportedConfirmations: 0,
  }
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 1,
    safe: safe.toLowerCase(),
    status: 'ok',
    complete: true,
    checkedAt,
    service: 'https://api.safe.global/tx-service/eth',
    safeUrl: `https://app.safe.global/transactions/queue?safe=eth:${safe}`,
    rejected: 0,
    transactions: [row()],
    ...overrides,
  }
}

async function confirmation(account = alice, t = tx) {
  return {
    owner: account.address,
    signature: await account.signTypedData(safeTxTypedData(1, safe, t)),
  }
}

async function localPackage(
  args: { tx?: SafeTx; sign?: boolean; note?: string } = {},
): Promise<VerifiedPackage> {
  const t = args.tx ?? tx
  const c = args.sign ? await confirmation(alice, t) : undefined
  const verified = await verifyPackage(
    makePackage({
      chainId: 1,
      safe,
      safeVersion: '1.4.1',
      tx: t,
      note: args.note,
      createdAt: '2026-10-11T00:00:00.000Z',
      signatures: c ? [{ signer: c.owner, kind: 'eip712', data: c.signature }] : [],
    }),
  )
  if (Either.isLeft(verified)) throw new Error('Invalid test package')
  return verified.right
}

function classify(rows: ReturnType<typeof mergePublishedPackages>) {
  return classifyQueue(
    rows.map((p) => ({
      safeTxHash: p.verified.hashes.safeTx,
      nonce: p.verified.tx.nonce,
      signers: p.verified.signatures.map((s) => s.signer),
      execution: p.execution,
      p,
    })),
    { nonce: 4n, owners: snapshot.owners ?? [], threshold: 2n },
  )
}

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  view.snapshot = snapshot
  view.packages = []
  view.save.mockClear()
  view.remove.mockClear()
})

describe('published Safe queue verification', () => {
  it('preserves all ten fields, delegatecall, nonce and refunds, using only the code-verified version', async () => {
    const queue = await parsePublishedQueue(response(), snapshot)
    const p = queue.transactions[0]?.verified
    expect(p?.tx).toEqual(tx)
    expect(p?.pkg.tx).toEqual(row().tx)
    expect(p?.pkg.safeVersion).toBe('1.4.1')
    expect(p?.pkg.createdAt).toBe(checkedAt)
    expect(publishedQueueComplete(queue)).toBe(true)
    const verified = await verifyPackage(p?.pkg)
    expect(Either.isRight(verified)).toBe(true)
  })

  it('recovers EIP-712 and Safe-encoded personal signatures; non-owners never count toward threshold', async () => {
    const personal = normalizePersonalSignature(
      await bob.signMessage({ message: { raw: row().safeTxHash } }),
    )
    const queue = await parsePublishedQueue(
      response({
        transactions: [
          {
            ...row(),
            reportedConfirmations: 99,
            confirmations: [
              await confirmation(),
              await confirmation(nonOwner),
              { owner: bob.address, signature: personal },
            ],
          },
        ],
      }),
      snapshot,
    )
    const p = queue.transactions[0]
    expect(p?.verified.signatures).toHaveLength(3)
    expect(p?.verified.signatures.find((s) => s.signer === bob.address)?.kind).toBe('eth_sign')
    expect(p?.reportedConfirmations).toBe(99)
    expect(classify(mergePublishedPackages([], queue.transactions))[0]).toMatchObject({
      state: 'ready',
      validSignatures: 2,
    })
    const nonOwnerOnly = await parsePublishedQueue(
      response({
        transactions: [
          {
            ...row(),
            reportedConfirmations: 99,
            confirmations: [await confirmation(nonOwner)],
          },
        ],
      }),
      snapshot,
    )
    expect(classify(mergePublishedPackages([], nonOwnerOnly.transactions))[0]).toMatchObject({
      state: 'needs-signatures',
      validSignatures: 0,
    })
  })

  it('rejects signatures over another hash, a wrong claimed owner, duplicates and malformed confirmations', async () => {
    const valid = await confirmation()
    const queue = await parsePublishedQueue(
      response({
        transactions: [
          {
            ...row(),
            reportedConfirmations: 5,
            confirmations: [
              valid,
              { ...valid, owner: alice.address.toLowerCase() },
              await confirmation(bob, { ...tx, nonce: 5n }),
              { ...valid, owner: bob.address },
              { owner: 'not-an-address', signature: valid.signature },
            ],
          },
        ],
      }),
      snapshot,
    )
    expect(queue.transactions[0]?.verified.signatures.map((s) => s.signer)).toEqual([alice.address])
    expect(queue.transactions[0]?.rejectedConfirmations.map((c) => c.reason)).toEqual([
      'duplicate-owner',
      'wrong-owner-or-hash',
      'wrong-owner-or-hash',
      'invalid-confirmation',
    ])
    expect(classify(mergePublishedPackages([], queue.transactions))[0]).toMatchObject({
      state: 'needs-signatures',
      validSignatures: 1,
    })
  })

  it('never assumes approved hashes, prevalidated signatures, contract signatures or service counts are approvals', async () => {
    const valid = await confirmation()
    const approved = prevalidatedSignature(alice.address)
    const queue = await parsePublishedQueue(
      response({
        transactions: [
          {
            ...row(),
            reportedConfirmations: 128,
            confirmations: [
              { owner: alice.address, signature: null },
              { owner: alice.address, signature: approved },
              { owner: bob.address, signature: concat([slice(approved, 0, 64), '0x00']) },
              { owner: bob.address, signature: `0x${'ab'.repeat(16 * 1024)}` },
              { owner: alice.address, signature: concat([slice(valid.signature, 0, 64), '0x02']) },
              { owner: alice.address, signature: '0x123' },
            ],
          },
        ],
      }),
      snapshot,
    )
    expect(queue.transactions[0]?.verified.signatures).toEqual([])
    expect(queue.transactions[0]?.rejectedConfirmations).toHaveLength(6)
    expect(queue.transactions[0]?.reportedConfirmations).toBe(128)
    expect(classify(mergePublishedPackages([], queue.transactions))[0]).toMatchObject({
      state: 'needs-signatures',
      validSignatures: 0,
    })
  })

  it('rejects a forged transaction hash, altered refunds and stale nonce without silently claiming completeness', async () => {
    const queue = await parsePublishedQueue(
      response({
        transactions: [
          { ...row(), safeTxHash: hash },
          { ...row(), tx: { ...row().tx, refundReceiver: zeroAddress } },
          row({ ...tx, nonce: 3n }),
          row({ ...tx, nonce: 5n }),
        ],
      }),
      snapshot,
    )
    expect(queue.invalid.map((r) => r.reason)).toEqual([
      'hash-mismatch',
      'hash-mismatch',
      'stale-nonce',
    ])
    expect(queue.transactions).toHaveLength(1)
    expect(queue.transactions[0]?.verified.tx.nonce).toBe(5n)
    expect(publishedQueueComplete(queue)).toBe(false)
  })

  it('requires every full field and rejects numeric uints, invalid operations and out-of-range uints', async () => {
    const missingFields = Object.keys(row().tx).map((field) => {
      const fields: Record<string, unknown> = { ...row().tx }
      delete fields[field]
      return { ...row(), tx: fields }
    })
    const queue = await parsePublishedQueue(
      response({
        transactions: [
          ...missingFields,
          { ...row(), tx: { ...row().tx, value: 13 } },
          { ...row(), tx: { ...row().tx, operation: 2 } },
          { ...row(), tx: { ...row().tx, value: (2n ** 256n).toString() } },
        ],
      }),
      snapshot,
    )
    expect(queue.transactions).toEqual([])
    expect(queue.invalid).toHaveLength(13)
    expect(queue.status).toBe('partial')
  })

  it('treats chain/Safe mismatch, malformed metadata and unknown statuses as unknown, not an empty queue', async () => {
    for (const overrides of [
      { chainId: 10 },
      { safe: zeroAddress },
      { status: 'other' },
      { complete: 'true' },
      { rejected: -1 },
      { checkedAt: 'not-a-date' },
      { transactions: undefined },
    ]) {
      const queue = await parsePublishedQueue(response(overrides), snapshot)
      expect(queue).toMatchObject({ status: 'unavailable', complete: false, transactions: [] })
      expect(queue.invalid).toEqual([{ reason: 'invalid-response' }])
      expect(publishedQueueComplete(queue)).toBe(false)
    }
    expect(publishedQueueComplete(undefined)).toBe(false)
  })

  it('keeps unavailable/unsupported unknown even if complete is claimed; handles partial and backend rejections', async () => {
    for (const status of ['unavailable', 'unsupported']) {
      const queue = await parsePublishedQueue(response({ status, complete: true }), snapshot)
      expect(queue).toMatchObject({ status, complete: false, transactions: [] })
      expect(publishedQueueComplete(queue)).toBe(false)
    }
    for (const overrides of [{ status: 'partial' }, { complete: false }, { rejected: 2 }]) {
      const queue = await parsePublishedQueue(
        response({ ...overrides, transactions: [] }),
        snapshot,
      )
      expect(queue).toMatchObject({ status: 'partial', complete: false, transactions: [] })
      expect(publishedQueueComplete(queue)).toBe(false)
    }
    expect(
      publishedQueueComplete(await parsePublishedQueue(response({ transactions: [] }), snapshot)),
    ).toBe(true)
  })

  it('accepts the backend bounds of 250 rows and 128 confirmations, and rejects excess', async () => {
    const queue = await parsePublishedQueue(
      response({
        transactions: [
          {
            ...row(),
            confirmations: Array.from({ length: 128 }, () => ({
              owner: alice.address,
              signature: null,
            })),
          },
        ],
      }),
      snapshot,
    )
    expect(queue.transactions).toHaveLength(1)
    expect(queue.transactions[0]?.rejectedConfirmations).toHaveLength(128)
    const tooManyConfirmations = await parsePublishedQueue(
      response({
        transactions: [
          {
            ...row(),
            confirmations: Array.from({ length: 129 }, () => ({
              owner: alice.address,
              signature: null,
            })),
          },
        ],
      }),
      snapshot,
    )
    expect(tooManyConfirmations.invalid).toHaveLength(1)
    const maxRows = Array.from({ length: 250 }, (_, i) => row({ ...tx, nonce: BigInt(i + 4) }))
    expect(
      (await parsePublishedQueue(response({ transactions: maxRows }), snapshot)).transactions,
    ).toHaveLength(250)
    expect(
      (await parsePublishedQueue(response({ transactions: [...maxRows, row()] }), snapshot)).status,
    ).toBe('unavailable')
  })

  it('bounds verified packages to the existing 100-signature format and reports extra confirmations', async () => {
    const safeTxHash = row().safeTxHash
    const confirmations = await Promise.all(
      Array.from({ length: 101 }, async () => {
        const account = privateKeyToAccount(generatePrivateKey())
        return { owner: account.address, signature: await account.sign({ hash: safeTxHash }) }
      }),
    )
    const queue = await parsePublishedQueue(
      response({ transactions: [{ ...row(), confirmations }] }),
      snapshot,
    )
    expect(queue.transactions[0]?.verified.signatures).toHaveLength(100)
    expect(queue.transactions[0]?.rejectedConfirmations).toMatchObject([
      { reason: 'signature-limit' },
    ])
    expect(Either.isRight(await verifyPackage(queue.transactions[0]?.verified.pkg))).toBe(true)
  }, 20_000)

  it('does not trust reported VERSION() or an unverified implementation', async () => {
    for (const unverified of [
      { ...snapshot, nonce: undefined },
      { ...snapshot, authenticity: { status: 'unknown-proxy' as const, codeHash: hash } },
      {
        ...snapshot,
        authenticity: { ...snapshot.authenticity, status: 'verified' as const, version: '1.2.0' },
      } as SafeSnapshot,
    ]) {
      expect(publishedSnapshot(1, safe, unverified)).toBeUndefined()
      expect((await parsePublishedQueue(response(), unverified)).status).toBe('unavailable')
    }
    expect(publishedSnapshot(10, safe, snapshot)).toBeUndefined()
    expect(publishedSnapshot(1, zeroAddress, snapshot)).toBeUndefined()
  })
})

describe('published/local in-memory union', () => {
  it('deduplicates by hash and unions signatures without changing local notes or inputs', async () => {
    const local = await localPackage({ sign: true, note: 'Local note' })
    const queue = await parsePublishedQueue(
      response({
        transactions: [
          {
            ...row(),
            confirmations: [await confirmation(), await confirmation(bob)],
            reportedConfirmations: 99,
          },
        ],
      }),
      snapshot,
    )
    const before = JSON.stringify(local.pkg)
    const rows = mergePublishedPackages(
      [{ verified: local }],
      [...queue.transactions, ...queue.transactions],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ local: true, published: { reportedConfirmations: 99 } })
    expect(rows[0]?.verified.signatures).toHaveLength(2)
    expect(rows[0]?.verified.pkg.note).toBe('Local note')
    expect(rows[0]?.verified.pkg.createdAt).toBe(local.pkg.createdAt)
    expect(JSON.stringify(local.pkg)).toBe(before)
    expect(classify(rows)[0]).toMatchObject({ state: 'ready', validSignatures: 2 })
    const reverification = await verifyPackage(rows[0]?.verified.pkg)
    expect(Either.isRight(reverification)).toBe(true)
  })

  it('preserves local execution and marks local-only/published-only sources', async () => {
    const local = await localPackage({ note: 'Already executed' })
    const execution = { status: 'executed' as const, txHash: hash, at: checkedAt }
    const queue = await parsePublishedQueue(response(), snapshot)
    const rows = mergePublishedPackages([{ verified: local, execution }], queue.transactions)
    expect(rows[0]?.execution).toEqual(execution)
    expect(rows[0]?.verified.pkg.note).toBe('Already executed')
    expect(classify(rows)[0]?.state).toBe('executed')
    expect(mergePublishedPackages([{ verified: local }], [])[0]).toMatchObject({ local: true })
    expect(mergePublishedPackages([], queue.transactions)[0]).toMatchObject({ local: false })
  })

  it('detects cross-source nonce conflicts with classifyQueue, without merging by nonce', async () => {
    const local = await localPackage()
    const queue = await parsePublishedQueue(
      response({ transactions: [row({ ...tx, value: 14n })] }),
      snapshot,
    )
    const rows = mergePublishedPackages([{ verified: local }], queue.transactions)
    expect(rows).toHaveLength(2)
    expect(classify(rows).map((r) => r.state)).toEqual(['conflict', 'conflict'])
  })
})

describe('published request boundary', () => {
  it('fetches only a fixed same-origin GET with nonce, rejects redirects, and forwards cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response())))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const queue = await fetchPublishedQueue(snapshot, controller.signal)
    const [url, options] = fetcher.mock.calls[0] ?? []
    const target = new URL(url, 'https://local.invalid')
    expect(target.origin).toBe('https://local.invalid')
    expect(target.pathname).toBe('/api/safe-queue')
    expect(Object.fromEntries(target.searchParams)).toEqual({ chainId: '1', safe, nonce: '4' })
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'error',
      mode: 'same-origin',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
    expect(queue.transactions).toHaveLength(1)
  })

  it('uses generic errors for HTTP, parse and transport failure instead of exposing service details', async () => {
    for (const failure of [
      () => Promise.resolve(new Response('sensitive backend detail', { status: 503 })),
      () => Promise.resolve(new Response('not JSON')),
      () => Promise.reject(new Error('sensitive transport URL')),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(failure))
      await expect(fetchPublishedQueue(snapshot)).rejects.toThrow(
        'Published queue could not be checked.',
      )
    }
  })

  it('propagates aborts, and disabled history/unknown targets never fetch', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchPublishedQueue(snapshot, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    fetcher.mockClear()
    const client = new QueryClient()
    const history = publishedQueryOptions(1, safe, snapshot, false)
    const unknown = publishedQueryOptions(1, safe, { ...snapshot, nonce: undefined })
    const mismatched = publishedQueryOptions(10, safe, snapshot)
    for (const options of [history, unknown, mismatched]) {
      expect(options.enabled).toBe(false)
      await expect(client.fetchQuery(options)).rejects.toThrow(
        'Published queue could not be checked.',
      )
    }
    expect(fetcher).not.toHaveBeenCalled()
    client.clear()
  })

  it('has no polling, window-focus/reconnect refetch, or retry; keys pin nonce and code verification', () => {
    const options = publishedQueryOptions(1, safe, snapshot)
    expect(options).toMatchObject({
      enabled: true,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    })
    expect(publishedQueryOptions(1, safe, { ...snapshot, nonce: 5n }).queryKey).not.toEqual(
      options.queryKey,
    )
    expect(publishedQueryOptions(1, safe, snapshot, false).queryKey).not.toEqual(options.queryKey)
  })

  it('constructs pinned Safe queue links, uses the BOB app for BOB, and ignores supplied navigation URLs', async () => {
    const prefixes: Record<number, string> = {
      1: 'eth',
      10: 'oeth',
      56: 'bnb',
      100: 'gno',
      137: 'matic',
      42161: 'arb1',
      43114: 'avax',
      8453: 'base',
      11155111: 'sep',
      60808: 'bob',
    }
    for (const [chainId, prefix] of Object.entries(prefixes)) {
      const link = new URL(publishedSafeUrl(Number(chainId), safe) ?? '')
      expect(link.origin).toBe(
        Number(chainId) === 60808 ? 'https://safe.gobob.xyz' : 'https://app.safe.global',
      )
      expect(link.pathname).toBe('/transactions/queue')
      expect(link.searchParams.get('safe')).toBe(`${prefix}:${safe}`)
    }
    expect(publishedSafeUrl(12345, safe)).toBeNull()
    const queue = await parsePublishedQueue(
      response({ safeUrl: 'javascript:alert(1)', service: 'https://evil.invalid' }),
      snapshot,
    )
    expect(queue.safeUrl).toBe(publishedSafeUrl(1, safe))
  })
})

describe('queue presentation without browser, storage or network I/O', () => {
  const markup = async (overrides: Record<string, unknown>, history = false, failed = false) => {
    const client = new QueryClient()
    const options = publishedQueryOptions(1, safe, snapshot)
    client.setQueryData(
      options.queryKey,
      await parsePublishedQueue(response(overrides), snapshot),
      {
        updatedAt: Date.now() + 60_000,
      },
    )
    if (failed)
      client
        .getQueryCache()
        .find({ queryKey: options.queryKey })
        ?.setState({ status: 'error', error: new Error('sensitive service URL') })
    const result = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Router, {
          ssrPath: `/safe/1/${safe}/${history ? 'history' : 'queue'}`,
          // biome-ignore lint/correctness/noChildrenProp: Router requires children in createElement's props type.
          children: createElement(QueueScreen, { history }),
        }),
      ),
    )
    client.clear()
    return result
  }

  it('never shows No pending for unknown, failed, unsupported or partial responses', async () => {
    for (const overrides of [
      { status: 'unavailable' },
      { status: 'unsupported' },
      { status: 'partial' },
      { chainId: 10 },
      { complete: false },
    ]) {
      const html = await markup({ ...overrides, transactions: [] })
      expect(html).not.toContain('No pending transactions.')
      expect(html).toContain('not fully known')
    }
    const failed = await markup({ transactions: [] }, false, true)
    expect(failed).not.toContain('No pending transactions.')
    expect(failed).not.toContain('sensitive service URL')
    expect(failed).toContain('Published transactions are unknown.')
    expect(await markup({ transactions: [] })).toContain('No pending transactions.')
  })

  it('offers an explicit local review for remote-only rows and never saves or deletes on rendering', async () => {
    const html = await markup({ transactions: [{ ...row(), reportedConfirmations: 99 }] })
    expect(html).toContain('Review locally')
    expect(html).toContain('Published')
    expect(html).toContain('99 service-reported confirmations')
    expect(html).toContain('0 of 2 verified owner signatures')
    expect(html).not.toContain('Ready to execute')
    expect(html).not.toContain(`/tx/${row().safeTxHash}`)
    expect(html).not.toContain('Delete from this browser')
    expect(view.save).not.toHaveBeenCalled()
    expect(view.remove).not.toHaveBeenCalled()
  })

  it('keeps existing local review links and local history without published rows or service fetches', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Network must not be used'))
    vi.stubGlobal('fetch', fetcher)
    const local = await localPackage()
    view.packages = [{ verified: local }]
    const html = await markup({})
    expect(html).toContain(`href="/safe/1/${safe}/tx/${local.hashes.safeTx}"`)
    expect(html).toContain('Published + Local')
    expect(html).not.toContain('Review locally')
    view.packages = [
      { verified: local, execution: { status: 'executed', txHash: hash, at: checkedAt } },
    ]
    const history = await markup({ transactions: [row({ ...tx, nonce: 5n })] }, true)
    expect(history).toContain('Local history')
    expect(history).toContain('Executed')
    expect(history).not.toContain('published-queue-status')
    expect(history).not.toContain('Review locally')
    expect(history).not.toContain('Refresh queue')
    expect(fetcher).not.toHaveBeenCalled()
    expect(view.save).not.toHaveBeenCalled()
  })
})
