import type { TwitchChatMessage } from '../clients/twitch-client'
import type { TwitchAdapterOptions } from './airi-adapter'

import { describe, expect, it, vi } from 'vitest'

import { TwitchAdapter } from './airi-adapter'

function createChatMessage(overrides: Partial<TwitchChatMessage> = {}): TwitchChatMessage {
  return {
    channel: 'testchannel',
    channelId: '123456',
    text: 'hello airi',
    user: {
      id: '789',
      login: 'viewer',
      displayName: 'Viewer',
    },
    messageId: 'msg-1',
    ...overrides,
  }
}

async function createAdapterHarness(optionOverrides: Partial<TwitchAdapterOptions> = {}) {
  const airiHandlers = new Map<string, (event: any) => void | Promise<void>>()
  const airiClient = {
    send: vi.fn(() => true),
    onEvent: vi.fn((type: string, handler: (event: any) => void | Promise<void>) => {
      airiHandlers.set(type, handler)
    }),
    connect: vi.fn(async () => {}),
    close: vi.fn(),
    connectionStatus: 'ready',
  }

  let chatHandler: ((message: TwitchChatMessage) => void) | undefined
  const chat = {
    canSend: true,
    connect: vi.fn(async () => {}),
    onMessage: vi.fn((handler: (message: TwitchChatMessage) => void) => {
      chatHandler = handler
    }),
    say: vi.fn(async (_channel: string, _text: string) => {}),
    quit: vi.fn(),
  }

  const adapter = new TwitchAdapter(airiClient as any, chat as any, {
    botUsername: 'airi_bot',
    mentionOnly: false,
    ignoreCommands: true,
    replyInChat: true,
    ...optionOverrides,
  })
  await adapter.start()

  return {
    adapter,
    airiClient,
    chat,
    emitChatMessage: (message: TwitchChatMessage) => chatHandler?.(message),
    emitAiriEvent: (type: string, event: any) => airiHandlers.get(type)?.(event),
  }
}

function createOutputEvent(content: string, inputData: Record<string, unknown> | undefined) {
  return {
    data: {
      'message': { role: 'assistant', content },
      'gen-ai:chat': inputData
        ? { input: { type: 'input:text', data: inputData } }
        : undefined,
    },
  }
}

describe('twitchAdapter chat forwarding', () => {
  it('connects to the AIRI channel before connecting to chat', async () => {
    const { airiClient, chat } = await createAdapterHarness()

    expect(airiClient.connect).toHaveBeenCalledTimes(1)
    expect(chat.connect).toHaveBeenCalledTimes(1)
    expect(airiClient.connect.mock.invocationCallOrder[0]).toBeLessThan(chat.connect.mock.invocationCallOrder[0])
  })

  it('forwards chat messages as input:text with twitch metadata and session overrides', async () => {
    const { airiClient, emitChatMessage } = await createAdapterHarness()

    emitChatMessage(createChatMessage())

    expect(airiClient.send).toHaveBeenCalledTimes(1)
    expect(airiClient.send).toHaveBeenCalledWith({
      type: 'input:text',
      data: expect.objectContaining({
        text: 'hello airi',
        textRaw: 'hello airi',
        overrides: {
          messagePrefix: '(From Twitch chat user Viewer in channel #testchannel): ',
          sessionId: 'twitch-channel-testchannel',
        },
        twitch: {
          channel: 'testchannel',
          channelId: '123456',
          user: { id: '789', login: 'viewer', displayName: 'Viewer' },
          messageId: 'msg-1',
        },
      }),
    })
  })

  it('ignores messages sent by the bot account itself', async () => {
    const { airiClient, emitChatMessage } = await createAdapterHarness()

    emitChatMessage(createChatMessage({ user: { id: '1', login: 'airi_bot', displayName: 'AIRI_Bot' } }))

    expect(airiClient.send).not.toHaveBeenCalled()
  })

  it('ignores command messages addressed to other channel bots', async () => {
    const { airiClient, emitChatMessage } = await createAdapterHarness()

    emitChatMessage(createChatMessage({ text: '!uptime' }))

    expect(airiClient.send).not.toHaveBeenCalled()
  })

  it('forwards command messages when ignoreCommands is disabled', async () => {
    const { airiClient, emitChatMessage } = await createAdapterHarness({ ignoreCommands: false })

    emitChatMessage(createChatMessage({ text: '!uptime' }))

    expect(airiClient.send).toHaveBeenCalledTimes(1)
  })

  it('drops non-mentions and strips the mention in mention-only mode', async () => {
    const { airiClient, emitChatMessage } = await createAdapterHarness({ mentionOnly: true })

    emitChatMessage(createChatMessage({ text: 'just chatting' }))
    expect(airiClient.send).not.toHaveBeenCalled()

    emitChatMessage(createChatMessage({ text: '@Airi_Bot how are you?' }))
    expect(airiClient.send).toHaveBeenCalledTimes(1)
    expect(airiClient.send).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        text: 'how are you?',
        textRaw: '@Airi_Bot how are you?',
      }),
    }))
  })

  it('does not throw when the AIRI channel is not connected', async () => {
    const { airiClient, emitChatMessage } = await createAdapterHarness()
    airiClient.send.mockReturnValue(false)

    expect(() => emitChatMessage(createChatMessage())).not.toThrow()
  })
})

describe('twitchAdapter response routing', () => {
  it('relays responses to the originating twitch channel in chunks', async () => {
    const { chat, emitAiriEvent } = await createAdapterHarness()

    await emitAiriEvent('output:gen-ai:chat:message', createOutputEvent(
      `short answer\n${'long '.repeat(150)}`,
      { twitch: { channel: 'testchannel' } },
    ))

    expect(chat.say).toHaveBeenCalled()
    expect(chat.say.mock.calls[0]).toEqual(['testchannel', 'short answer'])
    for (const [channel, chunk] of chat.say.mock.calls) {
      expect(channel).toBe('testchannel')
      expect(chunk.length).toBeLessThanOrEqual(500)
    }
  })

  it('ignores responses that did not originate from twitch input', async () => {
    const { chat, emitAiriEvent } = await createAdapterHarness()

    await emitAiriEvent('output:gen-ai:chat:message', createOutputEvent('a discord reply', { discord: { channelId: '42' } }))
    await emitAiriEvent('output:gen-ai:chat:message', createOutputEvent('a stage reply', undefined))

    expect(chat.say).not.toHaveBeenCalled()
  })

  it('does not reply in chat when replyInChat is disabled', async () => {
    const { chat, emitAiriEvent } = await createAdapterHarness({ replyInChat: false })

    await emitAiriEvent('output:gen-ai:chat:message', createOutputEvent('spoken only', { twitch: { channel: 'testchannel' } }))

    expect(chat.say).not.toHaveBeenCalled()
  })

  it('ignores empty or non-text response content', async () => {
    const { chat, emitAiriEvent } = await createAdapterHarness()

    await emitAiriEvent('output:gen-ai:chat:message', createOutputEvent('   ', { twitch: { channel: 'testchannel' } }))
    await emitAiriEvent('output:gen-ai:chat:message', {
      data: {
        'message': { role: 'assistant', content: [{ type: 'text', text: 'parts' }] },
        'gen-ai:chat': { input: { type: 'input:text', data: { twitch: { channel: 'testchannel' } } } },
      },
    })

    expect(chat.say).not.toHaveBeenCalled()
  })
})
