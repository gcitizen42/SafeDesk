#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const project = fileURLToPath(new URL('../../', import.meta.url));
const isFile = file => {
  try {return fs.statSync(file).isFile();} catch {return false;}
};

export function checkNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match || Number(match[1]) < 22 || (Number(match[1]) === 22 && Number(match[2]) < 12)) {
    throw Error(`SafeDesk requires Node.js 22.12 or newer; found ${version}. Install a supported Node.js release, then reopen your terminal.`);
  }
}

export function resolveNpm({
  execPath = process.execPath,
  env = process.env,
  platform = process.platform,
  fileExists = isFile,
  realpath = fs.realpathSync,
} = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const nodeDir = paths.dirname(execPath);
  const candidates = [env.npm_execpath];
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
  const searchDirs = [nodeDir, ...(env[pathKey] || '').split(paths.delimiter).filter(Boolean)];
  for (const dir of searchDirs) {
    candidates.push(
      paths.join(dir, 'node_modules/npm/bin/npm-cli.js'),
      paths.resolve(dir, '../lib/node_modules/npm/bin/npm-cli.js'),
    );
    // Unix npm wrappers are usually symlinks; never execute a Windows .cmd wrapper.
    if (platform !== 'win32') candidates.push(paths.join(dir, 'npm'));
  }
  for (const candidate of candidates) {
    if (!candidate || !paths.isAbsolute(candidate)) continue;
    let cli;
    try {cli = realpath(candidate);} catch {continue;}
    if (paths.basename(cli) === 'npm-cli.js' && fileExists(cli)) {
      return {command: execPath, args: [cli]};
    }
  }
  throw Error('Cannot locate npm-cli.js. Install Node.js with npm, reopen your terminal, and run npm run install:desk from this repository.');
}

export function runCommand(command, args, {cwd, env, spawn = spawnSync} = {}) {
  const result = spawn(command, args, {cwd, env, stdio: 'inherit', shell: false});
  if (result.error) throw Error(`Could not start ${path.basename(command)}: ${result.error.message}`, {cause: result.error});
  if (result.signal) {
    const error = Error(`Setup stopped by ${result.signal}. No later setup steps were run.`);
    error.exitCode = result.signal === 'SIGINT' ? 130 : 1;
    throw error;
  }
  if (result.status !== 0) {
    const error = Error(`Setup command failed (exit ${result.status ?? 'unknown'}). No later setup steps were run.`);
    error.exitCode = Number.isInteger(result.status) && result.status > 0 && result.status < 256 ? result.status : 1;
    throw error;
  }
}

export function installDesk({
  root = project,
  nodeVersion = process.versions.node,
  execPath = process.execPath,
  env = process.env,
  platform = process.platform,
  fileExists = isFile,
  realpath = fs.realpathSync,
  run = runCommand,
  log = console.log,
  warn = console.warn,
} = {}) {
  checkNodeVersion(nodeVersion);
  const paths = platform === 'win32' ? path.win32 : path.posix;
  for (const name of ['package.json', 'package-lock.json', 'apps/plainsafe/package.json', 'apps/plainsafe/bun.lock', 'scripts/safedesk/start.mjs']) {
    if (!fileExists(paths.join(root, name))) {
      throw Error(`Incomplete checkout: ${name} is missing. Use a full checkout of the SafeDesk repository.`);
    }
  }
  const npm = resolveNpm({execPath, env, platform, fileExists, realpath});
  const options = {cwd: root, env};
  try {run(platform === 'win32' ? 'git.exe' : 'git', ['--version'], options);}
  catch (error) {
    if (error.cause?.code !== 'ENOENT') throw error;
    warn('Git is not on PATH. Setup can continue from a complete source archive; install Git to clone or update the repository.');
  }

  const steps = [
    {label: 'Installing root dependencies (lifecycle scripts disabled)', args: ['ci', '--ignore-scripts']},
    {label: 'Installing manager dependencies with the repository-pinned Bun', args: ['run', 'setup:manager']},
    {label: 'Building Safe Management', args: ['run', 'build:manager']},
  ];
  for (const [index, step] of steps.entries()) {
    log(`[${index + 1}/${steps.length}] ${step.label}`);
    try {run(npm.command, [...npm.args, ...step.args], options);}
    catch (error) {
      const failure = Error(`${step.label} failed: ${error.message}\nFix the reported error, then rerun npm run install:desk.`, {cause: error});
      failure.exitCode = error.exitCode ?? 1;
      throw failure;
    }
  }
  log('Setup complete. Run npm start, then open http://127.0.0.1:8772/ (rotations: http://127.0.0.1:8772/#/rotations).');
  log('Safe Management wallet actions stay disabled unless you start with --enable-wallet-actions. Review and confirm every wallet request.');
}

export function main(args = process.argv.slice(2), options) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    (options?.log ?? console.log)('Usage: npm run install:desk\nInstalls locked dependencies and builds Safe Management. Does not start the app or change user configuration.\nPass --root, --port, or --enable-wallet-actions to npm start, not to this installer.');
    return;
  }
  if (args.length) throw Error('The installer accepts only --help. Pass app options to npm start -- <options>.');
  installDesk(options);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {main();}
  catch (error) {console.error(error.message); process.exitCode = error.exitCode ?? 1;}
}
