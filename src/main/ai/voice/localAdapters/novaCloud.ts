import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'

import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import { providerService } from '@main/data/services/ProviderService'
import {
  DEFAULT_SPEECH_SPEED,
  LOCAL_VOICE_MODELS,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  NOVA_ASR_MODEL_ID,
  NOVA_TTS_MODEL_ID,
  VoiceModelSupport,
  type LocalSpeechVoice
} from '@shared/ai/localVoice'
import { NOVA_API_BASE_URL, NOVA_SPEECH_VOICES, NOVA_TRANSCRIPTION_MODEL } from '@shared/data/presets/nova'

import type { LocalVoiceStatus, SpeechModelDefinition, TranscriptionModelDefinition } from '../voiceModelTypes'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { completeSpeechOperation, completeTranscriptionOperation } from './sdkOperations'

/**
 * NOVA cloud voice: speech recognition and speech synthesis through the NOVA API with the key
 * the NOVA account panel created for this computer. Billed to the user's NOVA balance.
 */

function novaKey(): string | null {
  try {
    const key = providerService.getRotatedApiKey('nova')
    return key && key.startsWith('sk-nova-') ? key : null
  } catch {
    return null
  }
}

function novaStatus(signal?: AbortSignal): LocalVoiceStatus {
  checkAbort(signal)
  return novaKey() ? { status: 'ready' } : { status: 'not_installed', reason: 'model_required' }
}

async function novaFetch(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const key = novaKey()
  if (!key) throw new VoiceRuntimeError('model_required')
  const timeout = AbortSignal.timeout(120_000)
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout
  let response: Response
  try {
    response = await fetch(`${NOVA_API_BASE_URL}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${key}` },
      signal: combined
    })
  } catch (error) {
    checkAbort(signal)
    if (timeout.aborted) throw new VoiceRuntimeError('timeout')
    throw error instanceof VoiceRuntimeError ? error : new VoiceRuntimeError('operation_failed')
  }
  if (!response.ok) throw new VoiceRuntimeError('operation_failed')
  return response
}

function sniffAudio(audio: Uint8Array, mediaType?: string): { name: string; type: string } {
  const head = String.fromCharCode(...audio.subarray(0, 4))
  if (head === 'RIFF') return { name: 'audio.wav', type: 'audio/wav' }
  if (head === 'OggS') return { name: 'audio.ogg', type: 'audio/ogg' }
  if (audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3)
    return { name: 'audio.webm', type: 'audio/webm' }
  if (head.startsWith('ID3') || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0))
    return { name: 'audio.mp3', type: 'audio/mpeg' }
  return { name: 'audio.wav', type: mediaType || 'audio/wav' }
}

export function createNovaTranscriptionModel(options: TranscriptionOptions): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: NOVA_ASR_MODEL_ID,
    async doGenerate(input) {
      checkAbort(input.abortSignal)
      const audio = typeof input.audio === 'string' ? Uint8Array.from(Buffer.from(input.audio, 'base64')) : input.audio
      const file = sniffAudio(audio, input.mediaType)
      const form = new FormData()
      form.append('model', NOVA_TRANSCRIPTION_MODEL)
      const language = options.language?.split('-')[0]
      if (language) form.append('language', language)
      form.append('file', new Blob([audio], { type: file.type }), file.name)
      const response = await novaFetch('/audio/transcriptions', { method: 'POST', body: form }, input.abortSignal)
      const body = (await response.json()) as { text?: unknown; language?: unknown; duration?: unknown }
      const text = typeof body.text === 'string' ? body.text : ''
      return {
        text,
        segments: [],
        language: typeof body.language === 'string' ? body.language : undefined,
        durationInSeconds: typeof body.duration === 'number' ? body.duration : undefined,
        warnings: [],
        response: { timestamp: new Date(), modelId: NOVA_TRANSCRIPTION_MODEL }
      }
    }
  }
}

/** Wraps raw 16-bit mono PCM in a WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Uint8Array.from(Buffer.concat([header, data]))
}

const VOICES: LocalSpeechVoice[] = NOVA_SPEECH_VOICES.map((voice) => ({
  id: voice.id,
  name: voice.name,
  locale: voice.locale,
  languages: voice.languages
}))

export function createNovaSpeechModel(options: SpeechOptions): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: NOVA_TTS_MODEL_ID,
    async doGenerate(input) {
      checkAbort(input.abortSignal)
      const voice =
        NOVA_SPEECH_VOICES.find((entry) => entry.id === (options.voice ?? input.voice)) ?? NOVA_SPEECH_VOICES[0]
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        !voice ||
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      const response = await novaFetch(
        '/audio/speech',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: voice.model,
            voice: voice.voice,
            input: input.text,
            response_format: 'pcm',
            ...(speed !== DEFAULT_SPEECH_SPEED && { speed })
          })
        },
        input.abortSignal
      )
      const pcm = new Uint8Array(await response.arrayBuffer())
      checkAbort(input.abortSignal)
      if (pcm.length < 2) throw new VoiceRuntimeError('operation_failed')
      return {
        audio: pcmToWav(pcm, voice.sampleRate),
        warnings: [],
        response: { timestamp: new Date(), modelId: voice.model }
      }
    }
  }
}

const describeModel = (id: typeof NOVA_ASR_MODEL_ID | typeof NOVA_TTS_MODEL_ID) => ({
  ...LOCAL_VOICE_MODELS.find((model) => model.id === id)!,
  localeSelection: null,
  resourceOperations: []
})

export const novaTranscriptionDefinition: TranscriptionModelDefinition = {
  id: NOVA_ASR_MODEL_ID,
  adapterId: 'nova-cloud',
  support: () => VoiceModelSupport.Supported,
  describe: () => describeModel(NOVA_ASR_MODEL_ID),
  status: (_options, signal) => novaStatus(signal),
  locales: async () => ({ supported: [], installed: [] }),
  transcriptionOperations: [completeTranscriptionOperation(createNovaTranscriptionModel)]
}

export const novaSpeechDefinition: SpeechModelDefinition = {
  id: NOVA_TTS_MODEL_ID,
  adapterId: 'nova-cloud',
  support: () => VoiceModelSupport.Supported,
  describe: () => describeModel(NOVA_TTS_MODEL_ID),
  status: (_options, signal) => novaStatus(signal),
  speechOperations: [completeSpeechOperation(createNovaSpeechModel)],
  voices: async (signal) => {
    checkAbort(signal)
    return VOICES
  },
  getDefaultVoice: async (language, signal) => {
    checkAbort(signal)
    const base = language?.split('-')[0]
    return (
      VOICES.find((voice) => voice.locale === language) ??
      VOICES.find((voice) => voice.locale.split('-')[0] === base) ??
      VOICES[0] ??
      null
    )
  }
}
