import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { OFFICIAL_SPEECH_PROVIDER_ID, OFFICIAL_SPEECH_STREAMING_PROVIDER_ID } from '../../libs/providers/providers/official'
import { useProvidersStore } from '../providers'
import { toSignedPercent, useSpeechStore, voicePackForSpeechProvider } from './speech'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('speech store helpers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('formats positive percentages with a plus sign', () => {
    expect(toSignedPercent(25)).toBe('+25%')
  })

  it('formats negative percentages without a double minus', () => {
    expect(toSignedPercent(-20)).toBe('-20%')
    expect(toSignedPercent(-20)).not.toContain('--')
  })

  it('formats zero as 0%', () => {
    expect(toSignedPercent(0)).toBe('0%')
  })

  /**
   * @example
   * speechStore.resolveVoicePackSpeechInput({ text, voice, providerConfig: { voice: 'plain' } })
   */
  it('leaves speech input unchanged when no Voice Pack is configured', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'plain-voice',
      name: 'Plain Voice',
      provider: 'openai-compatible-audio-speech',
      languages: [{ code: 'en-US', title: 'English' }],
    }

    const request = speechStore.resolveVoicePackSpeechInput({
      text: 'hello',
      voice,
      providerConfig: { voice: 'plain-voice' },
    })

    expect(request.input).toBe('hello')
    expect(request.providerConfig).toEqual({ voice: 'plain-voice' })
  })

  /**
   * @example
   * voicePackForSpeechProvider('openai-compatible-audio-speech', voicePack)
   */
  it('ignores Voice Pack snapshots for non-official speech providers', () => {
    const voicePack = {
      packId: 'vp-1',
      name: 'Frozen',
      provider: 'volcengine',
      model: 'seed-tts-2.0',
      voiceId: 'voice-a',
      ttsModelId: 'volcengine/pool-a',
      params: {},
      costMultiplier: 1,
    }

    expect(voicePackForSpeechProvider('openai-compatible-audio-speech', voicePack)).toBeUndefined()
    expect(voicePackForSpeechProvider(OFFICIAL_SPEECH_PROVIDER_ID, voicePack)).toBe(voicePack)
    expect(voicePackForSpeechProvider(OFFICIAL_SPEECH_STREAMING_PROVIDER_ID, voicePack)).toBeUndefined()
  })

  /**
   * @example
   * speechStore.resolveVoicePackSpeechInput({ text, voice, params: { rate: '+20%' } })
   */
  it('maps Voice Pack rate params to provider speed', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'voice-1',
      name: 'Voice 1',
      provider: OFFICIAL_SPEECH_PROVIDER_ID,
      languages: [{ code: 'en-US', title: 'English' }],
    }

    const request = speechStore.resolveVoicePackSpeechInput({
      text: 'hello',
      voice,
      params: { rate: '+20%' },
    })

    expect(request.input).toBe('hello')
    expect(request.providerConfig.speed).toBe(1.2)
  })

  /**
   * @example
   * speechStore.resolveVoicePackSpeechInput({ text, voice, params: { pitch: '+20%' }, supportsSSML: true })
   */
  it('applies Voice Pack prosody params through SSML when supported', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'voice-1',
      name: 'Voice 1',
      provider: OFFICIAL_SPEECH_PROVIDER_ID,
      languages: [{ code: 'en-US', title: 'English' }],
      gender: 'neutral',
    }

    const request = speechStore.resolveVoicePackSpeechInput({
      text: 'hello',
      voice,
      params: {
        pitch: '+20%',
        volume: '-5%',
      },
      supportsSSML: true,
    })

    expect(request.input).toContain('<prosody')
    expect(request.input).toContain('pitch="+20%"')
    expect(request.input).toContain('volume="-5%"')
  })

  /**
   * @example
   * speechStore.resolveVoicePackSpeechInput({ text, voice, params: { pitch: '+20%' }, supportsAdapterProsody: true })
   */
  it('passes Voice Pack prosody params through adapter options when supported', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'voice-1',
      name: 'Voice 1',
      provider: OFFICIAL_SPEECH_PROVIDER_ID,
      languages: [{ code: 'en-US', title: 'English' }],
    }

    const request = speechStore.resolveVoicePackSpeechInput({
      text: 'hello',
      voice,
      params: {
        pitch: '+20%',
        volume: '+5%',
      },
      supportsAdapterProsody: true,
    })

    expect(request.input).toBe('hello')
    expect(request.providerConfig.extraBody).toEqual({
      voice_pack: {
        pitch: 20,
        volume: 5,
      },
    })
  })

  /**
   * @example
   * speechStore.resolveVoicePackSpeechInput({ text, voice, voicePack: { packId: 'vp-1', costMultiplier: 1.5 } })
   */
  it('passes Voice Pack snapshot billing metadata through adapter options', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'voice-1',
      name: 'Voice 1',
      provider: OFFICIAL_SPEECH_PROVIDER_ID,
      languages: [{ code: 'en-US', title: 'English' }],
    }

    const request = speechStore.resolveVoicePackSpeechInput({
      text: 'hello',
      voice,
      params: {},
      voicePack: {
        packId: 'vp-1',
        costMultiplier: 1.5,
      },
      supportsAdapterProsody: true,
    })

    expect(request.providerConfig.extraBody).toEqual({
      voice_pack: {
        pack_id: 'vp-1',
        cost_multiplier: 1.5,
      },
    })
  })

  /**
   * @example
   * speechStore.resolveVoicePackSpeechInput({ text, voice, params: { pitch: '+20%' }, supportsSSML: false })
   */
  it('fails fast when Voice Pack prosody params cannot be applied', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'voice-1',
      name: 'Voice 1',
      provider: OFFICIAL_SPEECH_PROVIDER_ID,
      languages: [{ code: 'en-US', title: 'English' }],
    }

    expect(() => speechStore.resolveVoicePackSpeechInput({
      text: 'hello',
      voice,
      params: { pitch: '+20%' },
      supportsSSML: false,
    })).toThrow('SSML-capable speech provider')
  })

  /**
   * @example
   * speechStore.resolveVoicePackSpeechInput({ text, voice, params: { emotion: 'happy' } })
   */
  it('fails fast on unsupported Voice Pack params', () => {
    const speechStore = useSpeechStore()
    const voice = {
      id: 'voice-1',
      name: 'Voice 1',
      provider: OFFICIAL_SPEECH_PROVIDER_ID,
      languages: [{ code: 'en-US', title: 'English' }],
    }

    expect(() => speechStore.resolveVoicePackSpeechInput({
      text: 'hello',
      voice,
      params: { emotion: 'happy' },
    })).toThrow('Unsupported Voice Pack parameter "emotion"')
  })

  /**
   * @example
   * await speechStore.loadVoicesForProvider(OFFICIAL_SPEECH_STREAMING_PROVIDER_ID, 'volcengine/seed-tts-2.0')
   */
  it('does not load streaming voices before server availability is confirmed', async () => {
    const providersStore = useProvidersStore()
    const speechStore = useSpeechStore()
    const listVoices = vi.fn(async () => [])
    const metadata = providersStore.providerMetadata[OFFICIAL_SPEECH_STREAMING_PROVIDER_ID]
    metadata.capabilities.listVoices = listVoices
    providersStore.providerRuntimeState[OFFICIAL_SPEECH_STREAMING_PROVIDER_ID].isConfigured = false

    const voices = await speechStore.loadVoicesForProvider(
      OFFICIAL_SPEECH_STREAMING_PROVIDER_ID,
      'volcengine/seed-tts-2.0',
    )

    expect(voices).toEqual([])
    expect(listVoices).not.toHaveBeenCalled()
  })

  /**
   * @example
   * speechStore.ensureActiveSpeechModel()
   */
  it('resets stale streaming model when the regular official speech provider is active', () => {
    const providersStore = useProvidersStore()
    const speechStore = useSpeechStore()
    speechStore.activeSpeechProvider = OFFICIAL_SPEECH_PROVIDER_ID
    speechStore.activeSpeechModel = 'volcengine/seed-tts-2.0'
    speechStore.activeSpeechVoiceId = 'zh_female_x'
    speechStore.activeSpeechVoice = {
      id: 'zh_female_x',
      name: 'X',
      provider: OFFICIAL_SPEECH_STREAMING_PROVIDER_ID,
      languages: [],
    }
    providersStore.providerRuntimeState[OFFICIAL_SPEECH_PROVIDER_ID].models = [
      { id: 'microsoft/v1', name: 'microsoft/v1', provider: OFFICIAL_SPEECH_PROVIDER_ID },
      { id: 'alibaba/cosyvoice-v2', name: 'alibaba/cosyvoice-v2', provider: OFFICIAL_SPEECH_PROVIDER_ID },
    ]

    speechStore.ensureActiveSpeechModel()

    expect(speechStore.activeSpeechModel).toBe('microsoft/v1')
    expect(speechStore.activeSpeechVoiceId).toBe('')
    expect(speechStore.activeSpeechVoice).toBeUndefined()
  })
})

describe('speech store custom voice resolution', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ROOT CAUSE:
  //
  // When an ElevenLabs API key lacks the `voices_read` permission, the voice
  // listing fails (401), so `availableVoices[provider]` stays empty. The
  // resolver watcher previously synthesized a voice object from the id ONLY for
  // `openai-compatible-audio-speech`; for every other provider it looked the id
  // up in the (empty) listing and set `activeSpeechVoice` to `undefined`. Since
  // the runtime speaks via `activeSpeechVoice.value?.id`, a manually entered /
  // persisted id could not produce audio after a reload.
  //
  // We fixed this by synthesizing a minimal voice from the id for ANY provider
  // when the listing does not contain it.
  /**
   * @example
   * speechStore.activeSpeechVoiceId = 'my-custom-voice'
   * // -> activeSpeechVoice resolves to { id: 'my-custom-voice', provider: 'elevenlabs', ... }
   */
  it('synthesizes a voice object from a persisted id when the listing is unavailable (Issue: ElevenLabs voices_read 401)', async () => {
    const providersStore = useProvidersStore()
    const speechStore = useSpeechStore()
    // Keep the provider-change watcher's voice load offline and deterministic.
    const meta = providersStore.providerMetadata.elevenlabs
    if (meta)
      meta.capabilities.listVoices = vi.fn(async () => [])

    speechStore.activeSpeechProvider = 'elevenlabs'
    await nextTick()

    speechStore.activeSpeechVoiceId = 'my-custom-voice'
    await nextTick()
    await nextTick()

    expect(speechStore.activeSpeechVoiceId).toBe('my-custom-voice')
    expect(speechStore.activeSpeechVoice?.id).toBe('my-custom-voice')
    expect(speechStore.activeSpeechVoice?.provider).toBe('elevenlabs')
  })

  /**
   * @example
   * speechStore.availableVoices = { elevenlabs: [{ id: 'rachel', name: 'Rachel', ... }] }
   * speechStore.activeSpeechVoiceId = 'rachel'
   * // -> activeSpeechVoice resolves to the full 'Rachel' metadata, not a synthesized stub
   */
  it('prefers full voice metadata from the provider listing over a synthesized voice', async () => {
    const providersStore = useProvidersStore()
    const speechStore = useSpeechStore()
    const meta = providersStore.providerMetadata.elevenlabs
    if (meta)
      meta.capabilities.listVoices = vi.fn(async () => [])

    speechStore.activeSpeechProvider = 'elevenlabs'
    await nextTick()

    speechStore.availableVoices = {
      elevenlabs: [{ id: 'rachel', name: 'Rachel', provider: 'elevenlabs', languages: [] }],
    }
    speechStore.activeSpeechVoiceId = 'rachel'
    await nextTick()
    await nextTick()

    expect(speechStore.activeSpeechVoice?.id).toBe('rachel')
    expect(speechStore.activeSpeechVoice?.name).toBe('Rachel')
  })
})
