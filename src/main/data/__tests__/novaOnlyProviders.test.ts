import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isHiddenInNovaStudio, novaOnlyProviders, withoutNovaAddressOverrides } from '../novaOnlyProviders'

describe('NOVA-only providers', () => {
  beforeEach(() => {
    novaOnlyProviders.enabled = true
  })
  afterEach(() => {
    novaOnlyProviders.enabled = false
  })

  it('keeps NOVA and providers created from the NOVA preset', () => {
    expect(isHiddenInNovaStudio('nova', 'nova')).toBe(false)
    expect(isHiddenInNovaStudio('nova-team', 'nova')).toBe(false)
  })

  it('hides every other preset, Cherry Studio’s own services and custom providers', () => {
    for (const [id, preset] of [
      ['openrouter', 'openrouter'],
      ['openai', 'openai'],
      ['cherryai', 'cherryai'],
      ['cherryai-subscription', 'cherryai'],
      ['cherryin', 'cherryin'],
      ['my-proxy', null]
    ] as const) {
      expect(isHiddenInNovaStudio(id, preset)).toBe(true)
    }
  })

  it('is on in the shipped app (tests turn it off in tests/main.setup.ts)', () => {
    const source = readFileSync(join(__dirname, '..', 'novaOnlyProviders.ts'), 'utf8')
    expect(source).toContain('export const novaOnlyProviders = { enabled: true }')
  })

  it('keeps the NOVA provider on the cdkai.cc API while letting other endpoint settings through', () => {
    const edited = {
      'openai-chat-completions': { baseUrl: 'https://other.example/v1', headers: { 'X-Team': 'a' } },
      'anthropic-messages': { baseUrl: 'https://other.example' }
    }
    expect(withoutNovaAddressOverrides('nova', edited)).toEqual({
      'openai-chat-completions': { headers: { 'X-Team': 'a' } },
      'anthropic-messages': {}
    })
    expect(withoutNovaAddressOverrides('openrouter', edited)).toBe(edited)
    expect(withoutNovaAddressOverrides('nova', null)).toBeNull()
  })
})
