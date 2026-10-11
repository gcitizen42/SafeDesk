import { describe, expect, it } from 'vitest'
import { deployments, findMultiSend, findSimulateTxAccessor } from './deployments'

describe('bundled safe-deployments table', () => {
  it('contains exactly the proxy hashes measured in SPEC §4.2', () => {
    expect(deployments.proxies.map((p) => [p.codeHash, p.size]).sort()).toEqual(
      [
        ['0xf8fffcb9b9c73fbc4ffb6dc52f0001fa998951e0d4177894b1b899f7732b6eaf', 110],
        ['0xaea7d4252f6245f301e540cfbee27d3a88de543af8e49c5c62405d5499fab7e5', 170],
        ['0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000', 171],
        ['0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c', 171],
        ['0x4e381985ca68b3e5d27b4425fa581c19cf33146d3f887a3cfca96f55528ea46f', 123],
      ].sort(),
    )
  })

  it('has Safe and SafeL2 singletons for every supported version, and marks older ones unsupported', () => {
    for (const v of ['1.3.0', '1.4.1', '1.5.0']) {
      const s = deployments.singletons.filter((x) => x.version === v && x.variant === 'canonical')
      expect(s.map((x) => x.l2).sort()).toEqual([false, true])
      expect(s.every((x) => x.supported)).toBe(true)
    }
    expect(
      deployments.singletons
        .filter((x) => !x.supported)
        .map((x) => x.version)
        .sort(),
    ).toEqual(['1.0.0', '1.1.1', '1.2.0'])
  })

  it('shares one code hash between the canonical and eip155 v1.3.0 singletons (SPEC §4.2)', () => {
    const v130 = deployments.singletons.filter((x) => x.version === '1.3.0' && !x.l2)
    const canonical = v130.find((x) => x.variant === 'canonical')
    const eip155 = v130.find((x) => x.variant === 'eip155')
    expect(canonical?.codeHash).toBe(eip155?.codeHash)
  })

  it('finds MultiSendCallOnly and SimulateTxAccessor by code hash', () => {
    const callOnly = deployments.multiSendCallOnly.find((m) => m.version === '1.4.1')
    expect(callOnly && findMultiSend(callOnly.codeHash)?.contractName).toBe('MultiSendCallOnly')
    const accessor = deployments.simulateTxAccessor[0]
    expect(accessor && findSimulateTxAccessor(accessor.codeHash)).toBeDefined()
    expect(findMultiSend(`0x${'00'.repeat(32)}`)).toBeUndefined()
  })

  it('records the pinned source and deploy blocks for Mainnet and Sepolia', () => {
    expect(deployments.source.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(deployments.deployBlocks['1']?.['0xd9db270c1b5e3bd161e8c8503c55ceabee709552']).toBe(
      '12504268',
    )
    expect(Object.keys(deployments.deployBlocks['11155111'] ?? {}).length).toBeGreaterThan(0)
  })
})
