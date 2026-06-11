import type { Client as ServerChannel } from '@proj-airi/server-sdk'
import type { Twitch } from '@proj-airi/server-shared/types'

import type { TwitchChatMessage, TwitchChatPort } from '../clients/twitch-client'

import { useLogg } from '@guiiai/logg'
import { ContextUpdateStrategy } from '@proj-airi/server-shared/types'

import { chunkChatMessage } from '../utils/message'

const log = useLogg('TwitchAdapter').useGlobalConfig()

export interface TwitchAdapterOptions {
  /**
   * Login name of the bot account; its own messages are ignored and mentions
   * of it are detected/stripped.
   */
  botUsername?: string
  /**
   * Only forward messages mentioning `@botUsername`.
   */
  mentionOnly: boolean
  /**
   * Drop messages starting with `!` (usually commands for other channel bots).
   */
  ignoreCommands: boolean
  /**
   * Relay AIRI's responses back into the originating Twitch channel.
   */
  replyInChat: boolean
}

/**
 * Routes Twitch chat into the AIRI server channel and AIRI responses back to
 * Twitch chat.
 *
 * Use when:
 * - Bridging live Twitch chat to a running AIRI stage (see `src/index.ts`).
 *
 * Expects:
 * - A constructed (not necessarily connected) server channel client and chat
 *   transport; `start()` connects the hub first so no chat message is consumed
 *   before AIRI is reachable.
 *
 * Returns:
 * - Forwards messages as `input:text` events carrying {@link Twitch} metadata;
 *   replies are read from `output:gen-ai:chat:message` events whose original
 *   input carried that metadata.
 */
export class TwitchAdapter {
  private readonly airiClient: ServerChannel
  private readonly chat: TwitchChatPort
  private readonly options: TwitchAdapterOptions

  constructor(airiClient: ServerChannel, chat: TwitchChatPort, options: TwitchAdapterOptions) {
    this.airiClient = airiClient
    this.chat = chat
    this.options = options
  }

  async start(): Promise<void> {
    this.setupAiriHandlers()
    this.chat.onMessage(message => this.handleChatMessage(message))

    // Ensure the AIRI channel is ready before consuming chat, so early
    // messages are not silently dropped by send() while disconnected.
    log.log('Waiting for AIRI server channel connection...')
    await this.airiClient.connect()
    log.log('Connecting to Twitch chat...')
    await this.chat.connect()

    log.log('Twitch adapter started')
  }

  stop(): void {
    log.log('Stopping Twitch adapter...')
    this.chat.quit()
    this.airiClient.close()
  }

  private setupAiriHandlers(): void {
    this.airiClient.onEvent('output:gen-ai:chat:message', async (event) => {
      if (!this.options.replyInChat)
        return

      try {
        const twitch = event.data['gen-ai:chat']?.input?.data.twitch
        if (!twitch?.channel)
          return

        const content = event.data.message.content
        if (typeof content !== 'string' || content.trim().length === 0)
          return

        for (const chunk of chunkChatMessage(content))
          await this.chat.say(twitch.channel, chunk)
      }
      catch (error) {
        log.withError(error).error('Failed to send response to Twitch chat')
      }
    })
  }

  private handleChatMessage(message: TwitchChatMessage): void {
    const botUsername = this.options.botUsername
    if (botUsername && message.user.login === botUsername)
      return

    if (this.options.ignoreCommands && message.text.startsWith('!'))
      return

    let text = message.text.trim()
    if (this.options.mentionOnly && botUsername) {
      const mention = new RegExp(`@${botUsername}\\b`, 'gi')
      if (!mention.test(message.text))
        return

      text = message.text.replace(mention, '').replace(/\s+/g, ' ').trim()
    }

    if (text.length === 0)
      return

    const twitch: Twitch = {
      channel: message.channel,
      channelId: message.channelId,
      user: message.user,
      messageId: message.messageId,
    }

    const twitchNotice = `The input is coming from Twitch live chat of channel #${message.channel}.`

    const delivered = this.airiClient.send({
      type: 'input:text',
      data: {
        text,
        textRaw: message.text,
        overrides: {
          messagePrefix: `(From Twitch chat user ${message.user.displayName} in channel #${message.channel}): `,
          sessionId: `twitch-channel-${message.channel}`,
        },
        contextUpdates: [{
          strategy: ContextUpdateStrategy.AppendSelf,
          text: twitchNotice,
          content: twitchNotice,
          metadata: { twitch },
        }],
        twitch,
      },
    })

    if (!delivered)
      log.warn(`AIRI channel is not connected (status: ${this.airiClient.connectionStatus}), dropped message from ${message.user.login}`)
  }
}
