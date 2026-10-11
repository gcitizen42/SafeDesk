import { describe, expect, it } from 'vitest'
import { requireWalletActions, walletActionsEnabled } from './local-policy'

const doc = (content?: string) =>
  ({ querySelector: () => (content === undefined ? null : { content }) }) as unknown as Pick<
    Document,
    'querySelector'
  >
describe('SafeDesk local wallet policy', () => {
  it('fails closed without the explicit launch setting', () => {
    for (const setting of [undefined, '', 'disabled', 'true']) {
      expect(walletActionsEnabled(doc(setting))).toBe(false)
      expect(() => requireWalletActions(doc(setting))).toThrow('read-only')
    }
  })
  it('allows actions only with the explicit server setting', () => {
    expect(walletActionsEnabled(doc('enabled'))).toBe(true)
    expect(() => requireWalletActions(doc('enabled'))).not.toThrow()
  })
})
