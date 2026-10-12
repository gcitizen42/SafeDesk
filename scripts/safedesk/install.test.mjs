import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {checkNodeVersion, installDesk, main, resolveNpm, runCommand} from './install.mjs';

function fixture(platform = 'linux') {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const root = platform === 'win32' ? 'C:\\SafeDesk folder & notes\\repo' : '/SafeDesk folder & notes/repo';
  const execPath = platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/opt/node bin/node';
  const cli = paths.join(paths.dirname(execPath), 'node_modules/npm/bin/npm-cli.js');
  const env = {npm_execpath: cli, PATH: paths.dirname(execPath)};
  const files = new Set([
    cli,
    ...['package.json', 'package-lock.json', 'apps/plainsafe/package.json', 'apps/plainsafe/bun.lock', 'scripts/safedesk/start.mjs'].map(name => paths.join(root, name)),
  ]);
  const calls = [], logs = [], warnings = [];
  const options = {
    root, execPath, env, platform, nodeVersion: '22.12.0',
    fileExists: file => files.has(file),
    realpath: file => {
      if (!files.has(file)) throw Object.assign(Error('missing'), {code: 'ENOENT'});
      return file;
    },
    run: (command, args, opts) => calls.push({command, args, ...opts}),
    log: message => logs.push(message),
    warn: message => warnings.push(message),
  };
  return {options, calls, logs, warnings, files, cli, paths};
}

test('requires Node 22.12+ before checking files or executing commands', () => {
  for (const version of ['22.12.0', 'v22.13.1', '24.0.0', '25.2.1']) checkNodeVersion(version);
  for (const version of ['18.20.0', '20.19.0', '22.0.0', '22.11.9', 'garbage']) {
    assert.throws(() => checkNodeVersion(version), /requires Node.js 22.12/);
    const f = fixture();
    f.options.nodeVersion = version;
    f.options.fileExists = () => assert.fail('must reject Node before accessing files');
    assert.throws(() => installDesk(f.options), /requires Node.js 22.12/);
    assert.deepEqual(f.calls, []);
  }
});

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`${platform}: setup awaits all three fixed npm steps in repo root, without shell quoting`, () => {
    const f = fixture(platform);
    installDesk(f.options);
    assert.deepEqual(f.calls, [
      {command: platform === 'win32' ? 'git.exe' : 'git', args: ['--version'], cwd: f.options.root, env: f.options.env},
      ...[['ci', '--ignore-scripts'], ['run', 'setup:manager'], ['run', 'build:manager']].map(args => ({
        command: f.options.execPath, args: [f.cli, ...args], cwd: f.options.root, env: f.options.env,
      })),
    ]);
    assert.equal(f.warnings.length, 0);
    assert.match(f.logs.at(-2), /8772\/#\/rotations/);
    assert.match(f.logs.at(-1), /stay disabled/);
    assert.ok(f.calls.every(call => !call.args.includes('--enable-wallet-actions')));
  });

  test(`${platform}: direct Node invocation finds bundled npm without npm_execpath`, () => {
    const f = fixture(platform);
    delete f.options.env.npm_execpath;
    assert.deepEqual(resolveNpm(f.options), {command: f.options.execPath, args: [f.cli]});
  });
}

test('POSIX npm symlink resolves to npm CLI, not an executable shell wrapper', () => {
  const f = fixture('darwin');
  const cli = '/opt/npm installation/libexec/lib/node_modules/npm/bin/npm-cli.js';
  f.files.delete(f.cli);
  f.files.add(cli);
  f.options.env = {PATH: '/opt/npm installation/bin'};
  f.options.realpath = file => {
    if (file === '/opt/npm installation/bin/npm') return cli;
    throw Error('missing');
  };
  assert.deepEqual(resolveNpm(f.options), {command: f.options.execPath, args: [cli]});
});

test('Windows discovers npm on case-insensitive Path even when Node lives elsewhere', () => {
  const f = fixture('win32');
  const cli = 'D:\\npm tools & cache\\node_modules\\npm\\bin\\npm-cli.js';
  f.files.delete(f.cli);
  f.files.add(cli);
  f.options.env = {Path: 'D:\\npm tools & cache;C:\\other tools'};
  assert.deepEqual(resolveNpm(f.options), {command: f.options.execPath, args: [cli]});
});

test('npm_execpath from npm run takes priority over another npm on PATH', () => {
  const f = fixture('win32');
  const cli = 'D:\\active npm\\bin\\npm-cli.js';
  f.files.add(cli);
  f.options.env.npm_execpath = cli;
  assert.deepEqual(resolveNpm(f.options), {command: f.options.execPath, args: [cli]});
});

test('never invokes npm.cmd, npm.exe, other package managers, or relative npm_execpath through Node', () => {
  for (const candidate of ['C:\\npm tools\\npm.cmd', 'C:\\npm tools\\npm.exe', 'C:\\tools\\yarn.js', 'npm-cli.js']) {
    const f = fixture('win32');
    f.options.env.npm_execpath = candidate;
    f.files.add(candidate);
    assert.deepEqual(resolveNpm(f.options), {command: f.options.execPath, args: [f.cli]});
    f.files.delete(f.cli);
    assert.throws(() => resolveNpm(f.options), /Cannot locate npm-cli.js/);
    assert.deepEqual(f.calls, []);
  }
});

test('missing checkout files fail before dependency installation', () => {
  for (const name of ['package.json', 'package-lock.json', 'apps/plainsafe/package.json', 'apps/plainsafe/bun.lock', 'scripts/safedesk/start.mjs']) {
    const f = fixture();
    f.files.delete(f.paths.join(f.options.root, name));
    assert.throws(() => installDesk(f.options), /Incomplete checkout/);
    assert.deepEqual(f.calls, []);
  }
});

test('missing npm fails before any process is started', () => {
  const f = fixture();
  f.files.delete(f.cli);
  assert.throws(() => installDesk(f.options), /Install Node.js with npm/);
  assert.deepEqual(f.calls, []);
});

test('missing Git warns but a full source archive can still install', () => {
  const f = fixture('win32');
  const run = f.options.run;
  f.options.run = (command, args, opts) => {
    run(command, args, opts);
    if (command === 'git.exe') throw Error('Git missing', {cause: Object.assign(Error('missing'), {code: 'ENOENT'})});
  };
  installDesk(f.options);
  assert.equal(f.calls.length, 4);
  assert.equal(f.warnings.length, 1);
  assert.match(f.warnings[0], /Git is not on PATH/);
});

test('Git interruption or execution failure is not mistaken for missing Git', () => {
  const f = fixture();
  f.options.run = () => {throw Error('Setup stopped by SIGINT');};
  assert.throws(() => installDesk(f.options), /SIGINT/);
  assert.deepEqual(f.logs, []);
  assert.deepEqual(f.warnings, []);
});

for (const failAt of [1, 2, 3]) {
  test(`failure in setup step ${failAt} prevents every subsequent step and success message`, () => {
    const f = fixture();
    const run = f.options.run;
    f.options.run = (command, args, opts) => {
      run(command, args, opts);
      if (f.calls.length === failAt + 1) throw Object.assign(Error('injected failure'), {exitCode: 17});
    };
    assert.throws(() => installDesk(f.options), error => {
      assert.equal(error.exitCode, 17);
      assert.match(error.message, /injected failure/);
      assert.match(error.message, /rerun npm run install:desk/);
      return true;
    });
    assert.equal(f.calls.length, failAt + 1);
    assert.ok(f.logs.every(message => !message.includes('Setup complete')));
  });
}

test('process runner waits, inherits the console, and disables shell execution', () => {
  const command = 'C:\\Program Files\\nodejs\\node.exe';
  const args = ['C:\\npm tools & cache\\npm-cli.js', 'ci', '--ignore-scripts'];
  const cwd = 'C:\\SafeDesk folder & notes\\repo';
  const env = {PATH: 'test'};
  let called = false;
  runCommand(command, args, {cwd, env, spawn: (actualCommand, actualArgs, options) => {
    called = true;
    assert.equal(actualCommand, command);
    assert.deepEqual(actualArgs, args);
    assert.deepEqual(options, {cwd, env, stdio: 'inherit', shell: false});
    return {status: 0, signal: null};
  }});
  assert.equal(called, true);
});

test('process runner handles spawn errors, signals, and unsuccessful or unknown exit status', () => {
  const missing = Object.assign(Error('missing binary'), {code: 'ENOENT'});
  assert.throws(() => runCommand('git', [], {spawn: () => ({error: missing})}), error => {
    assert.equal(error.cause, missing);
    return true;
  });
  for (const result of [{signal: 'SIGINT', status: null}, {signal: 'SIGTERM', status: null}, {status: 7}, {status: null}]) {
    assert.throws(() => runCommand('node', [], {spawn: () => result}), error => {
      assert.equal(error.exitCode, result.signal === 'SIGINT' ? 130 : result.status || 1);
      return true;
    });
  }
});

test('help has no preflight, downloads, or process execution', () => {
  const f = fixture();
  f.options.nodeVersion = '18.0.0';
  f.options.fileExists = () => assert.fail('help must not access files');
  main(['--help'], f.options);
  assert.equal(f.logs.length, 1);
  assert.match(f.logs[0], /Does not start the app/);
  assert.deepEqual(f.calls, []);
});

test('app flags and unknown installer arguments fail without execution', () => {
  for (const args of [['--root', 'private batch'], ['--port', '8773'], ['--enable-wallet-actions'], ['--help', 'extra'], ['--unknown']]) {
    const f = fixture();
    assert.throws(() => main(args, f.options), /Pass app options to npm start/);
    assert.deepEqual(f.calls, []);
  }
});
