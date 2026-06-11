import { describe, expect, it } from 'vitest'

import { configFromEnv } from './config'

describe('configFromEnv', () => {
  it('resolves an anonymous read-only config from channels alone', () => {
    const config = configFromEnv({ TWITCH_CHANNELS: 'mychannel' })

    expect(config.channels).toEqual(['mychannel'])
    expect(config.auth).toEqual({ mode: 'anonymous' })
    expect(config.mentionOnly).toBe(false)
    expect(config.ignoreCommands).toBe(true)
    expect(config.replyInChat).toBe(false)
    expect(config.airiUrl).toBe('ws://localhost:6121/ws')
  })

  it('normalizes channel names from a messy list', () => {
    const config = configFromEnv({ TWITCH_CHANNELS: ' #MyChannel, other ,, ' })

    expect(config.channels).toEqual(['mychannel', 'other'])
  })

  it('treats empty strings from the .env template as unset', () => {
    const config = configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_CLIENT_ID: '',
      TWITCH_ACCESS_TOKEN: '',
      TWITCH_MENTION_ONLY: '',
      AIRI_URL: '',
    })

    expect(config.auth).toEqual({ mode: 'anonymous' })
    expect(config.mentionOnly).toBe(false)
    expect(config.airiUrl).toBe('ws://localhost:6121/ws')
  })

  it('requires at least one channel', () => {
    expect(() => configFromEnv({})).toThrow(/TWITCH_CHANNELS/)
    expect(() => configFromEnv({ TWITCH_CHANNELS: ' , ' })).toThrow(/TWITCH_CHANNELS/)
  })

  it('resolves static auth and defaults to replying in chat', () => {
    const config = configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_CLIENT_ID: 'client-id',
      TWITCH_ACCESS_TOKEN: 'access-token',
    })

    expect(config.auth).toEqual({ mode: 'static', clientId: 'client-id', accessToken: 'access-token' })
    expect(config.replyInChat).toBe(true)
  })

  it('resolves refreshing auth when refresh credentials are present', () => {
    const config = configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_CLIENT_ID: 'client-id',
      TWITCH_CLIENT_SECRET: 'client-secret',
      TWITCH_REFRESH_TOKEN: 'refresh-token',
    })

    expect(config.auth).toEqual({
      mode: 'refreshing',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
    })
  })

  it('rejects an access token without a client id', () => {
    expect(() => configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_ACCESS_TOKEN: 'access-token',
    })).toThrow(/TWITCH_CLIENT_ID/)
  })

  it('rejects a refresh token without a client secret', () => {
    expect(() => configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_CLIENT_ID: 'client-id',
      TWITCH_REFRESH_TOKEN: 'refresh-token',
    })).toThrow(/TWITCH_CLIENT_SECRET/)
  })

  it('rejects dangling client credentials without any token', () => {
    expect(() => configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_CLIENT_ID: 'client-id',
    })).toThrow(/no TWITCH_ACCESS_TOKEN or TWITCH_REFRESH_TOKEN/)
  })

  it('rejects replying in chat on an anonymous connection', () => {
    expect(() => configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_REPLY_IN_CHAT: 'true',
    })).toThrow(/authenticated/)
  })

  it('rejects mention-only mode without a bot username', () => {
    expect(() => configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_MENTION_ONLY: 'true',
    })).toThrow(/TWITCH_BOT_USERNAME/)
  })

  it('normalizes the bot username for matching', () => {
    const config = configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_BOT_USERNAME: '@Airi_Bot',
    })

    expect(config.botUsername).toBe('airi_bot')
  })

  it('rejects malformed boolean flags', () => {
    expect(() => configFromEnv({
      TWITCH_CHANNELS: 'mychannel',
      TWITCH_IGNORE_COMMANDS: 'yes',
    })).toThrow(/true.*false/)
  })
})
