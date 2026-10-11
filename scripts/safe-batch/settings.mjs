import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

const envFile = root => path.join(root, 'secrets', 'safedesk.env');
const prefsFile = root => path.join(root, 'secrets', 'settings.json');
export function privateConfig(root) {
  const file = envFile(root);
  return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
}
export function preferences(root) {
  const file = prefsFile(root);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
export function rpcFor(root, chainId, fallback) {
  return privateConfig(root)[`SAFEDESK_RPC_${chainId}`] || fallback;
}
export function publicSettings(root) {
  const env = privateConfig(root), prefs = preferences(root);
  return {
    rpcChains: Object.keys(env).filter(k => k.startsWith('SAFEDESK_RPC_')).map(k => Number(k.slice(13))),
    tenderlyEnabled: prefs.tenderlyEnabled,
    tenderlyAccount: env.TENDERLY_ACCOUNT_SLUG || '',
    tenderlyProject: env.TENDERLY_PROJECT_SLUG || '',
    tenderlyKeyPresent: !!env.TENDERLY_ACCESS_KEY
  };
}
function atomic(file, data) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, data, {mode: 0o600});
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}
export function saveSettings(root, {chainId, rpcUrl, tenderly} = {}) {
  const env = privateConfig(root), prefs = preferences(root);
  if (rpcUrl) env[`SAFEDESK_RPC_${chainId}`] = rpcUrl;
  if (tenderly) {
    if (typeof tenderly.enabled !== 'boolean') throw Error('Choose whether Tenderly is enabled');
    for (const [field, variable] of [['account', 'TENDERLY_ACCOUNT_SLUG'], ['project', 'TENDERLY_PROJECT_SLUG'], ['key', 'TENDERLY_ACCESS_KEY']]) {
      if (tenderly[field]) {
        const value = String(tenderly[field]).trim();
        if (/[\r\n\0]/.test(value) || (field !== 'key' && !/^[\w-]+$/.test(value))) throw Error('Invalid Tenderly configuration');
        env[variable] = value;
      }
    }
    prefs.tenderlyEnabled = tenderly.enabled;
  }
  fs.mkdirSync(path.dirname(envFile(root)), {recursive: true, mode: 0o700});
  const encoded = Object.entries(env).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n';
  const decoded = parseEnv(encoded);
  if (Object.entries(env).some(([k,v]) => decoded[k] !== v)) throw Error('Configuration contains unsupported environment-file characters');
  atomic(envFile(root), encoded);
  atomic(prefsFile(root), JSON.stringify(prefs, null, 2));
  return publicSettings(root);
}
function nonPublic(address) {
  const a = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(a) === 4) {
    const [x,y] = a.split('.').map(Number);
    return x === 0 || x === 10 || x === 127 || (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) ||
      (x === 100 && y >= 64 && y <= 127) || x >= 224;
  }
  return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('::ffff:');
}
export function rpcUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw Error('Enter a valid HTTPS RPC URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || /[\r\n\0$<>{}]/.test(value) ||
      u.hostname === 'localhost' || u.hostname.endsWith('.local') || u.hostname.endsWith('.localhost') ||
      (isIP(u.hostname.replace(/^\[|\]$/g, '')) && nonPublic(u.hostname))) throw Error('RPC must use a public HTTPS endpoint without login credentials or placeholders');
  return u.href;
}
export async function validateRpcUrl(value, resolver = lookup) {
  const url = rpcUrl(value), host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try { addresses = await resolver(host, {all: true}); } catch { throw Error('RPC hostname could not be resolved'); }
  if (!addresses.length || addresses.some(x => nonPublic(x.address))) throw Error('Private and local network RPC endpoints are not accepted');
  return url;
}
