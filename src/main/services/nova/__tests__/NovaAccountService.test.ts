import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))

import { NOVA_ORIGIN, NovaAccountService, type SecretBox } from '../NovaAccountService'

type Reply = { status?: number; body?: unknown; cookies?: string[] }
type Seen = { method: string; path: string; headers: Record<string, string>; body: unknown }

const user = { id: 7, email: 'buyer@example.com', name: 'Buyer' }
const KEY_ID = '01JX0000000000000000000001'
const NEW_KEY_ID = '01JX0000000000000000000002'

/** A stand-in for cdkai.cc: answers each path from a queue and records what the client sent. */
function fakeSite(routes: Record<string, Reply[]>) {
  const seen: Seen[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const { pathname } = new URL(url)
    const method = init.method ?? 'GET'
    seen.push({
      method,
      path: pathname,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined
    })
    if (!url.startsWith(`${NOVA_ORIGIN}/`)) throw new Error(`unexpected host ${url}`)
    const queue = routes[`${method} ${pathname}`]
    if (!queue?.length) throw new Error(`unexpected request ${method} ${pathname}`)
    const reply = queue.length > 1 ? queue.shift()! : queue[0]
    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const cookie of reply.cookies ?? []) headers.append('Set-Cookie', cookie)
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers
    })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen }
}

const reversibleBox: SecretBox = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`),
  decrypt: (value) => Buffer.from(value.toString().replace(/^sealed:/, ''), 'base64').toString()
}

const signInRoutes = (): Record<string, Reply[]> => ({
  'GET /api/bootstrap': [
    {
      body: { user: null, csrf_token: 'csrf-1' },
      cookies: ['XSRF-TOKEN=x1; path=/', 'nova_session=guest; path=/; httponly']
    },
    { body: { user, csrf_token: 'csrf-2' } }
  ],
  'POST /api/auth/login': [
    { body: { user }, cookies: ['nova_session=signed-in; path=/; httponly', 'XSRF-TOKEN=x2; path=/'] }
  ]
})

let dir: string
let storagePath: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-account-'))
  storagePath = path.join(dir, 'nova-account.bin')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const service = (fetch: typeof globalThis.fetch, secretBox: SecretBox = reversibleBox, now = () => 1_000) =>
  new NovaAccountService({ fetch, secretBox, storagePath: () => storagePath, hostname: () => 'Wang’s Mac\r\nX', now })

describe('NovaAccountService', () => {
  it('signs in with the CSRF token, keeps the rotated session cookie and verifies it before trusting it', async () => {
    const site = fakeSite(signInRoutes())
    const result = await service(site.fetch).signIn(' Buyer@Example.com ', 'secret', '')

    expect(result).toEqual({ ok: true, email: 'buyer@example.com', name: 'Buyer' })
    const login = site.seen[1]
    expect(login).toMatchObject({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'buyer@example.com', password: 'secret', otp: '' }
    })
    expect(login.headers['X-CSRF-TOKEN']).toBe('csrf-1')
    expect(login.headers.Cookie).toBe('nova_session=guest; XSRF-TOKEN=x1')
    expect(site.seen[2].headers.Cookie).toBe('nova_session=signed-in; XSRF-TOKEN=x2')

    const saved = await fs.readFile(storagePath)
    expect(saved.toString()).not.toContain('signed-in')
    expect(JSON.parse(reversibleBox.decrypt(saved)).cookies.nova_session).toBe('signed-in')
  })

  it('asks for the authenticator code and reports wrong passwords without keeping a session', async () => {
    const otp = fakeSite({
      ...signInRoutes(),
      'POST /api/auth/login': [{ status: 422, body: { message: 'code', requires_otp: true } }]
    })
    expect(await service(otp.fetch).signIn('buyer@example.com', 'secret', '')).toEqual({
      ok: false,
      error: 'otp_required'
    })

    const wrong = fakeSite({ ...signInRoutes(), 'POST /api/auth/login': [{ status: 422, body: { errors: {} } }] })
    const nova = service(wrong.fetch)
    expect(await nova.signIn('buyer@example.com', 'nope', '')).toEqual({ ok: false, error: 'wrong_credentials' })
    expect(await nova.status()).toEqual({ signedIn: false })
    await expect(fs.access(storagePath)).rejects.toThrow()
  })

  it('rejects a success answer whose session does not belong to the same user', async () => {
    const site = fakeSite({
      ...signInRoutes(),
      'GET /api/bootstrap': [
        { body: { user: null, csrf_token: 'csrf-1' } },
        { body: { user: { id: 8, email: 'other@example.com' }, csrf_token: 'csrf-2' } }
      ],
      'POST /api/auth/login': [{ body: { user }, cookies: ['nova_session=s; path=/'] }]
    })
    expect(await service(site.fetch).signIn('buyer@example.com', 'secret', '')).toEqual({
      ok: false,
      error: 'unavailable'
    })
  })

  it('reports a network failure as offline', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof globalThis.fetch
    expect(await service(fetch).signIn('buyer@example.com', 'secret', '')).toEqual({ ok: false, error: 'offline' })
  })

  it('creates one key named for this computer and replaces the previous one', async () => {
    const site = fakeSite({
      ...signInRoutes(),
      'POST /api/platform/keys': [
        { body: { id: KEY_ID, key: 'sk-nova-first' } },
        { body: { id: NEW_KEY_ID, key: 'sk-nova-second' } }
      ],
      [`DELETE /api/platform/keys/${KEY_ID}`]: [{ body: { status: 'revoked' } }]
    })
    const nova = service(site.fetch)
    await nova.signIn('buyer@example.com', 'secret', '')

    expect(await nova.createKey()).toEqual({ ok: true, key: 'sk-nova-first' })
    expect(site.seen.at(-1)?.body).toEqual({ name: 'NOVA Studio · Wangs MacX' })
    expect(await nova.createKey()).toEqual({ ok: true, key: 'sk-nova-second' })
    expect(site.seen.at(-1)).toMatchObject({ method: 'DELETE', path: `/api/platform/keys/${KEY_ID}` })
  })

  it('explains why a key could not be created', async () => {
    for (const [status, error] of [
      [403, 'email_unverified'],
      [422, 'key_limit'],
      [419, 'signed_out']
    ] as const) {
      const site = fakeSite({ ...signInRoutes(), 'POST /api/platform/keys': [{ status, body: { message: 'x' } }] })
      const nova = service(site.fetch)
      await nova.signIn('buyer@example.com', 'secret', '')
      expect(await nova.createKey()).toEqual({ ok: false, error })
    }
    const noKeychain: SecretBox = { ...reversibleBox, isAvailable: () => false }
    expect(await service(fakeSite({}).fetch, noKeychain).createKey()).toEqual({ ok: false, error: 'signed_out' })
  })

  it('reads the available balance in dollars and whether this computer’s key is still active', async () => {
    const site = fakeSite({
      ...signInRoutes(),
      'POST /api/platform/keys': [{ body: { id: KEY_ID, key: 'sk-nova-first' } }],
      'GET /api/platform/keys': [
        {
          body: {
            wallet: { balance_micro: 12_349_999, held_micro: 1_000_000, available_micro: 11_349_999 },
            group: { name: 'Retail' },
            keys: [{ id: KEY_ID }]
          }
        },
        { body: { wallet: { available_micro: 0 }, group: null, keys: [] } }
      ]
    })
    const nova = service(site.fetch)
    await nova.signIn('buyer@example.com', 'secret', '')
    await nova.createKey()

    expect(await nova.summary()).toEqual({
      email: 'buyer@example.com',
      name: 'Buyer',
      balanceUsd: 11.34,
      group: 'Retail',
      keyActive: true
    })
    expect((await nova.summary())?.keyActive).toBe(false)
  })

  it('restores the saved session after a restart and drops it once the website no longer accepts it', async () => {
    const first = fakeSite(signInRoutes())
    await service(first.fetch).signIn('buyer@example.com', 'secret', '')

    const later = fakeSite({ 'GET /api/bootstrap': [{ body: { user, csrf_token: 'c' } }] })
    expect(await service(later.fetch, reversibleBox, () => 10_000_000).status()).toEqual({
      signedIn: true,
      email: 'buyer@example.com',
      name: 'Buyer'
    })
    expect(later.seen[0].headers.Cookie).toContain('nova_session=signed-in')

    const expired = fakeSite({ 'GET /api/bootstrap': [{ body: { user: null, csrf_token: 'c' } }] })
    expect(await service(expired.fetch, reversibleBox, () => 10_000_000).status()).toEqual({ signedIn: false })
    await expect(fs.access(storagePath)).rejects.toThrow()
  })

  it('stays signed in while offline', async () => {
    await service(fakeSite(signInRoutes()).fetch).signIn('buyer@example.com', 'secret', '')
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof globalThis.fetch
    expect((await service(offline, reversibleBox, () => 10_000_000).status()).signedIn).toBe(true)
  })

  it('signs out by revoking this computer’s key, ending the website session and deleting the saved session', async () => {
    const site = fakeSite({
      ...signInRoutes(),
      'POST /api/platform/keys': [{ body: { id: KEY_ID, key: 'sk-nova-first' } }],
      [`DELETE /api/platform/keys/${KEY_ID}`]: [{ body: { status: 'revoked' } }],
      'POST /api/auth/logout': [{ body: { ok: true } }]
    })
    const nova = service(site.fetch)
    await nova.signIn('buyer@example.com', 'secret', '')
    await nova.createKey()
    await nova.signOut()

    expect(site.seen.slice(-2).map((r) => `${r.method} ${r.path}`)).toEqual([
      `DELETE /api/platform/keys/${KEY_ID}`,
      'POST /api/auth/logout'
    ])
    expect(await nova.status()).toEqual({ signedIn: false })
    await expect(fs.access(storagePath)).rejects.toThrow()
  })

  it('never writes the session to disk when the system keychain is unavailable', async () => {
    const noKeychain: SecretBox = { ...reversibleBox, isAvailable: () => false }
    const nova = service(fakeSite(signInRoutes()).fetch, noKeychain)
    expect((await nova.signIn('buyer@example.com', 'secret', '')).ok).toBe(true)
    expect((await nova.status()).signedIn).toBe(true)
    await expect(fs.access(storagePath)).rejects.toThrow()
  })

  it('refuses a CSRF token that could inject headers', async () => {
    const site = fakeSite({
      'GET /api/bootstrap': [{ body: { user: null, csrf_token: 'bad\r\nX-Evil: 1' } }]
    })
    expect(await service(site.fetch).signIn('buyer@example.com', 'secret', '')).toEqual({
      ok: false,
      error: 'unavailable'
    })
    expect(site.seen).toHaveLength(1)
  })
})
