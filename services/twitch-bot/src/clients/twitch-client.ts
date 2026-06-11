import type { AuthProvider } from '@twurple/auth'

import type { TwitchAuth } from '../config'

import { useLogg } from '@guiiai/logg'
import { RefreshingAuthProvider, StaticAuthProvider } from '@twurple/auth'
import { ChatClient, toUserName } from '@twurple/chat'

const log = useLogg('TwitchChatClient').useGlobalConfig()

export interface TwitchChatMessage {
  /**
   * Channel login name the message was sent in, without the leading `#`.
   */
  channel: string
  channelId?: string
  text: string
  user: {
    id: string
    login: string
    displayName: string
  }
  messageId: string
}

/**
 * Minimal chat transport surface the adapter depends on, so tests can inject
 * a mock instead of a live IRC connection.
 */
export interface TwitchChatPort {
  /**
   * Whether the connection is authenticated and therefore able to send messages.
   */
  readonly canSend: boolean
  connect: () => Promise<void>
  onMessage: (handler: (message: TwitchChatMessage) => void) => void
  say: (channel: string, text: string) => Promise<void>
  quit: () => void
}

export interface TwitchChatClientOptions {
  channels: string[]
  auth: TwitchAuth
}

async function createAuthProvider(auth: TwitchAuth): Promise<AuthProvider | undefined> {
  switch (auth.mode) {
    case 'anonymous':
      return undefined

    case 'static':
      return new StaticAuthProvider(auth.clientId, auth.accessToken)

    case 'refreshing': {
      const provider = new RefreshingAuthProvider({
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
      })

      // NOTICE:
      // expiresIn: 0 + obtainmentTimestamp: 0 marks the (omitted) access token as
      // already expired, forcing twurple to refresh and discover the user id on
      // first use — so only the refresh token has to be configured.
      // See MakeOptional<AccessToken, 'accessToken' | 'scope'> in
      // node_modules/@twurple/auth/lib/providers/RefreshingAuthProvider.d.ts (addUserForToken).
      // Removal condition: twurple offering a refresh-token-only convenience API.
      await provider.addUserForToken({
        refreshToken: auth.refreshToken,
        expiresIn: 0,
        obtainmentTimestamp: 0,
      }, ['chat'])

      return provider
    }
  }
}

/**
 * Thin wrapper around twurple's {@link ChatClient} implementing {@link TwitchChatPort}.
 *
 * Use when:
 * - Connecting the adapter to real Twitch chat (anonymous or authenticated).
 *
 * Expects:
 * - Channel login names without the leading `#`.
 *
 * Returns:
 * - Normalized {@link TwitchChatMessage} objects; reconnection and rate
 *   limiting are handled internally by twurple.
 */
export class TwitchChatClient implements TwitchChatPort {
  readonly canSend: boolean
  private readonly chatClient: ChatClient

  private constructor(chatClient: ChatClient, canSend: boolean) {
    this.chatClient = chatClient
    this.canSend = canSend

    this.chatClient.onConnect(() => log.log('Connected to Twitch chat'))
    this.chatClient.onDisconnect((manually, reason) => {
      if (manually)
        log.log('Disconnected from Twitch chat')
      else
        log.withError(reason).warn('Lost connection to Twitch chat, twurple will reconnect')
    })
    this.chatClient.onJoin(channel => log.log(`Joined channel #${toUserName(channel)}`))
    this.chatClient.onJoinFailure((channel, reason) => log.error(`Failed to join channel #${toUserName(channel)}: ${reason}`))
  }

  static async create(options: TwitchChatClientOptions): Promise<TwitchChatClient> {
    const authProvider = await createAuthProvider(options.auth)

    const chatClient = new ChatClient({
      authProvider,
      channels: options.channels,
      rejoinChannelsOnReconnect: true,
    })

    return new TwitchChatClient(chatClient, options.auth.mode !== 'anonymous')
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const listeners: Array<{ unbind: () => void }> = []
      const settle = (complete: () => void) => {
        for (const listener of listeners)
          listener.unbind()
        complete()
      }

      listeners.push(
        this.chatClient.onConnect(() => settle(resolve)),
        this.chatClient.onAuthenticationFailure((text, retryCount) => {
          settle(() => reject(new Error(`Twitch authentication failed (attempt ${retryCount}): ${text}`)))
        }),
      )

      this.chatClient.connect()
    })
  }

  onMessage(handler: (message: TwitchChatMessage) => void): void {
    this.chatClient.onMessage((channel, _user, text, msg) => {
      handler({
        channel: toUserName(channel),
        channelId: msg.channelId ?? undefined,
        text,
        user: {
          id: msg.userInfo.userId,
          login: msg.userInfo.userName,
          displayName: msg.userInfo.displayName,
        },
        messageId: msg.id,
      })
    })
  }

  async say(channel: string, text: string): Promise<void> {
    if (!this.canSend) {
      log.warn('Cannot send messages on an anonymous connection, dropping reply')
      return
    }

    await this.chatClient.say(channel, text)
  }

  quit(): void {
    this.chatClient.quit()
  }
}
