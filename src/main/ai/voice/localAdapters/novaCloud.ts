import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'

import { application } from '@application'
import type { SpeechOptions, TranscriptionOptions } from '@cherrystudio/ai-core'
import { providerService } from '@main/data/services/ProviderService'
import { voiceLocale } from '@main/services/nova/novaMediaFormat'
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
import type { NovaMediaModel } from '@shared/ipc/schemas/novaMedia'

import type { LocalVoiceStatus, SpeechModelDefinition, TranscriptionModelDefinition } from '../voiceModelTypes'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { completeSpeechOperation, completeTranscriptionOperation } from './sdkOperations'

/**
 * NOVA cloud voice: speech recognition and speech synthesis through the NOVA API with the key
 * the NOVA account panel created for this computer. Billed to the user's NOVA balance. The models
 * and voice come from the NOVA voice settings (Create → Speech / Transcription).
 */

const media = () => application.get('NovaMediaService')

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

/** Runs a NOVA call, turning its failures into the voice runtime's errors. */
async function voiceCall<T>(signal: AbortSignal | undefined, call: () => Promise<T>): Promise<T> {
  if (!novaKey()) throw new VoiceRuntimeError('model_required')
  try {
    const result = await call()
    checkAbort(signal)
    return result
  } catch (error) {
    checkAbort(signal)
    throw error instanceof VoiceRuntimeError ? error : new VoiceRuntimeError('operation_failed')
  }
}

function sniffAudio(audio: Uint8Array): string {
  const head = String.fromCharCode(...audio.subarray(0, 4))
  if (head === 'OggS') return 'audio.ogg'
  if (audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3) return 'audio.webm'
  if (head.startsWith('ID3') || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)) return 'audio.mp3'
  return 'audio.wav'
}

export function createNovaTranscriptionModel(options: TranscriptionOptions): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: NOVA_ASR_MODEL_ID,
    async doGenerate(input) {
      checkAbort(input.abortSignal)
      const audio = typeof input.audio === 'string' ? Uint8Array.from(Buffer.from(input.audio, 'base64')) : input.audio
      const model = media().voiceSettings().transcriptionModel
      const result = await voiceCall(input.abortSignal, () =>
        media().transcribeAudio(model, audio, sniffAudio(audio), options.language?.split('-')[0])
      )
      return {
        text: result.text,
        segments: [],
        language: result.language ?? undefined,
        durationInSeconds: result.durationSeconds ?? undefined,
        warnings: [],
        response: { timestamp: new Date(), modelId: model }
      }
    }
  }
}

/** The speech model read-aloud uses: the one picked in Create → Speech, else a sensible default. */
export function pickSpeechModel(models: NovaMediaModel[], preferred: string): NovaMediaModel | null {
  const speech = models.filter((model) => model.type === 'speech')
  return (
    speech.find((model) => model.id === preferred) ??
    speech.find((model) => model.id.includes('gpt-4o-mini-tts')) ??
    speech.find((model) => model.voices.length > 0) ??
    null
  )
}

async function readAloudVoices(): Promise<{ model: NovaMediaModel | null; voices: LocalSpeechVoice[] }> {
  const catalog = await media().catalog()
  const model = catalog.ok ? pickSpeechModel(catalog.data, media().voiceSettings().speechModel) : null
  const voices = (model?.voices ?? []).map((voice) => {
    const locale = voiceLocale(voice)
    return { id: voice, name: voice, locale, languages: locale ? [locale.split('-')[0]] : [] }
  })
  return { model, voices }
}

export function createNovaSpeechModel(options: SpeechOptions): SpeechModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId: NOVA_TTS_MODEL_ID,
    async doGenerate(input) {
      checkAbort(input.abortSignal)
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      const { model, voices } = await voiceCall(input.abortSignal, readAloudVoices)
      if (!model) throw new VoiceRuntimeError('model_required')
      const wanted = options.voice ?? input.voice ?? media().voiceSettings().speechVoice
      const voice = voices.find((entry) => entry.id === wanted)?.id ?? voices[0]?.id ?? ''
      const audio = await voiceCall(input.abortSignal, () =>
        media().speechAudio({ model: model.id, voice, text: input.text, speed, format: 'wav' })
      )
      return { audio, warnings: [], response: { timestamp: new Date(), modelId: model.id } }
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
    return (await readAloudVoices()).voices
  },
  getDefaultVoice: async (language, signal) => {
    checkAbort(signal)
    const { voices } = await readAloudVoices()
    const chosen = media().voiceSettings().speechVoice
    const base = language?.split('-')[0]
    return (
      voices.find((voice) => voice.id === chosen) ??
      voices.find((voice) => voice.locale === language) ??
      voices.find((voice) => voice.locale.split('-')[0] === base) ??
      voices[0] ??
      null
    )
  }
}
