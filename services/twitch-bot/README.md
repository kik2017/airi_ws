# `@proj-airi/twitch-bot`

Twitch live chat bridge for [Project AIRI](https://github.com/moeru-ai/airi).

Joins one or more Twitch channels, forwards chat messages into the AIRI
server channel as `input:text` events (so the stage's consciousness can react
and speak), and optionally relays AIRI's text responses back into Twitch chat.

## What it does

- Connects to Twitch chat via [Twurple](https://twurple.js.org/) (IRC over WebSocket).
- Forwards each chat message to AIRI with Twitch metadata (channel, user,
  message id) and a per-channel session id (`twitch-channel-<login>`), the same
  pattern used by `services/discord-bot`.
- Listens for `output:gen-ai:chat:message` events that originated from Twitch
  input and replies in the originating channel, chunked to Twitch's 500
  character message limit.

## When to use it

- You want AIRI to read and react to your Twitch chat while streaming
  (Neuro-sama style: responses are spoken on stage via the configured TTS).

## When not to use it

- You need YouTube/Bilibili live chat — those are separate services/plugins.
- You need moderation policies (word filters, slow-mode awareness) — this
  service is a transport adapter only; moderation belongs in a separate layer.

## Getting started

```shell
git clone https://github.com/moeru-ai/airi.git
cd airi
pnpm i
```

Create a `.env.local` next to `.env` in `services/twitch-bot` and fill in your
credentials:

```shell
cd services/twitch-bot
cp .env .env.local
```

### Connection modes

| Mode | Required variables | Can reply in chat? |
| --- | --- | --- |
| Anonymous (read-only) | `TWITCH_CHANNELS` | No |
| Static token | + `TWITCH_CLIENT_ID`, `TWITCH_ACCESS_TOKEN` | Yes |
| Self-refreshing token | + `TWITCH_CLIENT_SECRET`, `TWITCH_REFRESH_TOKEN` | Yes (recommended for long sessions) |

Anonymous mode needs no Twitch app at all — useful to verify the pipeline
before setting up credentials.

For authenticated modes:

1. Create an application on the [Twitch developer console](https://dev.twitch.tv/console/apps)
   to obtain `TWITCH_CLIENT_ID` (and `TWITCH_CLIENT_SECRET`).
2. Obtain a user access token for the **bot account** with the `chat:read` and
   `chat:edit` scopes (for example via the [Twitch CLI](https://dev.twitch.tv/docs/cli/)
   `twitch token -u -s 'chat:read chat:edit'`, or any OAuth flow you prefer).
   Use the resulting access/refresh tokens in `.env.local`.
3. Set `TWITCH_BOT_USERNAME` to the bot account's login name so the bot
   ignores its own messages.

### Run

Make sure an AIRI stage (Stage Web or Stage Tamagotchi) or server runtime is
listening on `AIRI_URL` (defaults to `ws://localhost:6121/ws`), then:

```shell
pnpm -F @proj-airi/twitch-bot start
```

### Behavior tuning

- `TWITCH_MENTION_ONLY='true'` — only forward messages that mention
  `@TWITCH_BOT_USERNAME`. Useful in busy chats; by default every message is
  forwarded and will trigger a response from the stage.
- `TWITCH_IGNORE_COMMANDS` — messages starting with `!` are ignored by default
  since they are usually addressed to other channel bots.
- `TWITCH_REPLY_IN_CHAT='false'` — keep AIRI's replies voice-only on stage
  instead of also posting them as chat messages.

## Development

```shell
pnpm -F @proj-airi/twitch-bot dev
pnpm -F @proj-airi/twitch-bot test
pnpm -F @proj-airi/twitch-bot typecheck
```
