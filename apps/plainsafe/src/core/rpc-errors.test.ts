import { describe, expect, it } from 'vitest'
import { classifyMethodError, errorInfo } from './rpc-errors'

describe('classifyMethodError', () => {
  it('treats method-not-found style errors as unsupported', () => {
    expect(classifyMethodError({ code: -32601, message: 'x' })).toBe('unsupported')
    expect(
      classifyMethodError({ message: 'the method eth_simulateV1 does not exist/is not available' }),
    ).toBe('unsupported')
    expect(classifyMethodError({ code: -32000, message: 'method not whitelisted' })).toBe(
      'unsupported',
    )
    expect(classifyMethodError({ message: 'Method eth_simulateV1 not allowed' })).toBe(
      'unsupported',
    )
  })

  it('treats rate limits, timeouts and odd responses as temporary', () => {
    expect(classifyMethodError({ status: 429, message: 'Too Many Requests' })).toBe('temporary')
    expect(classifyMethodError({ code: 429, message: 'Monthly capacity limit exceeded' })).toBe(
      'temporary',
    )
    expect(
      classifyMethodError({ message: 'The request took too long to respond. timed out' }),
    ).toBe('temporary')
    expect(classifyMethodError({ code: -32000, message: 'Blast API is no longer available' })).toBe(
      'temporary',
    )
    expect(classifyMethodError({ message: 'internal error' })).toBe('temporary')
  })
})

describe('errorInfo', () => {
  it('finds the code and messages through the cause chain', () => {
    const inner = Object.assign(new Error('Method not found'), { code: -32601 })
    const outer = Object.assign(new Error('RPC Request failed.'), {
      cause: inner,
      shortMessage: 'RPC Request failed.',
    })
    const info = errorInfo(outer)
    expect(info.code).toBe(-32601)
    expect(info.message).toContain('Method not found')
  })
})
