#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createBatchHandler} from '../safe-batch/server.mjs';
import {createManagerServer,validPort} from './manager-server.mjs';
import {PublicChainCatalog} from './chain-catalog.mjs';
import {ChainCatalog} from '../safe-batch/workflow.mjs';
import {verifyBuild} from './build-integrity.mjs';

export const project = path.resolve(import.meta.dirname,'../..');
export function defaultBatch() {
  const current = path.join(project,'operations/2026-10-09-outstanding-rotations');
  return fs.existsSync(path.join(current,'batch.json')) ? current : path.join(project,'operations/batch');
}
const listen = (server,port) => new Promise((resolve,reject) => {
  server.once('error',reject);
  server.listen(port,'127.0.0.1',() => {server.off('error',reject);resolve();});
});
const close = server => new Promise(resolve => server.listening ? server.close(resolve) : resolve());
export async function startDesk({root = defaultBatch(),port = 8772,dist,walletActions = false} = {}) {
  port = validPort(port);
  const catalog = new PublicChainCatalog();
  const integrity=verifyBuild(dist);
  const batchHandler=createBatchHandler(path.resolve(root),{port,managerPort:port,prefix:'/api/rotations',catalog:new ChainCatalog(catalog)});
  const server=createManagerServer({port,dist,walletActions,catalog,batchHandler,integrity});
  await listen(server,port);
  return {server,close:()=>close(server)};
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const option = (name,fallback) => {const i = args.indexOf(name);if(i >= 0 && !args[i+1])throw Error(`${name} requires a value`);return i < 0 ? fallback : args[i+1];};
  try {
    if(args.includes('--manager-port'))throw Error('SafeDesk now uses one port. Use --port for the whole app.');
    const port = validPort(option('--port',8772));
    const desk = await startDesk({root:option('--root',defaultBatch()),port,walletActions:args.includes('--enable-wallet-actions')});
    console.log(`SafeDesk: http://127.0.0.1:${port}/`);
    console.log(`Safe Ownership Management: http://127.0.0.1:${port}/#/rotations`);
    console.log(args.includes('--enable-wallet-actions') ? "My Safe's wallet actions explicitly enabled; review every wallet request." : "My Safe's is read-only. Ownership signing/proposals have their existing separate controls.");
    const stop = async() => {await desk.close();process.exit();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  } catch(error) {console.error(error.code === 'EADDRINUSE' ? 'The local port is already occupied. Stop the old SafeDesk server or use --port.' : error.message);process.exitCode = 1;}
}
