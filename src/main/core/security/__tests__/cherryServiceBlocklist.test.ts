import { describe, expect, it, vi } from 'vitest'

import {
  blockCherryServices,
  CHERRY_SERVICE_URL_PATTERNS,
  CherryServiceBlockedError,
  installCherryServiceBlock,
  isCherryServiceUrl
} from '../cherryServiceBlocklist'

describe('Cherry Studio service blocklist', () => {
  it.each([
    'https://api.cherry-ai.com/api/announcements',
    'https://analytics.cherry-ai.com/api/events',
    'https://cloud.cherryai.com/api/v1/public/plans',
    'https://cloud.cherryai.com.cn/authorize',
    'https://open.cherryin.ai/console/topup',
    'https://skills.cherryin.ai/api/skills/x',
    'http://express-ent-admin.cherryin.net/v1',
    'https://cherrystudio.com/page',
    'https://CHERRY-AI.COM./status'
  ])('blocks %s', (url) => {
    expect(isCherryServiceUrl(url)).toBe(true)
  })

  it.each([
    'https://cdkai.cc/api/platform/keys',
    'https://api.cdkai.cc/v1/chat/completions',
    'https://github.com/CherryHQ/cherry-studio',
    'https://notcherry-ai.com/',
    'https://cherry-ai.com.evil.example/',
    'not a url'
  ])('allows %s', (url) => {
    expect(isCherryServiceUrl(url)).toBe(false)
  })

  it('refuses blocked requests without sending them and passes others through', async () => {
    const send = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('ok'))
    const guarded = blockCherryServices(send)

    await expect(guarded('https://api.cherry-ai.com/diagnostics/')).rejects.toBeInstanceOf(CherryServiceBlockedError)
    await expect(guarded(new URL('https://cloud.cherryai.com/x'))).rejects.toBeInstanceOf(CherryServiceBlockedError)
    await expect(guarded(new Request('https://open.cherryin.ai/'))).rejects.toBeInstanceOf(CherryServiceBlockedError)
    expect(send).not.toHaveBeenCalled()

    await expect(guarded('https://cdkai.cc/')).resolves.toBeInstanceOf(Response)
    expect(send).toHaveBeenCalledOnce()
  })

  it('installs the guard on net.fetch', async () => {
    const net = { fetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('ok')) }
    installCherryServiceBlock(net)
    await expect(net.fetch('https://cherryai.com/download')).rejects.toBeInstanceOf(CherryServiceBlockedError)
    await expect(net.fetch('https://cdkai.cc/')).resolves.toBeInstanceOf(Response)
  })

  it('gives webRequest a pattern for every domain and its subdomains', () => {
    expect(CHERRY_SERVICE_URL_PATTERNS).toContain('*://cherry-ai.com/*')
    expect(CHERRY_SERVICE_URL_PATTERNS).toContain('*://*.cherryin.ai/*')
  })

  it('also guards a global fetch, as main.ts installs it on globalThis', async () => {
    const scope = { fetch: vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('ok')) }
    installCherryServiceBlock(scope)
    await expect(scope.fetch('https://analytics.cherry-ai.com/api/events')).rejects.toBeInstanceOf(
      CherryServiceBlockedError
    )
    await expect(scope.fetch('https://api.cdkai.cc/v1/models')).resolves.toBeInstanceOf(Response)
  })
})
