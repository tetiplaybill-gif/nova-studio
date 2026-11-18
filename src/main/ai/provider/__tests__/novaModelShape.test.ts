import { describe, expect, it } from 'vitest'

import { novaModelShape } from '../listModels'

describe('novaModelShape', () => {
  it('gives each NOVA model type the capability and endpoint the app routes by', () => {
    expect(novaModelShape({ type: 'image', endpoints: ['/v1/images'] })).toEqual({
      capabilities: ['image-generation'],
      endpointTypes: ['openai-image-generation']
    })
    expect(novaModelShape({ type: 'embeddings' })).toEqual({
      capabilities: ['embedding'],
      endpointTypes: ['openai-embeddings']
    })
    expect(novaModelShape({ type: 'rerank' })).toEqual({ capabilities: ['rerank'] })
    expect(novaModelShape({ type: 'speech' })?.endpointTypes).toEqual(['openai-text-to-speech'])
    expect(novaModelShape({ type: 'transcription' })?.endpointTypes).toEqual(['openai-audio-transcription'])
    expect(novaModelShape({ type: 'video' })?.endpointTypes).toEqual(['openai-video-generation'])
  })

  it('keeps chat models as chat, marks chat models that also draw, and skips API-only types', () => {
    expect(novaModelShape({ type: 'chat', endpoints: ['/v1/chat/completions'] })).toEqual({})
    expect(novaModelShape({})).toEqual({})
    expect(novaModelShape({ type: 'chat', endpoints: ['/v1/chat/completions', '/v1/images'] })).toEqual({
      capabilities: ['image-generation']
    })
    expect(novaModelShape({ type: 'decisions' })).toBeNull()
    expect(novaModelShape({ type: 'extractions' })).toBeNull()
  })
})
