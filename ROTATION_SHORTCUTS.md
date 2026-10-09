# Rotation shortcuts

Use these from:

```bash
cd /Users/Citizen42/Desktop/TdaoUtils/AI-ops/tDAO-signerrotation
```

## Arbitrum

Dry run:

```bash
npm run rotation -- arbitrum dry-run
```

Submit and paste signature when prompted:

```bash
npm run rotation -- arbitrum submit
```

Submit with signature inline:

```bash
npm run rotation -- arbitrum submit 0xSIGNATURE
```

## Polygon

Dry run:

```bash
npm run rotation -- polygon dry-run
```

Submit and paste signature when prompted:

```bash
npm run rotation -- polygon submit
```

Submit with signature inline:

```bash
npm run rotation -- polygon submit 0xSIGNATURE
```

## Base

Dry run:

```bash
npm run rotation -- base dry-run
```

or:

```bash
./rotation-base-dry-run
```

Submit and paste signature when prompted:

```bash
npm run rotation -- base submit
```

or:

```bash
./rotation-base-submit
```

Submit with signature inline:

```bash
npm run rotation -- base submit 0xSIGNATURE
```

or:

```bash
./rotation-base-submit "0xSIGNATURE"
```

## Optimism

Dry run:

```bash
npm run rotation -- optimism dry-run
```

or:

```bash
./rotation-optimism-dry-run
```

Submit and paste signature when prompted:

```bash
npm run rotation -- optimism submit
```

or:

```bash
./rotation-optimism-submit
```

Submit with signature inline:

```bash
npm run rotation -- optimism submit 0xSIGNATURE
```

or:

```bash
./rotation-optimism-submit "0xSIGNATURE"
```

## Treasury

Dry run:

```bash
npm run rotation -- treasury dry-run
```

Submit and paste signature when prompted:

```bash
npm run rotation -- treasury submit
```

## Safer habit

Prefer the prompt form for real signatures:

```bash
npm run rotation -- arbitrum submit
```

That keeps the signature out of your shell history.
