import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAINS} from '../safe-batch/core.mjs';
import {PublicChainCatalog} from './chain-catalog.mjs';

const URL = 'https://chainlist.org/rpcs.json';
const HOUR = 60 * 60 * 1000;
const chain = (chainId = 999, extra = {}) => ({chainId, name: 'Example',
  nativeCurrency: {name: 'Example Coin', symbol: 'EX', decimals: 18},
  rpc: ['https://rpc.example/rpc'], explorers: [{name: 'Example Explorer', url: 'https://explorer.example'}],
  ...extra});
const catalogue = data => new PublicChainCatalog(async () => Response.json(data));
const knownIds = Object.keys(CHAINS).map(Number).sort((a,b) => a - b);
function assertFallback(result) {
  assert.equal(result.source, 'built-in');
  assert.deepEqual(result.chains.map(item => item.chainId).sort((a,b) => a - b), knownIds);
  for (const item of result.chains) {
    assert.equal(item.rotationSupported, true);
    assert.equal(item.testnet, false);
    assert.deepEqual(item.rpcs, [new globalThis.URL(CHAINS[item.chainId].rpc).href]);
    assert.equal(item.explorers[0].url, new globalThis.URL(CHAINS[item.chainId].explorer).href);
  }
  assert.equal(new Date(result.fetchedAt).toISOString(), result.fetchedAt);
}

test('fetches only the fixed public catalogue on get, without credentials or redirects', async () => {
  const calls = [];
  const catalog = new PublicChainCatalog(async (...args) => { calls.push(args); return Response.json([chain()]); });
  assert.equal(calls.length, 0);
  const result = await catalog.get();
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, URL);
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.accept, 'application/json');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(result.source, 'chainlist.org');
});

test('retains all positive safe numeric IDs, merges duplicates, and pins rotation support', async () => {
  const result = await catalogue([
    chain(999), chain(999, {name: 'Duplicate', rpc: [{url: 'https://rpc.example/rpc'}, {url: 'https://second.example'}]}),
    chain(4294967296), chain(Number.MAX_SAFE_INTEGER), chain(11155111, {name: 'Ethereum Sepolia'}),
    chain(123, {testnet: true, rotationSupported: true}),
    chain(1, {name: 'Untrusted Ethereum', rotationSupported: false, testnet: true,
      explorers: [{name: 'Impersonation', url: 'https://untrusted.example'}]}),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '999', true, null].map(id => chain(id)),
    null, [], 'malformed'
  ]).get();
  assert.equal(new Set(result.chains.map(item => item.chainId)).size, result.chains.length);
  assert.deepEqual(result.chains.filter(item => !knownIds.includes(item.chainId)).map(item => item.chainId),
    [123, 999, 11155111, 4294967296, Number.MAX_SAFE_INTEGER]);
  const example = result.chains.find(item => item.chainId === 999);
  assert.equal(example.name, 'Example');
  assert.deepEqual(example.rpcs, ['https://rpc.example/rpc', 'https://second.example/']);
  assert.deepEqual(example.explorers, [{name: 'Example Explorer', url: 'https://explorer.example/'}]);
  assert.equal(result.chains.find(item => item.chainId === 11155111).testnet, true);
  assert.equal(result.chains.find(item => item.chainId === 123).rotationSupported, false);
  const ethereum = result.chains.find(item => item.chainId === 1);
  assert.equal(ethereum.name, CHAINS[1].name);
  assert.equal(ethereum.testnet, false);
  assert.equal(ethereum.rotationSupported, true);
  assert.deepEqual(ethereum.nativeCurrency, {name: 'Ether', symbol: 'ETH', decimals: 18});
  assert.equal(ethereum.explorers[0].url, 'https://etherscan.io/');
  assert.equal(result.chains.filter(item => item.rotationSupported).length, 6);
});

test('filters private, local, credential-bearing, placeholder and non-HTTPS endpoints without lookups', async () => {
  const rejected = [
    'http://rpc.example', 'wss://rpc.example', 'file:///tmp/rpc', 'javascript:alert(1)',
    'https://localhost', 'https://sub.localhost', 'https://localhost.', 'https://rpc.local',
    'https://rpc.internal', 'https://rpc.lan', 'https://rpc.home.arpa', 'https://intranet',
    'https://10.1.2.3', 'https://172.16.0.1', 'https://172.31.255.255', 'https://192.168.0.1',
    'https://127.0.0.1', 'https://127.1', 'https://2130706433', 'https://0x7f000001',
    'https://0.0.0.0', 'https://169.254.169.254', 'https://100.64.0.1', 'https://224.0.0.1',
    'https://192.0.2.1', 'https://198.18.0.1', 'https://198.51.100.1', 'https://203.0.113.1',
    'https://[::]', 'https://[::1]', 'https://[fc00::1]', 'https://[fe80::1]',
    'https://[::ffff:127.0.0.1]', 'https://[2001:db8::1]', 'https://[2002:7f00:1::]',
    'https://127.0.0.1.nip.io', 'https://10-0-0-1.sslip.io',
    'https://user:password@rpc.example', 'https://@rpc.example', 'https://rpc.example/#fragment',
    'https://rpc.example/${KEY}', 'https://rpc.example/{key}', 'https://rpc.example/<key>',
    'https://rpc.example/%24%7BKEY%7D', 'https://rpc.example/%253Ckey%253E',
    'https://rpc.example/YOUR_API_KEY', 'https://rpc.example?apikey=credential',
    'https://rpc.example/\npath', 'https://rpc.example/%0apath', 'https://rpc.example\\path',
    'https://rpc.example/%zz', 'https://rpc.example/' + 'x'.repeat(2048)
  ];
  const accepted = ['https://public.example/rpc', 'https://8.8.8.8/rpc', 'https://[2606:4700:4700::1111]/rpc'];
  const result = await catalogue([chain(999, {rpc: [...rejected, ...accepted, {}, null, 123,
    {url: 'https://object.example/rpc', tracking: 'ignored'}],
  explorers: [...rejected.map(url => ({name: 'Rejected', url})),
    {name: 'Redirect', url: 'https://explorer.example/?to=https://localhost'},
    {name: 'Port', url: 'https://explorer.example:8443'},
    {name: 'Safe', url: 'https://explorer.example/chain'}]})]).get();
  const example = result.chains.find(item => item.chainId === 999);
  assert.deepEqual(example.rpcs, [...accepted, 'https://object.example/rpc']);
  assert.deepEqual(example.explorers, [{name: 'Safe', url: 'https://explorer.example/chain'}]);
});

test('bounds metadata and per-chain lists without truncating the chain catalogue', async () => {
  const data = Array.from({length: 100}, (_, i) => chain(100000 + i));
  data.push(chain(999, {name: '\u202e' + 'N'.repeat(300),
    nativeCurrency: {name: 'C'.repeat(300), symbol: 'S'.repeat(100), decimals: 256},
    rpc: Array.from({length: 100}, (_, i) => `https://rpc${i}.example`),
    explorers: Array.from({length: 100}, (_, i) => ({name: 'E'.repeat(300), url: `https://explorer${i}.example`}))}));
  data.push({chainId: 777, name: null, nativeCurrency: [], rpc: {}, explorers: {url: 'javascript:bad'}});
  const result = await catalogue(data).get(), item = result.chains.find(item => item.chainId === 999);
  assert.equal(result.chains.length, 108);
  assert.equal(item.name.length, 120);
  assert.equal(item.nativeCurrency.name.length, 120);
  assert.equal(item.nativeCurrency.symbol.length, 32);
  assert.equal(item.nativeCurrency.decimals, 18);
  assert.equal(item.rpcs.length, 30);
  assert.equal(item.explorers.length, 5);
  assert.equal(item.explorers[0].name.length, 120);
  const missing = result.chains.find(item => item.chainId === 777);
  assert.equal(missing.name, 'Chain 777');
  assert.deepEqual(missing.rpcs, []);
  assert.deepEqual(missing.nativeCurrency, {name: 'Native currency', symbol: 'NATIVE', decimals: 18});
});

test('deduplicates inflight loads, caches for one hour, and prevents cache mutation', async t => {
  let now = Date.now(), calls = 0, resolve;
  t.mock.method(Date, 'now', () => now);
  const response = new Promise(done => { resolve = done; });
  const catalog = new PublicChainCatalog(async () => { calls++; return calls === 1 ? response : Response.json([chain(888)]); });
  const first = catalog.get(), second = catalog.get();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolve(Response.json([chain()]));
  const result = await first;
  assert.equal(await second, result);
  assert.throws(() => result.chains[0].rpcs.push('https://localhost'), TypeError);
  assert.throws(() => { result.chains[0].nativeCurrency.symbol = 'poison'; }, TypeError);
  now += HOUR - 1;
  assert.equal(await catalog.get(), result);
  assert.equal(calls, 1);
  now++;
  const fresh = await catalog.get();
  assert.equal(calls, 2);
  assert.notEqual(fresh.fetchedAt, result.fetchedAt);
  assert.ok(fresh.chains.some(item => item.chainId === 888));
  assert.ok(!fresh.chains.some(item => item.chainId === 999));
});

test('malformed, empty, failed and redirected responses return only fixed public fallbacks', async () => {
  const fetchers = [
    async () => { throw Error('Do not expose credential=private-value'); },
    async () => new Response('private upstream detail', {status: 503}),
    async () => new Response('not json'), async () => Response.json({chains: [chain()]}),
    async () => Response.json([]), async () => Response.json([{chainId: -1}]),
    async () => { const response = Response.json([chain()]); Object.defineProperty(response, 'redirected', {value: true}); return response; },
    async () => { const response = Response.json([chain()]); Object.defineProperty(response, 'url', {value: 'https://untrusted.example'}); return response; }
  ];
  for (const fetcher of fetchers) {
    const result = await new PublicChainCatalog(fetcher).get();
    assertFallback(result);
    assert.ok(!JSON.stringify(result).includes('private-value'));
    assert.ok(!JSON.stringify(result).includes('upstream detail'));
  }
});

test('caches fallback and retries after expiry', async t => {
  let now = Date.now(), calls = 0;
  t.mock.method(Date, 'now', () => now);
  const catalog = new PublicChainCatalog(async () => { if (++calls === 1) throw Error('Offline'); return Response.json([chain()]); });
  const fallback = await catalog.get();
  assertFallback(fallback);
  assert.equal(await catalog.get(), fallback);
  assert.equal(calls, 1);
  now += HOUR;
  assert.equal((await catalog.get()).source, 'chainlist.org');
  assert.equal(calls, 2);
});

test('rejects oversized advertised or streamed bodies, including dishonest content-length', async () => {
  let cancelled = false;
  const huge = new Uint8Array(16 * 1024 * 1024 + 1);
  const stream = new ReadableStream({start(controller) { controller.enqueue(huge); }, cancel() { cancelled = true; }});
  const result = await new PublicChainCatalog(async () => new Response(stream, {headers: {'content-length': '1'}})).get();
  assertFallback(result);
  assert.equal(cancelled, true);
  assertFallback(await new PublicChainCatalog(async () => new Response('[]', {headers: {'content-length': '999999999'}})).get());
});

test('handles JSON across byte chunks within the size limit', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify([chain()]));
  const stream = new ReadableStream({start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
    controller.close();
  }});
  const result = await new PublicChainCatalog(async () => new Response(stream)).get();
  assert.equal(result.source, 'chainlist.org');
  assert.ok(result.chains.some(item => item.chainId === 999));
});

test('times out even an uncooperative fetcher and clears inflight state', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let signal;
  const catalog = new PublicChainCatalog((_url, options) => { signal = options.signal; return new Promise(() => {}); });
  const pending = catalog.get();
  t.mock.timers.tick(10000);
  const result = await pending;
  assert.equal(signal.aborted, true);
  assertFallback(result);
  assert.equal(await catalog.get(), result);
});

test('the timeout also cancels a stalled response body', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let cancelled = false;
  const stream = new ReadableStream({cancel() { cancelled = true; }});
  const catalog = new PublicChainCatalog(async () => new Response(stream));
  const pending = catalog.get();
  await Promise.resolve();
  t.mock.timers.tick(10000);
  assertFallback(await pending);
  assert.equal(cancelled, true);
});
