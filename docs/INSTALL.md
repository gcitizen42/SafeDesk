# Install SafeDesk Locally

SafeDesk is a local-only app with My Safe's and Safe Ownership Management workspaces.
Both views use one local server, one browser origin, and port **8772** by default:

- My Safe's: <http://127.0.0.1:8772/>
- Safe Ownership Management: <http://127.0.0.1:8772/#/rotations>

The server binds to this computer's loopback address, not the network. This is
not a hosted service: keep the terminal running while you use it, and do not
expose it through port forwarding, a tunnel, or a public reverse proxy. Local
hosting is not a security guarantee. **SafeDesk is unaudited.** Read
[SECURITY.md](../SECURITY.md) before using it with a wallet.

## Prerequisites

- **Node.js 22.12 or newer**, with npm. Use a supported release from
  [nodejs.org](https://nodejs.org/). A separate global Bun installation is not
  needed; the repository's setup command obtains pinned Bun through npm.
- **Git** to clone or update the repository, from
  [git-scm.com](https://git-scm.com/downloads). A complete source archive also
  works; the installer warns, rather than fails, if Git is not on PATH.
- Internet access for dependency installation. Using RPCs or simulation services
  later also needs internet access; these are not configured by the installer.

After installing Node.js or Git, close and reopen your terminal so it picks up
the updated PATH. Check:

```text
node --version
npm --version
git --version
```

## Windows

Open PowerShell or Command Prompt in the folder where you want the checkout.
No administrator terminal is required.

```text
git clone https://github.com/gcitizen42/SafeDesk.git
cd SafeDesk
npm run install:desk
npm start
```

If PowerShell blocks `npm.ps1` because of its execution policy, use the installed
`npm.cmd` wrapper instead. No execution-policy change is necessary:

```text
npm.cmd run install:desk
npm.cmd start
```

After setup, double-click `start-safedesk.cmd` for later launches. It uses its own
repository folder even when started from elsewhere, waits for the server, and
pauses on failure so the error remains visible. It does not install dependencies
or enable wallet actions.

## macOS And Linux

Open Terminal in the folder where you want the checkout:

```sh
git clone https://github.com/gcitizen42/SafeDesk.git
cd SafeDesk
npm run install:desk
npm start
```

After setup, launch from the checkout with:

```sh
sh ./start-safedesk.sh
```

The launcher uses its own repository folder, waits for the server, and waits for
Enter after a failure when attached to an interactive terminal. It can also be
called by its quoted absolute path from another folder. It does not require an
executable permission change or a global Bun installation.

## What Setup Does

`npm run install:desk` checks the Node.js version, checkout files, npm entry
point, and Git availability. It then runs these commands sequentially from the
repository root, stopping immediately if a step fails:

```text
npm ci --ignore-scripts
npm run setup:manager
npm run build:manager
```

The root install uses `package-lock.json` and disables dependency lifecycle
scripts. Manager setup uses the repository-pinned Bun version, its committed
`apps/plainsafe/bun.lock`, `--frozen-lockfile`, and `--ignore-scripts`. The build
is an explicit local build step, not a wallet operation. Root `npm ci` replaces
the root dependency installation; it does not reset private operation folders.

The installer invokes npm's JavaScript CLI through the running Node executable,
with argument arrays and no command shell. Paths containing spaces work on
Windows, macOS, and Linux. It normally gets the CLI from `npm_execpath`, supplied
by `npm run`; direct `node scripts/safedesk/install.mjs` invocation also checks
standard Node/npm installation locations.

Setup does not start the server, open a browser, connect a wallet, sign anything,
publish proposals, run simulations, or change user RPC, API, Tenderly, or wallet
configuration. It does not request credentials. No credentials, collected
signatures, private backups, or operation files are supplied with a clean
checkout. Do not add those files to Git or share them publicly.

## Start And Stop

Run `npm start`, then open <http://127.0.0.1:8772/> in your browser. Rotations is
the nested `#/rotations` view on the **same port**, not a second local server.
Stop the server with **Ctrl+C** in its terminal.

A clean checkout starts with an empty rotation batch; the app initializes local
batch files when started, not during installation. An existing local batch can
be reused. To select a private batch folder, quote paths containing spaces:

```text
npm start -- --root "path/to/private batch"
```

If port 8772 is busy, stop the earlier instance or choose a different single
port:

```text
npm start -- --port 8872
```

Both views then use `http://127.0.0.1:8872/` and
`http://127.0.0.1:8872/#/rotations`. You can combine `--root` and `--port`.
There is no separate manager port to configure for the unified app.

## Wallet Actions Are Opt-In

My Safe's starts read-only. To explicitly enable its wallet actions for
one launch:

```text
npm start -- --enable-wallet-actions
```

Enabling this flag does not approve a signature or transaction. Review the Safe,
network, recipients, calldata, value, nonce, and signing method, then explicitly
confirm each request in your wallet. Rotation signing and proposal publication
retain their separate review and confirmation controls. Publishing a proposal
is not the same as executing it. The installer and default launchers never add
the wallet-actions flag automatically.

## Troubleshooting

- **Unsupported Node.js:** install Node.js 22.12 or newer, reopen the terminal,
  and check `node --version`. Multiple installations may leave an older Node on
  PATH.
- **npm cannot be found:** use a Node.js installation that includes npm. Reopen
  the terminal and run `npm run install:desk` from the checkout. On Windows,
  try `npm.cmd run install:desk` if PowerShell blocks its script wrapper.
- **`install:desk` script missing:** your checkout may predate the installer
  integration. Use `node scripts/safedesk/install.mjs` if that file exists, or
  run the three setup commands above. Updating to the integrated version
  restores the `npm run install:desk` shortcut.
- **Dependency download or build failed:** inspect the failed step's message,
  correct the network/tooling issue, then rerun `npm run install:desk`. Do not
  delete lockfiles, enable dependency lifecycle scripts, or change private API
  configuration to work around a setup error.
- **Missing manager build:** rerun `npm run install:desk` before starting the
  app. Launchers assume setup has already completed.
- **Port already in use:** stop the existing instance or use `--port` as shown
  above. No firewall opening is needed for local use.

For workflow details and private configuration, see the
[operator guide](../scripts/safe-batch/README.md) and
[management integration guide](../apps/plainsafe/SAFEDESK.md).
