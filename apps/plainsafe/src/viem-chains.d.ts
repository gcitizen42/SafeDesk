// Built by vite.config.ts from viem/chains, keyed by chain ID (Add a chain, SPEC §3.1).
declare module 'virtual:viem-chains' {
  const chains: Readonly<
    Record<
      number,
      {
        readonly name: string
        readonly nativeCurrency: { name: string; symbol: string; decimals: number }
        readonly explorer?: string
        readonly multicall3?: `0x${string}`
      }
    >
  >
  export default chains
}
