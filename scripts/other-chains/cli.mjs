import fs from 'node:fs';
import path from 'node:path';
import {SuiOperations, normalizePolicy} from './sui.mjs';

const help = `SafeDesk Other Chains (no signing or submission)

  npm run other-chains -- inspect --input public-vault.json --out inspection.json
  npm run other-chains -- derive --input target-policy.json --out target-derived.json
  npm run other-chains -- plan --input migration-request.json --out migration-package.json
  npm run other-chains -- simulate --input migration-package.json --out simulation.json

inspect: {vault, signer?, evidenceDigest?, sourcePolicy?}
derive: {threshold, members:[{address?, publicKey, weight}]}
plan: inspect fields plus targetPolicy, objectIds, ackDestination:true, ackPrivileged?
Only public configuration. Private keys, seeds and login tokens are never required.
Plan writes separate actual Mysten V2 JSON in OUT.plain-transaction.json for MSafe.
Addresses without public keys can be resolved from bounded public history when available.
Native policy changes derive a new address: this is migration, not an in-place owner swap.`;

export async function runOtherChains(argv, {operations = new SuiOperations(), write = text => console.log(text)} = {}) {
  if (!argv.length || argv.includes('--help')) {write(help); return;}
  const [action, ...flags] = argv;
  if (!['inspect', 'derive', 'plan', 'simulate'].includes(action) || flags.length % 2 !== 0) throw Error('Unsupported command. Use --help.');
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    if (!['--input', '--out'].includes(flags[i]) || options[flags[i]]) throw Error('Unsupported or repeated option.');
    options[flags[i]] = flags[i + 1];
  }
  if (!options['--input'] || !options['--out']) throw Error('Both --input and --out are required.');
  if (fs.statSync(options['--input']).size > 256 * 1024) throw Error('Public configuration is too large.');
  const input = JSON.parse(fs.readFileSync(options['--input'], 'utf8'));
  const out = path.resolve(options['--out']), plain = `${out}.plain-transaction.json`;
  if (fs.existsSync(out) || (action === 'plan' && fs.existsSync(plain))) throw Error('Output exists; choose a new path. Nothing was overwritten.');
  const result = action === 'derive' ? normalizePolicy(input) : await operations[action](action === 'simulate' ? {package: input} : input);
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  if (action === 'plan') fs.writeFileSync(plain, result.transactionJson + '\n', {flag: 'wx', mode: 0o600});
  write(JSON.stringify({action, output: out, ...(action === 'plan' ? {plainTransaction: plain, transactionDigest: result.transactionDigest} : {}), submitted: false, signed: false}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  runOtherChains(process.argv.slice(2)).catch(() => {console.error('Other-chain command failed. Check public inputs and provider availability; use --help. No signing or submission was attempted.'); process.exitCode = 1;});
}
