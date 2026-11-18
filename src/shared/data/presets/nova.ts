import { createUniqueModelId } from '@shared/data/types/model'

/** NOVA Studio's only provider: the cdkai.cc API. */
export const NOVA_PROVIDER_ID = 'nova' as const

/**
 * The model new installs start with for chat, the quick assistant, translation, topic naming and error
 * diagnosis. Chosen for low price, good Chinese and English, and no announced retirement on cdkai.cc.
 */
export const NOVA_DEFAULT_MODEL_ID = 'deepseek/deepseek-v4-flash' as const
export const NOVA_DEFAULT_MODEL_NAME = 'DeepSeek V4 Flash' as const
export const NOVA_DEFAULT_MODEL_GROUP = 'DeepSeek' as const
export const NOVA_DEFAULT_UNIQUE_MODEL_ID = createUniqueModelId(NOVA_PROVIDER_ID, NOVA_DEFAULT_MODEL_ID)

/**
 * Services run by the Cherry Studio team (Cherry Cloud accounts and subscriptions, product feedback,
 * diagnostic report upload) are not part of NOVA Studio, so their entry points stay hidden. Upstream UI
 * tests turn this on in tests/renderer.setup.ts.
 */
export const cherryServices = { enabled: false }

/** The NOVA website, where accounts, top-ups, docs and downloads live. */
export const NOVA_WEBSITE_URL = 'https://cdkai.cc'
export const NOVA_DOCS_URL = 'https://cdkai.cc/docs'
/** Corresponding source for each release, as the AGPL-3.0 requires; published next to the installers. */
export const NOVA_SOURCE_URL = 'https://cdkai.cc/downloads/nova-studio/source'
/** The project NOVA Studio is based on. */
export const UPSTREAM_PROJECT_URL = 'https://github.com/CherryHQ/cherry-studio'

/** The NOVA API that cloud voice calls, with the key the NOVA account panel created. */
export const NOVA_API_BASE_URL = 'https://api.cdkai.cc/v1'

/** Speech-to-text model behind NOVA cloud dictation: inexpensive, multilingual, detects the language. */
export const NOVA_TRANSCRIPTION_MODEL = 'openai/gpt-4o-mini-transcribe'

export interface NovaSpeechVoice {
  /** Stable id stored in voice settings. */
  readonly id: string
  readonly name: string
  readonly locale: string
  readonly languages?: readonly string[]
  readonly model: string
  readonly voice: string
  /** Sample rate of the model's raw 16-bit mono PCM output. */
  readonly sampleRate: number
}

/** Voices offered for NOVA cloud read-aloud; each model's PCM sample rate was measured on cdkai.cc. */
export const NOVA_SPEECH_VOICES: readonly NovaSpeechVoice[] = []
