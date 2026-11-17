import { readFileSync, writeFileSync } from 'node:fs'
import { stampAndSerialize } from '../../packages/provider-registry/scripts/catalogSerialization.mjs'
const path = 'packages/provider-registry/data/providers.json'
const data = JSON.parse(readFileSync(path, 'utf8'))
const { version, ...body } = data
const or = body.providers.find((p) => p.id === 'openrouter')
const chat = structuredClone(or.endpointConfigs['openai-chat-completions'])
delete chat.requestControls
chat.baseUrl = 'https://api.cdkai.cc/v1/'
chat.modelsApiUrls = { default: 'https://api.cdkai.cc/v1/models' }
const nova = {
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  description: 'NOVA API - cdkai.cc',
  endpointConfigs: {
    'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.cdkai.cc' },
    'openai-chat-completions': chat
  },
  id: 'nova',
  metadata: { website: { apiKey: 'https://cdkai.cc/console', docs: 'https://cdkai.cc/docs', models: 'https://cdkai.cc/console', official: 'https://cdkai.cc/' } },
  name: 'NOVA',
  // The NOVA gateway does not return per-request cost in responses; billing lives in the console.
  reportsActualCost: false,
  serverTools: or.serverTools
}
// NOVA Studio ships one provider: every other preset stays in the source but is hidden from this edition.
body.providers = [nova, ...body.providers.filter((p) => p.id !== 'nova').map((p) => ({ ...p, availableInEditions: ['cn'] }))]
writeFileSync(path, stampAndSerialize(body))
console.log('providers', body.providers.length)
