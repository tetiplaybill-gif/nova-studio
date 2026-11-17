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
