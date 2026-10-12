#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from '../safe-batch/server.mjs';
import {createManagerServer,validPort} from './manager-server.mjs';
import {PublicChainCatalog} from './chain-catalog.mjs';
import {ChainCatalog} from '../safe-batch/workflow.mjs';

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
export async function startDesk({root = defaultBatch(),port = 8770,managerPort = 8772,dist,walletActions = false} = {}) {
  port = validPort(port); managerPort = validPort(managerPort);
  const catalog = new PublicChainCatalog();
  const manager = createManagerServer({port:managerPort,rotationPort:port,dist,walletActions,catalog});
  const rotations = createServer(path.resolve(root),{port,managerPort,catalog:new ChainCatalog(catalog)});
  try {await listen(manager,managerPort); await listen(rotations,port);}
  catch (error) {await Promise.all([close(manager),close(rotations)]);throw error;}
  return {manager,rotations,close:() => Promise.all([close(manager),close(rotations)])};
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const option = (name,fallback) => {const i = args.indexOf(name);if(i >= 0 && !args[i+1])throw Error(`${name} requires a value`);return i < 0 ? fallback : args[i+1];};
  try {
    const port = validPort(option('--port',8770)), managerPort = validPort(option('--manager-port',8772));
    const desk = await startDesk({root:option('--root',defaultBatch()),port,managerPort,walletActions:args.includes('--enable-wallet-actions')});
    console.log(`SafeDesk Safe Management: http://127.0.0.1:${managerPort}/`);
    console.log(`SafeDesk Rotations & Simulations: http://127.0.0.1:${port}/`);
    console.log(args.includes('--enable-wallet-actions') ? 'Safe Management wallet actions explicitly enabled; review every wallet request.' : 'Safe Management is read-only. Rotation signing/proposals have their existing separate controls.');
    const stop = async() => {await desk.close();process.exit();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  } catch(error) {console.error(error.code === 'EADDRINUSE' ? 'A local port is already occupied. Stop the old SafeDesk server or use --port and --manager-port.' : error.message);process.exitCode = 1;}
}
