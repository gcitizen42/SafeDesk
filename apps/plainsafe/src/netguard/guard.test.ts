import { describe, expect, it } from 'vitest'
import { type GuardScope, installNetguard, jsonRpcMethods, NetguardBlockedError } from './guard'
import { createNetLog } from './log'

const APP = 'https://app.test'
const RPC = 'https://rpc.example'

function makeScope() {
  const sent: string[] = []
  const beacons: string[] = []
  class FakeWebSocket {
    url: string
    constructor(url: string | URL) {
      this.url = String(url)
      sent.push(`ws:${this.url}`)
    }
  }
  const scope: GuardScope = {
    fetch: async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      sent.push(url)
      if (url.includes('/fail')) throw new TypeError('connection reset')
      return new Response('{}', { status: url.includes('/500') ? 500 : 200 })
    },
    location: { href: `${APP}/#/setup`, origin: APP },
    WebSocket: FakeWebSocket as unknown as typeof WebSocket,
    navigator: {
      sendBeacon: (url: string | URL) => {
        beacons.push(String(url))
        return true
      },
    },
  }
  const guard = installNetguard(scope)
  return { scope, guard, sent, beacons }
}

const rpcBody = (method: string) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] })

describe('netguard', () => {
  it('blocks everything but the app origin before any policy is set', async () => {
    const { scope, guard, sent } = makeScope()
    await expect(scope.fetch(`${RPC}/v1`)).rejects.toBeInstanceOf(NetguardBlockedError)
    expect(sent).toEqual([])
    await scope.fetch(`${APP}/assets/chunk.js`)
    await scope.fetch('./relative.json')
    expect(sent).toEqual([`${APP}/assets/chunk.js`, './relative.json'])
    const log = guard.log.getSnapshot()
    expect(log.map((e) => e.outcome)).toEqual(['blocked', 'allowed', 'allowed'])
    expect(log[0]).toMatchObject({ host: 'rpc.example', path: '/v1', tag: 'untagged' })
    expect(guard.log.blockedCount()).toBe(1)
  })

  it('allows origins from the policy and logs JSON-RPC methods, including batches', async () => {
    const { scope, guard, sent } = makeScope()
    guard.setPolicy({ origins: [RPC], ccipRead: false })
    await scope.fetch(`${RPC}/v1/1`, { method: 'POST', body: rpcBody('eth_chainId') })
    const batch = JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_getStorageAt', params: [] },
    ])
    await guard.fetchFor('safe')(`${RPC}/v1/1`, { method: 'POST', body: batch })
    expect(sent).toHaveLength(2)
    const [a, b] = guard.log.getSnapshot()
    expect(a).toMatchObject({
      outcome: 'allowed',
      methods: ['eth_chainId'],
      tag: 'untagged',
      status: 200,
    })
    expect(b).toMatchObject({ methods: ['eth_getCode', 'eth_getStorageAt'], tag: 'safe' })
  })

  it('refuses redirects for external requests', async () => {
    const seen: (RequestInit | undefined)[] = []
    const scope: GuardScope = {
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init)
        return new Response('{}')
      },
      location: { href: `${APP}/`, origin: APP },
    }
    const guard = installNetguard(scope)
    guard.setPolicy({ origins: [RPC], ccipRead: false })
    await scope.fetch(RPC, { method: 'POST' })
    await scope.fetch(`${APP}/chunk.js`)
    expect(seen[0]).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(seen[1]?.redirect).toBeUndefined()
  })

  it('matches by origin, not by prefix', async () => {
    const { scope, guard } = makeScope()
    guard.setPolicy({ origins: [RPC], ccipRead: false })
    await expect(scope.fetch('https://rpc.example.evil.test/')).rejects.toThrow(/netguard/)
    await expect(scope.fetch('http://rpc.example/')).rejects.toThrow(/netguard/)
    await expect(scope.fetch('https://rpc.example:8443/')).rejects.toThrow(/netguard/)
  })

  it('removes origins when the policy changes', async () => {
    const { scope, guard } = makeScope()
    guard.setPolicy({ origins: [RPC], ccipRead: false })
    await scope.fetch(RPC)
    guard.setPolicy({ origins: [], ccipRead: false })
    await expect(scope.fetch(RPC)).rejects.toBeInstanceOf(NetguardBlockedError)
  })

  it('records failures and HTTP errors as failed', async () => {
    const { scope, guard } = makeScope()
    guard.setPolicy({ origins: [RPC], ccipRead: false })
    await expect(scope.fetch(`${RPC}/fail`)).rejects.toThrow('connection reset')
    const res = await scope.fetch(`${RPC}/500`)
    expect(res.status).toBe(500)
    const [a, b] = guard.log.getSnapshot()
    expect(a).toMatchObject({ outcome: 'failed', error: 'connection reset' })
    expect(b).toMatchObject({ outcome: 'failed', status: 500 })
  })

  it('allows any https host only for ccip-read requests, and only when enabled', async () => {
    const { scope, guard } = makeScope()
    const gw = 'https://ccip.gateway.test/lookup'
    await expect(guard.ccipFetch(gw)).rejects.toBeInstanceOf(NetguardBlockedError)
    guard.setPolicy({ origins: [], ccipRead: true })
    await guard.ccipFetch(gw)
    await expect(guard.ccipFetch('http://ccip.gateway.test/')).rejects.toThrow(/netguard/)
    await expect(scope.fetch(gw)).rejects.toBeInstanceOf(NetguardBlockedError)
    await expect(guard.fetchFor('other')(gw)).rejects.toBeInstanceOf(NetguardBlockedError)
    expect(() => guard.fetchFor('ccip-read')).toThrow()
    expect(guard.log.getSnapshot().filter((e) => e.outcome === 'allowed')).toHaveLength(1)
  })

  it('guards WebSocket and sendBeacon', () => {
    const { scope, guard, sent, beacons } = makeScope()
    const WS = scope.WebSocket as unknown as new (url: string) => { url: string }
    expect(() => new WS('wss://evil.test/socket')).toThrow(NetguardBlockedError)
    expect(new WS('wss://app.test/hmr').url).toBe('wss://app.test/hmr')
    expect(sent).toEqual(['ws:wss://app.test/hmr'])
    expect(scope.navigator?.sendBeacon?.('https://analytics.test/collect', 'x')).toBe(false)
    expect(beacons).toEqual([])
    expect(guard.log.getSnapshot().map((e) => [e.transport, e.outcome])).toEqual([
      ['websocket', 'blocked'],
      ['websocket', 'allowed'],
      ['beacon', 'blocked'],
    ])
  })

  it('cannot be replaced or installed twice', () => {
    const { scope, guard } = makeScope()
    expect(() => {
      scope.fetch = async () => new Response()
    }).toThrow()
    expect(installNetguard(scope)).toBe(guard)
  })

  it('keeps a bounded log', () => {
    const log = createNetLog(3)
    for (let i = 0; i < 5; i++)
      log.add({
        transport: 'fetch',
        host: 'app.test',
        path: `/${i}`,
        methods: [],
        tag: 'x',
        outcome: 'allowed',
      })
    expect(log.getSnapshot().map((e) => e.path)).toEqual(['/2', '/3', '/4'])
  })

  it('forwards entries for workers', async () => {
    const forwarded: string[] = []
    const scope: GuardScope = {
      fetch: async () => new Response(),
      location: { href: `${APP}/worker.js`, origin: APP },
    }
    installNetguard(scope, {
      source: 'history-worker',
      onEntry: (e) => forwarded.push(`${e.source}:${e.outcome}`),
    })
    await expect(scope.fetch(RPC)).rejects.toThrow()
    expect(forwarded).toEqual(['history-worker:blocked'])
  })

  it('forwards later updates for workers, by the worker-side id', async () => {
    const seen: string[] = []
    const scope: GuardScope = {
      fetch: async () => new Response('', { status: 503 }),
      location: { href: `${APP}/worker.js`, origin: APP },
    }
    const guard = installNetguard(scope, {
      source: 'history-worker',
      onEntry: (e, id) => seen.push(`add ${id} ${e.outcome}`),
      onUpdate: (id, patch) => seen.push(`update ${id} ${patch.outcome} ${patch.status}`),
    })
    guard.setPolicy({ origins: [new URL(RPC).origin], ccipRead: false })
    await scope.fetch(RPC)
    expect(seen).toEqual(['add 1 allowed', 'update 1 failed 503'])
  })
})

describe('jsonRpcMethods', () => {
  it('parses single calls, batches and junk', () => {
    expect(jsonRpcMethods(rpcBody('eth_call'))).toEqual(['eth_call'])
    expect(jsonRpcMethods('[{"method":"a"},{"method":"b"},{"x":1}]')).toEqual(['a', 'b'])
    expect(jsonRpcMethods('not json')).toEqual([])
    expect(jsonRpcMethods(undefined)).toEqual([])
    expect(jsonRpcMethods('null')).toEqual([])
  })
})
