import {SuiOperations} from './sui.mjs';

async function readJson(req) {
  const maximum = 256 * 1024;
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] || '') || Number(req.headers['content-length'] || 0) > maximum) throw Error('A bounded JSON request is required.');
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maximum) throw Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Explicit read/build/simulate allowlist: no signature, proposal, creation or execution route.
export function createOtherChainsHandler({operations = new SuiOperations()} = {}) {
  let active = false;
  return async (req, res, pathname) => {
    const send = (code, value) => {res.writeHead(code, {'content-type': 'application/json', 'cache-control': 'no-store'}); res.end(JSON.stringify(value));};
    const action = {'/api/other-chains/sui/inspect': 'inspect', '/api/other-chains/sui/plan': 'plan', '/api/other-chains/sui/simulate': 'simulate'}[pathname];
    if (!action) return send(404, {error: 'Unsupported other-chain action.'});
    if (req.method !== 'POST') return send(405, {error: 'Use an explicit read-only JSON request.'});
    if (!req.headers.origin || req.headers['x-safedesk-readonly'] !== '1') return send(403, {error: 'A same-origin SafeDesk action is required.'});
    if (active) return send(409, {error: 'An other-chain operation is already running.'});
    active = true;
    req.setTimeout(15000, () => req.destroy());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const input = await readJson(req);
      const result = await operations[action](input, controller.signal);
      return send(200, result);
    } catch (error) {
      // Network/SDK errors can include provider paths or payloads; only local guard text is public.
      const known = error?.constructor === Error && !/fetch|https?:|Transaction .*not found|grpc|graphql|connect|timeout/i.test(error.message);
      return send(400, {error: known ? error.message.slice(0, 400) : 'The native Sui read or simulation could not be completed. Check public policy, transaction evidence and provider availability.'});
    } finally {clearTimeout(timeout); active = false;}
  };
}
