import * as v from 'valibot'

/**
 * How the chat connection authenticates against Twitch.
 *
 * - `anonymous`: read-only connection, no Twitch app required, cannot send messages.
 * - `static`: a fixed user access token, valid until Twitch expires it (~4h).
 * - `refreshing`: client credentials + refresh token, refreshed automatically —
 *   the right mode for long-running stream sessions.
 */
export type TwitchAuth
  = | { mode: 'anonymous' }
    | { mode: 'static', clientId: string, accessToken: string }
    | { mode: 'refreshing', clientId: string, clientSecret: string, refreshToken: string }

export interface TwitchBotConfig {
  /**
   * Channel login names to join, lowercase, without the leading `#`.
   */
  channels: string[]
  auth: TwitchAuth
  /**
   * Login name of the bot account, used to ignore the bot's own messages and
   * to detect mentions.
   */
  botUsername?: string
  /**
   * Only forward messages mentioning `@botUsername`.
   * @default false
   */
  mentionOnly: boolean
  /**
   * Drop messages starting with `!` (usually commands for other channel bots).
   * @default true
   */
  ignoreCommands: boolean
  /**
   * Relay AIRI's responses back into Twitch chat. Requires an authenticated
   * connection.
   * @default true when authenticated, false when anonymous
   */
  replyInChat: boolean
  airiToken?: string
  airiUrl: string
}

/**
 * Normalizes the raw TWITCH_CHANNELS value into channel login names.
 *
 * Before:
 * - "#MyChannel, otherchannel ,"
 *
 * After:
 * - ["mychannel", "otherchannel"]
 */
function parseChannels(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(channel => channel.trim().replace(/^#/, '').toLowerCase())
    .filter(channel => channel.length > 0)
}

const emptyableString = v.optional(v.pipe(
  v.string(),
  v.trim(),
  v.transform(value => value === '' ? undefined : value),
))

const emptyableFlag = v.optional(v.pipe(
  v.string(),
  v.trim(),
  v.toLowerCase(),
  v.picklist(['', 'true', 'false'], 'must be \'true\' or \'false\''),
  v.transform(value => value === '' ? undefined : value === 'true'),
))

const envSchema = v.object({
  TWITCH_CHANNELS: emptyableString,
  TWITCH_CLIENT_ID: emptyableString,
  TWITCH_ACCESS_TOKEN: emptyableString,
  TWITCH_CLIENT_SECRET: emptyableString,
  TWITCH_REFRESH_TOKEN: emptyableString,
  TWITCH_BOT_USERNAME: emptyableString,
  TWITCH_MENTION_ONLY: emptyableFlag,
  TWITCH_IGNORE_COMMANDS: emptyableFlag,
  TWITCH_REPLY_IN_CHAT: emptyableFlag,
  AIRI_TOKEN: emptyableString,
  AIRI_URL: emptyableString,
})

function configError(message: string): Error {
  return new Error(`Invalid twitch-bot configuration: ${message}`)
}

function resolveAuth(raw: v.InferOutput<typeof envSchema>): TwitchAuth {
  if (raw.TWITCH_REFRESH_TOKEN) {
    if (!raw.TWITCH_CLIENT_ID || !raw.TWITCH_CLIENT_SECRET)
      throw configError('TWITCH_REFRESH_TOKEN requires both TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to be set.')

    return {
      mode: 'refreshing',
      clientId: raw.TWITCH_CLIENT_ID,
      clientSecret: raw.TWITCH_CLIENT_SECRET,
      refreshToken: raw.TWITCH_REFRESH_TOKEN,
    }
  }

  if (raw.TWITCH_ACCESS_TOKEN) {
    if (!raw.TWITCH_CLIENT_ID)
      throw configError('TWITCH_ACCESS_TOKEN requires TWITCH_CLIENT_ID to be set.')

    return {
      mode: 'static',
      clientId: raw.TWITCH_CLIENT_ID,
      accessToken: raw.TWITCH_ACCESS_TOKEN,
    }
  }

  if (raw.TWITCH_CLIENT_ID || raw.TWITCH_CLIENT_SECRET)
    throw configError('TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET are set but no TWITCH_ACCESS_TOKEN or TWITCH_REFRESH_TOKEN was provided. Provide a token, or clear them to connect anonymously (read-only).')

  return { mode: 'anonymous' }
}

/**
 * Parses and validates twitch-bot configuration from environment variables.
 *
 * Use when:
 * - Booting the service (`src/index.ts`) or constructing a config in tests.
 *
 * Expects:
 * - A `process.env`-like record; empty strings are treated as unset so the
 *   committed `.env` template works without modification.
 *
 * Returns:
 * - A fully resolved {@link TwitchBotConfig}; throws an `Error` with a
 *   human-readable message when the combination of variables is invalid.
 */
export function configFromEnv(source: Record<string, string | undefined>): TwitchBotConfig {
  const raw = v.parse(envSchema, {
    TWITCH_CHANNELS: source.TWITCH_CHANNELS,
    TWITCH_CLIENT_ID: source.TWITCH_CLIENT_ID,
    TWITCH_ACCESS_TOKEN: source.TWITCH_ACCESS_TOKEN,
    TWITCH_CLIENT_SECRET: source.TWITCH_CLIENT_SECRET,
    TWITCH_REFRESH_TOKEN: source.TWITCH_REFRESH_TOKEN,
    TWITCH_BOT_USERNAME: source.TWITCH_BOT_USERNAME,
    TWITCH_MENTION_ONLY: source.TWITCH_MENTION_ONLY,
    TWITCH_IGNORE_COMMANDS: source.TWITCH_IGNORE_COMMANDS,
    TWITCH_REPLY_IN_CHAT: source.TWITCH_REPLY_IN_CHAT,
    AIRI_TOKEN: source.AIRI_TOKEN,
    AIRI_URL: source.AIRI_URL,
  })

  const channels = parseChannels(raw.TWITCH_CHANNELS)
  if (channels.length === 0)
    throw configError('TWITCH_CHANNELS must contain at least one channel login name, e.g. TWITCH_CHANNELS=\'mychannel\'.')

  const auth = resolveAuth(raw)

  if (raw.TWITCH_REPLY_IN_CHAT === true && auth.mode === 'anonymous')
    throw configError('TWITCH_REPLY_IN_CHAT requires an authenticated connection. Provide TWITCH_CLIENT_ID and an access or refresh token.')

  const mentionOnly = raw.TWITCH_MENTION_ONLY ?? false
  if (mentionOnly && !raw.TWITCH_BOT_USERNAME)
    throw configError('TWITCH_MENTION_ONLY requires TWITCH_BOT_USERNAME so mentions can be detected.')

  return {
    channels,
    auth,
    botUsername: raw.TWITCH_BOT_USERNAME?.replace(/^@/, '').toLowerCase(),
    mentionOnly,
    ignoreCommands: raw.TWITCH_IGNORE_COMMANDS ?? true,
    replyInChat: raw.TWITCH_REPLY_IN_CHAT ?? auth.mode !== 'anonymous',
    airiToken: raw.AIRI_TOKEN,
    airiUrl: raw.AIRI_URL ?? 'ws://localhost:6121/ws',
  }
}
