#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = resolve(ROOT, "config/rotated-safes.json");
const API_ROOT = "https://api.safe.global/tx-service";

const args = process.argv.slice(2);
const allTokens = args.includes("--all-tokens");
const asJson = args.includes("--json");
const includeUsd = args.includes("--usd");
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? resolve(args[outputIndex + 1]) : null;

if (outputIndex >= 0 && !args[outputIndex + 1]) {
  throw new Error("--output requires a file path");
}

const config = JSON.parse(await readFile(CONFIG, "utf8"));
const expectedOwners = new Set(config.expectedOwners.map(normalizeAddress));

function normalizeAddress(address) {
  return address.toLowerCase();
}

function nativeSymbol(chainId) {
  return chainId === 137 ? "POL" : "ETH";
}

function coingeckoPlatform(chainId) {
  return {
    1: "ethereum",
    10: "optimistic-ethereum",
    137: "polygon-pos",
    8453: "base",
    42161: "arbitrum-one",
  }[chainId];
}

function nativeCoinId(chainId) {
  return chainId === 137 ? "polygon-ecosystem-token" : "ethereum";
}

function decimalAmount(raw, decimals) {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");

  if (!fraction) return whole.toString();
  if (whole === 0n && /^0{12}/.test(fraction)) return `<0.${"0".repeat(11)}1`;
  return `${whole}.${fraction.slice(0, 12)}`;
}

async function getJson(url, attempt = 0) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (response.status === 429 && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 750 * (2 ** attempt);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    return getJson(url, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }
  return response.json();
}

async function getAllBalances(safe) {
  const trusted = allTokens ? "false" : "true";
  let url = `${API_ROOT}/${safe.service}/api/v2/safes/${safe.address}/balances/?trusted=${trusted}&exclude_spam=true&limit=200`;
  const balances = [];

  while (url) {
    const page = await getJson(url);
    balances.push(...(page.results ?? page));
    url = page.next;
  }

  return balances
    .filter((item) => BigInt(item.balance) > 0n)
    .map((item) => ({
      ticker: item.token?.symbol ?? nativeSymbol(safe.chainId),
      name: item.token?.name ?? nativeSymbol(safe.chainId),
      amount: decimalAmount(item.balance, item.token?.decimals ?? 18),
      rawBalance: item.balance,
      decimals: item.token?.decimals ?? 18,
      tokenAddress: item.tokenAddress,
    }));
}

async function auditSafe(safe) {
  const base = `${API_ROOT}/${safe.service}/api/v1/safes/${safe.address}`;
  try {
    const safeInfo = await getJson(`${base}/`);
    const assets = await getAllBalances(safe);
    const owners = new Set(safeInfo.owners.map(normalizeAddress));
    const ownerSetMatches = owners.size === expectedOwners.size &&
      [...owners].every((owner) => expectedOwners.has(owner));
    const thresholdMatches = safeInfo.threshold === safe.expectedThreshold;

    return {
      ...safe,
      nonce: safeInfo.nonce,
      threshold: safeInfo.threshold,
      ownerCount: safeInfo.owners.length,
      aligned: ownerSetMatches && thresholdMatches,
      ownerSetMatches,
      thresholdMatches,
      assets,
    };
  } catch (error) {
    return { ...safe, aligned: false, assets: [], error: String(error) };
  }
}

async function addUsdValuations(results) {
  const coinList = await getJson("https://api.coingecko.com/api/v3/coins/list?include_platform=true");
  const contractToCoinId = new Map();

  for (const coin of coinList) {
    for (const [platform, address] of Object.entries(coin.platforms ?? {})) {
      if (address) contractToCoinId.set(`${platform}:${address.toLowerCase()}`, coin.id);
    }
  }

  const coinIds = new Set();
  for (const safe of results) {
    for (const asset of safe.assets) {
      const coinId = asset.tokenAddress
        ? contractToCoinId.get(`${coingeckoPlatform(safe.chainId)}:${asset.tokenAddress.toLowerCase()}`)
        : nativeCoinId(safe.chainId);
      asset.coingeckoId = coinId ?? null;
      if (coinId) coinIds.add(coinId);
    }
  }

  const prices = {};
  const ids = [...coinIds];
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50);
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(chunk.join(","))}&vs_currencies=usd&include_last_updated_at=true`;
    Object.assign(prices, await getJson(url));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  for (const safe of results) {
    let knownUsdValue = 0;
    let unpricedAssetCount = 0;
    for (const asset of safe.assets) {
      const price = asset.coingeckoId ? prices[asset.coingeckoId]?.usd : undefined;
      asset.priceUsd = Number.isFinite(price) ? price : null;
      if (asset.priceUsd === null) {
        asset.usdValue = null;
        unpricedAssetCount += 1;
        continue;
      }
      const amount = Number(asset.rawBalance) / (10 ** asset.decimals);
      asset.usdValue = amount * asset.priceUsd;
      knownUsdValue += asset.usdValue;
    }
    safe.knownDirectUsdValue = knownUsdValue;
    safe.unpricedAssetCount = unpricedAssetCount;
  }
}

function usd(value) {
  if (!Number.isFinite(value)) return "n/a";
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function markdownReport(results) {
  const generatedAt = new Date().toISOString();
  const alignedCount = results.filter((safe) => safe.aligned).length;
  const directUsdValue = includeUsd
    ? results.reduce((total, safe) => total + (safe.knownDirectUsdValue ?? 0), 0)
    : null;
  const unpricedAssetCount = includeUsd
    ? results.reduce((total, safe) => total + (safe.unpricedAssetCount ?? 0), 0)
    : null;
  const lines = [
    "# Threshold Safe treasury snapshot",
    "",
    `Generated: ${generatedAt}`,
    "",
    `Owner and threshold alignment: ${alignedCount}/${results.length}`,
    `Token filter: ${allTokens ? "all indexed tokens (may include spam)" : "Safe trusted tokens only"}`,
    ...(includeUsd ? [
      `Known direct-wallet value: ${usd(directUsdValue)}`,
      `Unpriced non-zero asset balances: ${unpricedAssetCount}`,
      "Valuation source: CoinGecko contract-address and native-asset prices",
    ] : []),
    "",
  ];

  if (includeUsd) {
    lines.push(
      "## Safe summary",
      "",
      "| Chain | Safe | Address | Alignment | Known direct value | Unpriced assets |",
      "| --- | --- | --- | --- | ---: | ---: |"
    );
    for (const safe of results) {
      lines.push(`| ${safe.chain} | ${safe.label} | \`${safe.address}\` | ${safe.aligned ? "YES" : "NO"} | ${usd(safe.knownDirectUsdValue)} | ${safe.unpricedAssetCount ?? "-"} |`);
    }

    const allocations = new Map();
    for (const safe of results) {
      for (const asset of safe.assets) {
        if (!Number.isFinite(asset.usdValue)) continue;
        const key = asset.coingeckoId ?? `${safe.chainId}:${asset.tokenAddress ?? "native"}`;
        const current = allocations.get(key) ?? { ticker: asset.ticker, value: 0 };
        current.value += asset.usdValue;
        allocations.set(key, current);
      }
    }
    const sortedAllocations = [...allocations.values()].sort((a, b) => b.value - a.value);
    lines.push(
      "",
      "## Direct asset allocation",
      "",
      "| Asset | Known value | Share |",
      "| --- | ---: | ---: |"
    );
    for (const allocation of sortedAllocations.filter((item) => item.value >= 1)) {
      const share = directUsdValue > 0 ? (allocation.value / directUsdValue) * 100 : 0;
      lines.push(`| ${allocation.ticker} | ${usd(allocation.value)} | ${share.toFixed(2)}% |`);
    }
    const minorValue = sortedAllocations
      .filter((item) => item.value < 1)
      .reduce((total, item) => total + item.value, 0);
    if (minorValue > 0) {
      const share = directUsdValue > 0 ? (minorValue / directUsdValue) * 100 : 0;
      lines.push(`| Other priced dust | ${usd(minorValue)} | ${share.toFixed(2)}% |`);
    }
    lines.push("", "## Detailed balances", "");
  }

  lines.push(
    includeUsd
      ? "| Chain | Safe | Address | Rotation aligned | Threshold | Nonce | Asset | Amount | Price USD | Value USD | Token contract |"
      : "| Chain | Safe | Address | Rotation aligned | Threshold | Nonce | Asset | Amount | Token contract |",
    includeUsd
      ? "| --- | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | --- |"
      : "| --- | --- | --- | --- | ---: | ---: | --- | ---: | --- |",
  );

  for (const safe of results) {
    if (safe.error) {
      lines.push(includeUsd
        ? `| ${safe.chain} | ${safe.label} | \`${safe.address}\` | ERROR | - | - | - | - | - | - | ${safe.error.replaceAll("|", "\\|")} |`
        : `| ${safe.chain} | ${safe.label} | \`${safe.address}\` | ERROR | - | - | - | - | ${safe.error.replaceAll("|", "\\|")} |`);
      continue;
    }

    const assets = safe.assets.length ? safe.assets : [{ ticker: "(none)", amount: "0", tokenAddress: null }];
    for (const [index, asset] of assets.entries()) {
      const cells = [
        index === 0 ? safe.chain : "",
        index === 0 ? safe.label : "",
        index === 0 ? `\`${safe.address}\`` : "",
        index === 0 ? (safe.aligned ? "YES" : "NO") : "",
        index === 0 ? safe.threshold : "",
        index === 0 ? safe.nonce : "",
        asset.ticker,
        asset.amount,
      ];
      if (includeUsd) cells.push(usd(asset.priceUsd), usd(asset.usdValue));
      cells.push(asset.tokenAddress ? `\`${asset.tokenAddress}\`` : "native");
      lines.push(cells.join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
  }

  lines.push(
    "",
    "Notes:",
    "- This is a read-only snapshot from Safe Transaction Service.",
    ...(includeUsd ? [
      "- USD values are point-in-time estimates, not accounting-book values or executable liquidation values.",
      "- The headline total includes only balances for which CoinGecko returned a contract-matched price.",
    ] : []),
    "- Default mode suppresses untrusted tokens because unsolicited token dust is common.",
    "- ERC-721/1155 collectibles, LP positions, lending positions, staking positions and claimable rewards are outside this token-balance report.",
    "- Use `npm run balances -- --all-tokens` only when investigating hidden or untrusted token contracts.",
    ""
  );
  return lines.join("\n");
}

const results = [];
for (const safe of config.safes) {
  results.push(await auditSafe(safe));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
}
if (includeUsd) await addUsdValuations(results);
const report = asJson
  ? JSON.stringify({ generatedAt: new Date().toISOString(), allTokens, includeUsd, results }, null, 2)
  : markdownReport(results);

if (outputPath) {
  await writeFile(outputPath, `${report}\n`, "utf8");
  console.error(`Wrote ${outputPath}`);
}

console.log(report);
