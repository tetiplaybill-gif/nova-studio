import { defineProvider } from './types'
import { EFFORT, modeWire } from './wires'

/**
 * NOVA — the cdkai.cc API, and the only provider NOVA Studio shows.
 * Requests use OpenRouter's wire format (the NOVA gateway forwards them unchanged), so reasoning effort
 * and server tools follow OpenRouter's. The gateway reports no per-request cost; billing lives on cdkai.cc.
 */
export default defineProvider({
  id: 'nova',
  name: 'NOVA',
  availableInEditions: ['global'],
  reportsActualCost: false,
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.cdkai.cc'
    },
    'openai-chat-completions': {
      adapterFamily: 'openrouter',
      baseUrl: 'https://api.cdkai.cc/v1/',
      reasoningFormat: {
        type: 'openai-chat',
        wire: modeWire('reasoning.effort', { off: 'none', auto: EFFORT, effort: EFFORT }, { autoEffort: 'medium' })
      },
      modelsApiUrls: {
        default: 'https://api.cdkai.cc/v1/models',
        embedding: 'https://api.cdkai.cc/v1/embeddings/models',
        image: 'https://api.cdkai.cc/v1/images/models',
        reranker: 'https://api.cdkai.cc/v1/models?output_modalities=rerank'
      }
    },
    // Image generation goes through the same OpenRouter-compatible adapter as chat.
    'openai-image-generation': {
      adapterFamily: 'openrouter',
      baseUrl: 'https://api.cdkai.cc/v1/'
    }
  },
  serverTools: [
    { id: 'web-search', modelScope: 'all-chat-models' },
    { id: 'url-context', modelScope: 'all-chat-models' }
  ],
  metadata: {
    website: {
      apiKey: 'https://cdkai.cc/console',
      docs: 'https://cdkai.cc/docs',
      models: 'https://cdkai.cc/console',
      official: 'https://cdkai.cc/'
    }
  }
})
