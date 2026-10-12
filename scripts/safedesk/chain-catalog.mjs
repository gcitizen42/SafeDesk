import {isIP} from 'node:net';
import {CHAINS} from '../safe-batch/core.mjs';

const CATALOG_URL = 'https://chainlist.org/rpcs.json';
const TIMEOUT_MS = 10000;
const CACHE_MS = 60 * 60 * 1000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_URL = 2048;
const MAX_RPCS = 30;
const MAX_EXPLORERS = 5;
const ownObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit, fallback) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit) || fallback
  : fallback;

function publicHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const ip = isIP(host);
  if (ip === 4) {
    const [a,b,c] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (ip === 6) {
    const [first, second] = host.split(':').map(part => Number.parseInt(part || '0', 16));
    // Only global unicast, excluding special-purpose, documentation and tunnel ranges.
    return first >= 0x2000 && first < 0x3fff && first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
  }
  const labels = host.split('.');
  return labels.length > 1 && host.length <= 253 &&
    labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/^\d+$/.test(labels.at(-1)) &&
    !/(^|\.)(localhost|local|localdomain|internal|intranet|private|lan|home|corp|onion|arpa|invalid|test)$/.test(host) &&
    !/(^|\.)(nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host);
}

function publicUrl(value, explorer = false) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL) return null;
  try {
    let decoded = value;
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (/[\s\u0000-\u001f\u007f\\$<>{}@]/.test(decoded) ||
        /(?:api[_-]?key|your[_-]|insert[_-]|replace[_-]|project[_-]?id|access[_-]?token)/i.test(decoded)) return null;
    const url = new URL(value);
    if (!/^https:\/\//i.test(value) || url.protocol !== 'https:' || url.username || url.password ||
        url.hash || !publicHost(url.hostname) || url.href.length > MAX_URL) return null;
    if (explorer && (url.search || url.port)) return null;
    return url.href;
  } catch { return null; }
}

const builtIns = Object.entries(CHAINS).map(([id, chain]) => ({
  chainId: Number(id), name: chain.name, rpcs: [publicUrl(chain.rpc)],
  nativeCurrency: Number(id) === 137
    ? {name: 'Polygon Ecosystem Token', symbol: 'POL', decimals: 18}
    : {name: 'Ether', symbol: 'ETH', decimals: 18},
  explorers: [{name: chain.name + ' Explorer', url: publicUrl(chain.explorer, true)}],
  testnet: false, rotationSupported: true
}));
const knownChains = new Map(builtIns.map(chain => [chain.chainId, chain]));
const fallbackChains = () => builtIns.map(chain => ({...chain, rpcs: [...chain.rpcs],
  nativeCurrency: {...chain.nativeCurrency}, explorers: chain.explorers.map(explorer => ({...explorer}))}));

function parseChains(data) {
  if (!Array.isArray(data)) throw Error('Invalid catalogue');
  const chains = new Map(fallbackChains().map(chain => [chain.chainId, chain]));
  let valid = 0;
  for (const entry of data) {
    if (!ownObject(entry) || !Number.isSafeInteger(entry.chainId) || entry.chainId <= 0) continue;
    valid++;
    const id = entry.chainId, known = knownChains.has(id);
    let chain = chains.get(id);
    if (!chain) {
      const currency = ownObject(entry.nativeCurrency) ? entry.nativeCurrency : {};
      const name = text(entry.name, 120, `Chain ${id}`);
      chain = {chainId: id, name, rpcs: [], nativeCurrency: {
        name: text(currency.name, 120, 'Native currency'),
        symbol: text(currency.symbol, 32, 'NATIVE'),
        decimals: Number.isInteger(currency.decimals) && currency.decimals >= 0 && currency.decimals <= 255
          ? currency.decimals : 18
      }, explorers: [], testnet: typeof entry.testnet === 'boolean' ? entry.testnet :
        entry.network === 'testnet' || /(?:^|[\s_-])(testnet|test|sepolia|goerli|holesky|hoodi|ropsten|rinkeby|kovan)(?:$|[\s_-])/i.test(name),
      rotationSupported: false};
      chains.set(id, chain);
    }
    for (const rpc of Array.isArray(entry.rpc) ? entry.rpc : []) {
      const url = publicUrl(typeof rpc === 'string' ? rpc : ownObject(rpc) ? rpc.url : null);
      if (url && chain.rpcs.length < MAX_RPCS && !chain.rpcs.includes(url)) chain.rpcs.push(url);
    }
    // Pin known explorers; never pass unchecked catalogue links to the frontend.
    if (!known) for (const explorer of Array.isArray(entry.explorers) ? entry.explorers : []) {
      if (!ownObject(explorer)) continue;
      const url = publicUrl(explorer.url, true);
      if (url && chain.explorers.length < MAX_EXPLORERS && !chain.explorers.some(item => item.url === url)) {
        chain.explorers.push({name: text(explorer.name, 120, 'Explorer'), url});
      }
    }
  }
  if (!valid) throw Error('Empty catalogue');
  return [...chains.values()].sort((a,b) => a.chainId - b.chainId);
}

async function readCatalogue(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw Error('Catalogue too large');
  }
  if (!response.body) throw Error('Empty catalogue');
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0, finished = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    signal.throwIfAborted();
    while (true) {
      const {value, done} = await reader.read();
      signal.throwIfAborted();
      if (done) { finished = true; break; }
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw Error('Catalogue too large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!finished) cancel();
    reader.releaseLock();
  }
}

function freezeCatalogue(value) {
  for (const chain of value.chains) {
    Object.freeze(chain.rpcs);
    Object.freeze(chain.nativeCurrency);
    chain.explorers.forEach(Object.freeze);
    Object.freeze(chain.explorers);
    Object.freeze(chain);
  }
  Object.freeze(value.chains);
  return Object.freeze(value);
}

export class PublicChainCatalog {
  #fetcher;
  #cache = null;
  #inflight = null;
  constructor(fetcher = fetch) { this.#fetcher = fetcher; }
  get() {
    if (this.#cache?.expires > Date.now()) return Promise.resolve(this.#cache.value);
    if (!this.#inflight) this.#inflight = this.#load().finally(() => { this.#inflight = null; });
    return this.#inflight;
  }
  async #fetch(signal) {
    const response = await this.#fetcher(CATALOG_URL, {redirect: 'error', credentials: 'omit',
      headers: {accept: 'application/json'}, signal});
    if (signal.aborted || !response.ok || response.redirected || (response.url && response.url !== CATALOG_URL)) {
      void response.body?.cancel().catch(() => {});
      throw Error('Catalogue unavailable');
    }
    return readCatalogue(response, signal);
  }
  async #load() {
    const controller = new AbortController();
    let timer, source = 'built-in', chains = fallbackChains();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('Catalogue timed out')); }, TIMEOUT_MS);
    });
    try {
      chains = parseChains(await Promise.race([this.#fetch(controller.signal), timeout]));
      source = 'chainlist.org';
    } catch { /* Only fixed public defaults are used when the catalogue is unavailable. */ }
    finally { clearTimeout(timer); controller.abort(); }
    const now = Date.now();
    const value = freezeCatalogue({source, fetchedAt: new Date(now).toISOString(), chains});
    this.#cache = {value, expires: now + CACHE_MS};
    return value;
  }
}
