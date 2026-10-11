import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountOn } from './use-account-on'

const wallet = vi.hoisted(() => ({
  status: 'connected',
  chainId: 1,
  address: '0x1111111111111111111111111111111111111111',
  switchChain: vi.fn(),
}))
vi.mock('wagmi', () => ({
  useConnection: () => wallet,
  useSwitchChain: () => ({ mutateAsync: wallet.switchChain }),
}))
const policy = (enabled: boolean) =>
  vi.stubGlobal('document', {
    querySelector: () => ({ content: enabled ? 'enabled' : 'disabled' }),
  })
describe('wallet action entry', () => {
  beforeEach(() => {
    wallet.status = 'connected'
    wallet.chainId = 1
    wallet.switchChain.mockReset()
  })
  it('blocks before a wallet chain switch or action in read-only mode', async () => {
    policy(false)
    await expect(useAccountOn()(42161)).rejects.toThrow('read-only')
    expect(wallet.switchChain).not.toHaveBeenCalled()
  })
  it('allows the connected owner on the correct chain only when opted in', async () => {
    policy(true)
    expect(await useAccountOn()(42161)).toBe(wallet.address)
    expect(wallet.switchChain).toHaveBeenCalledWith({ chainId: 42161 })
  })
  it('still rejects a disconnected wallet with actions enabled', async () => {
    policy(true)
    wallet.status = 'disconnected'
    await expect(useAccountOn()(1)).rejects.toThrow('Connect')
    expect(wallet.switchChain).not.toHaveBeenCalled()
  })
})
