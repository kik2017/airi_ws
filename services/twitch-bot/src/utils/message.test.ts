import { describe, expect, it } from 'vitest'

import { chunkChatMessage } from './message'

describe('chunkChatMessage', () => {
  it('returns short text as a single chunk', () => {
    expect(chunkChatMessage('hello chat')).toEqual(['hello chat'])
  })

  it('splits on line breaks and drops empty lines', () => {
    expect(chunkChatMessage('first\n\nsecond\r\nthird')).toEqual(['first', 'second', 'third'])
  })

  it('splits long lines at word boundaries within the limit', () => {
    const chunks = chunkChatMessage('aaa bbb ccc', 7)

    expect(chunks).toEqual(['aaa bbb', 'ccc'])
    expect(chunks[0].length).toBeLessThanOrEqual(7)
  })

  it('hard-cuts unbroken runs longer than the limit', () => {
    const chunks = chunkChatMessage('a'.repeat(12), 5)

    expect(chunks).toEqual(['aaaaa', 'aaaaa', 'aa'])
  })

  it('keeps every chunk within the default 500 character twitch limit', () => {
    const text = `${'word '.repeat(300)}\n${'x'.repeat(1200)}`

    for (const chunk of chunkChatMessage(text)) {
      expect(chunk.length).toBeLessThanOrEqual(500)
      expect(chunk.length).toBeGreaterThan(0)
    }
  })

  it('trims surrounding whitespace from chunks', () => {
    expect(chunkChatMessage('  padded  ')).toEqual(['padded'])
  })
})
