// Sanity-check on-chain pricing (1inch Spot Price Aggregator) and on-chain Uniswap quoting (v3 QuoterV2, v4 Quoter)
import { createPublicClient, formatUnits, http, parseAbi, parseEther, zeroAddress } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

const client = createPublicClient({ chain: mainnet, transport: http('https://rpc.mevblocker.io') })
const sep = createPublicClient({ chain: sepolia, transport: http('https://evm.stupidtech.net/v1/11155111') })
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const AGG = '0x0AdDd25a91563696D8567Df78D5A01C9a991F9B8'

const rate = await client.readContract({
  address: AGG,
  abi: parseAbi(['function getRateToEth(address srcToken, bool useSrcWrappers) view returns (uint256)']),
  functionName: 'getRateToEth',
  args: [USDC, true],
})
// rate is scaled by 1e18 * 10^(18 - tokenDecimals)
const usdcPerEth = 1 / Number(formatUnits(rate, 18 + 12))
console.log(`1inch spot aggregator: 1 ETH ≈ ${usdcPerEth.toFixed(2)} USDC`)
console.log(`aggregator code on Sepolia: ${(await sep.getCode({ address: AGG })) ?? 'none'}`)

const [v3] = await client.simulateContract({
  address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  abi: parseAbi([
    'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  ]),
  functionName: 'quoteExactInputSingle',
  args: [{ tokenIn: WETH, tokenOut: USDC, amountIn: parseEther('1'), fee: 500, sqrtPriceLimitX96: 0n }],
}).then((r) => r.result)
console.log(`v3 QuoterV2 WETH→USDC 0.05%: 1 WETH → ${formatUnits(v3, 6)} USDC`)

const [v4] = await client.simulateContract({
  address: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
  abi: parseAbi([
    'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
    'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
    'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
  ]),
  functionName: 'quoteExactInputSingle',
  args: [{ poolKey: { currency0: zeroAddress, currency1: USDC, fee: 500, tickSpacing: 10, hooks: zeroAddress }, zeroForOne: true, exactAmount: parseEther('1'), hookData: '0x' }],
}).then((r) => r.result)
console.log(`v4 Quoter ETH→USDC hookless 0.05%/10: 1 ETH → ${formatUnits(v4, 6)} USDC`)
