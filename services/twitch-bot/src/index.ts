import process, { env, exit } from 'node:process'

import { Format, LogLevel, setGlobalFormat, setGlobalLogLevel, useLogg } from '@guiiai/logg'
import { Client as ServerChannel } from '@proj-airi/server-sdk'

import { TwitchAdapter } from './adapters/airi-adapter'
import { TwitchChatClient } from './clients/twitch-client'
import { configFromEnv } from './config'

setGlobalFormat(Format.Pretty)
setGlobalLogLevel(LogLevel.Log)
const log = useLogg('TwitchBot').useGlobalConfig()

async function main() {
  const config = configFromEnv(env)
  log.log(`Starting Twitch bot: channels ${config.channels.map(channel => `#${channel}`).join(', ')}, auth mode '${config.auth.mode}', AIRI hub ${config.airiUrl}`)

  const airiClient = new ServerChannel({
    name: 'twitch',
    possibleEvents: [
      'input:text',
      'output:gen-ai:chat:message',
    ],
    token: config.airiToken,
    url: config.airiUrl,
    // Surface connection progress: without these the SDK retries forever in
    // silence when no AIRI hub is listening (e.g. stage-web running without
    // a server channel), which looks like a hung process.
    onError: error => log.withError(error).warn(`Cannot reach AIRI server channel at ${config.airiUrl}, retrying...`),
    onStateChange: ({ previousStatus, status }) => {
      if (status === 'failed')
        log.error(`AIRI server channel connection failed permanently (was: ${previousStatus})`)
      else if (status === 'ready')
        log.log('AIRI server channel ready')
    },
  })

  const chat = await TwitchChatClient.create({
    channels: config.channels,
    auth: config.auth,
  })

  const adapter = new TwitchAdapter(airiClient, chat, {
    botUsername: config.botUsername,
    mentionOnly: config.mentionOnly,
    ignoreCommands: config.ignoreCommands,
    replyInChat: config.replyInChat,
  })

  await adapter.start()
  log.log(`Twitch bot ready, joined: ${config.channels.map(channel => `#${channel}`).join(', ')} (${config.auth.mode} mode)`)

  function gracefulShutdown(signal: string) {
    log.log(`Received ${signal}, shutting down...`)
    adapter.stop()
    exit(0)
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
}

main().catch((err) => {
  log.withError(err).error('Failed to start Twitch bot')
  exit(1)
})
