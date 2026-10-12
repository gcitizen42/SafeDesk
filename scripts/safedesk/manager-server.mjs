import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {PublicChainCatalog} from './chain-catalog.mjs';
import {SafeQueueReader} from './safe-queue.mjs';

export const defaultDist = path.resolve(import.meta.dirname, '../../apps/plainsafe/dist');
export const upstreamCommit = '9a23f9ab38501cf09bb5464b2b5684314e9fb7d5';
export function validPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid local port');
  return port;
}

// One local origin serves the app and a deliberately namespaced, token-protected batch API.
export function createManagerServer({dist = defaultDist, port = 8772, walletActions = false, catalog = new PublicChainCatalog(), batchHandler, integrity, queueReader = new SafeQueueReader()} = {}) {
  validPort(port);
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) throw Error('Build Safe Management first: npm run setup:manager && npm run build:manager');
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const security = {'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer', 'x-frame-options':'DENY', 'cross-origin-resource-policy':'same-origin', 'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src https: wss: http://localhost:* http://127.0.0.1:*; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"};
  const reply = (res, status, body) => {res.writeHead(status, {...security, 'content-type':'text/plain; charset=utf-8', 'cache-control':'no-store'});res.end(body);};
  return http.createServer(async(req,res) => {
    if (!origins.has(`http://${req.headers.host}`) || (req.headers.origin && !origins.has(req.headers.origin))) return reply(res,403,'Unexpected local origin');
    let pathname;
    try {pathname = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname);} catch {return reply(res,400,'Invalid path');}
    for(const [name,value]of Object.entries(security))res.setHeader(name,value);
    if(pathname.startsWith('/api/rotations/')&&batchHandler)return batchHandler(req,res);
    if (!['GET','HEAD'].includes(req.method)) return reply(res,405,'Read-only file server');
    if(pathname==='/api/safe-queue'){
      if(req.method==='HEAD'){res.writeHead(200,{...security,'content-type':'application/json','cache-control':'no-store'});return res.end();}
      try{const query=new URL(req.url,`http://127.0.0.1:${port}`).searchParams;const result=await queueReader.get({chainId:query.get('chainId'),safe:query.get('safe'),nonce:query.get('nonce')});res.writeHead(200,{...security,'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(result));}
      catch{return reply(res,400,'Invalid Safe queue request');}
    }
    if(pathname==='/api/chains'){
      try{const value=req.method==='HEAD'?null:await catalog.get();res.writeHead(200,{...security,'content-type':'application/json','cache-control':'no-store'});return res.end(value?JSON.stringify(value):'');}catch{return reply(res,503,'Public chain catalogue unavailable');}
    }
    if (pathname === '/.well-known/safedesk-manager') {
      res.writeHead(200,{...security,'content-type':'application/json','cache-control':'no-store'});
      return res.end(req.method === 'HEAD' ? '' : JSON.stringify({app:'SafeDesk',upstreamCommit,rotationsPath:'/#/rotations',walletActions:walletActions === true,build:integrity?.summary||null}));
    }
    const home = pathname === '/' || pathname === '/index.html';
    if (!home && !/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2?|png|svg)$/.test(pathname)) return reply(res,404,'Not found');
    const file = home ? index : path.join(dist, pathname);
    try {
      const real = fs.realpathSync(file), base = fs.realpathSync(dist);
      if (!real.startsWith(base + path.sep) || !fs.statSync(real).isFile()) return reply(res,404,'Not found');
      let content = fs.readFileSync(real);
      if(integrity&&!integrity.matches(path.relative(base,real).split(path.sep).join('/'),content))return reply(res,503,'Build integrity changed. Rebuild and restart SafeDesk.');
      if (home) content = content.toString().replace('<head>', `<head><meta name="safedesk-wallet-actions" content="${walletActions === true ? 'enabled' : 'disabled'}">`);
      const ext = path.extname(file), type = home ? 'text/html; charset=utf-8' : {'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'}[ext];
      res.writeHead(200,{...security,'content-type':type,'cache-control':home?'no-store':'public, max-age=31536000, immutable'});
      res.end(req.method === 'HEAD' ? '' : content);
    } catch {reply(res,404,'Not found');}
  });
}
