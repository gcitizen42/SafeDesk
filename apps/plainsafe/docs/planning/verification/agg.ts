import { createPublicClient, http, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'
const c = createPublicClient({ chain: mainnet, transport: http('https://rpc.mevblocker.io') })
const address = '0x0AdDd25a91563696D8567Df78D5A01C9a991F9B8'
const abi = parseAbi([
  'function owner() view returns (address)',
  'function oracles() view returns (address[] allOracles, uint8[] oracleTypes)',
  'function connectors() view returns (address[])',
])
const [owner, [oracles], connectors] = await Promise.all([
  c.readContract({ address, abi, functionName: 'owner' }),
  c.readContract({ address, abi, functionName: 'oracles' }),
  c.readContract({ address, abi, functionName: 'connectors' }),
])
const ownerCode = await c.getCode({ address: owner })
console.log(`owner ${owner} (${ownerCode ? 'contract' : 'EOA'}), ${oracles.length} DEX oracle wrappers, ${connectors.length} connector tokens`)
