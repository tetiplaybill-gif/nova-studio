import fs from 'node:fs/promises'
import os from 'node:os'

import { safeStorage } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import {
  NOVA_KEY_LABEL,
  NOVA_ORIGIN,
  type NovaAccountSummary,
  type NovaKeyResult,
  type NovaSignInResult,
  type NovaStatus
} from '@shared/ipc/schemas/nova'

const logger = loggerService.withContext('NovaAccountService')

export { NOVA_KEY_LABEL, NOVA_ORIGIN }

const SESSION_COOKIES = ['nova_session', 'XSRF-TOKEN'] as const
const MAX_BODY_BYTES = 1024 * 1024
const VERIFY_EVERY_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 20_000

type SessionCookie = (typeof SESSION_COOKIES)[number]

interface StoredAccount {
  cookies: Partial<Record<SessionCookie, string>>
  csrf: string
  email: string
  name: string
  keyId: string | null
}

export interface SecretBox {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

const electronSecretBox: SecretBox = {
  isAvailable: () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text',
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value)
}

class NovaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown> | null
  ) {
    super(`cdkai.cc answered HTTP ${status}`)
  }
}

class NovaOfflineError extends Error {}

/** A header value is safe only if it cannot smuggle a second header or cookie. */
function headerSafe(value: string): boolean {
  return value.length > 0 && value.length <= 4096 && !/[\r\n;\0]/.test(value)
}

function readUser(body: Record<string, unknown> | null): { email: string; name: string } | null {
  const user = body?.user as Record<string, unknown> | null | undefined
  if (!user || typeof user !== 'object') return null
  const id = user.id
  const email = user.email
  if (typeof id !== 'number' || id <= 0 || typeof email !== 'string' || !email.includes('@') || email.length > 254) {
    return null
  }
  const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim().slice(0, 80) : email
  return { email, name }
}

export interface NovaAccountDeps {
  fetch: typeof fetch
  storagePath: () => string
  secretBox: SecretBox
  hostname: () => string
  now: () => number
}

/**
 * The NOVA account behind NOVA Studio: signs in to cdkai.cc with the same session the website uses,
 * creates one API key for this computer, and reads the wallet balance.
 *
 * The session cookies never leave the main process. They are kept encrypted with the operating
 * system's keychain; where no keychain is available they are kept in memory only, so the user
 * signs in again after a restart rather than having cookies written to disk in plain text.
 */
export class NovaAccountService {
  private account: StoredAccount | null = null
  private loaded = false
  private verifiedAt = 0
  private readonly deps: NovaAccountDeps

  constructor(deps: Partial<NovaAccountDeps> = {}) {
    this.deps = {
      fetch: deps.fetch ?? ((...args) => globalThis.fetch(...args)),
      storagePath: deps.storagePath ?? (() => application.getPath('app.userdata', 'nova-account.bin')),
      secretBox: deps.secretBox ?? electronSecretBox,
      hostname: deps.hostname ?? (() => os.hostname()),
      now: deps.now ?? (() => Date.now())
    }
  }

  public async status(): Promise<NovaStatus> {
    const account = await this.load()
    if (!account) return { signedIn: false }
    if (this.deps.now() - this.verifiedAt > VERIFY_EVERY_MS) {
      try {
        const user = readUser(await this.request(account, 'GET', '/api/bootstrap'))
        if (!user || user.email !== account.email) {
          await this.forget()
          return { signedIn: false }
        }
        account.name = user.name
        this.verifiedAt = this.deps.now()
        await this.save()
      } catch (error) {
        if (error instanceof NovaHttpError && (error.status === 401 || error.status === 419)) {
          await this.forget()
          return { signedIn: false }
        }
        // Offline or the site is briefly down: keep the session and try again next time.
        logger.debug('Could not re-check the NOVA session', error as Error)
      }
    }
    return { signedIn: true, email: account.email, name: account.name }
  }

  public async signIn(email: string, password: string, otp: string): Promise<NovaSignInResult> {
    email = email.trim().toLowerCase()
    otp = otp.trim()
    if (!email.includes('@') || email.length > 254 || !password || password.length > 128 || otp.length > 6) {
      return { ok: false, error: 'invalid_input' }
    }
    const draft: StoredAccount = { cookies: {}, csrf: '', email, name: email, keyId: null }
    try {
      await this.request(draft, 'GET', '/api/bootstrap')
      if (!draft.csrf) return { ok: false, error: 'unavailable' }
      const claimed = readUser(await this.request(draft, 'POST', '/api/auth/login', { email, password, otp }))
      // A success status alone is not trusted: the rotated session must answer as the same user.
      const verified = readUser(await this.request(draft, 'GET', '/api/bootstrap'))
      if (!claimed || !verified || claimed.email !== verified.email || !draft.cookies.nova_session) {
        return { ok: false, error: 'unavailable' }
      }
      draft.email = verified.email
      draft.name = verified.name
    } catch (error) {
      return { ok: false, error: this.signInError(error) }
    }
    // Signing in again as the same person keeps track of this computer's key; another account starts fresh.
    const previous = await this.load()
    this.account = { ...draft, keyId: previous?.email === draft.email ? previous.keyId : null }
    this.verifiedAt = this.deps.now()
    await this.save()
    return { ok: true, email: draft.email, name: draft.name }
  }

  /** Creates this computer's API key. The full key is returned once, to be stored with the NOVA provider. */
  public async createKey(): Promise<NovaKeyResult> {
    const account = await this.load()
    if (!account) return { ok: false, error: 'signed_out' }
    const name = `${NOVA_KEY_LABEL} · ${this.deps.hostname().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'computer'}`
    try {
      const body = await this.request(account, 'POST', '/api/platform/keys', { name })
      const id = body?.id
      const key = body?.key
      if (typeof id !== 'string' || typeof key !== 'string' || !key.startsWith('sk-nova-')) {
        return { ok: false, error: 'unavailable' }
      }
      const replaced = account.keyId
      account.keyId = id
      await this.save()
      // The key this computer used before is no longer needed once the new one is stored.
      if (replaced && replaced !== id) await this.revokeKey(account, replaced)
      return { ok: true, key }
    } catch (error) {
      return { ok: false, error: this.keyError(error) }
    }
  }

  public async summary(): Promise<NovaAccountSummary | null> {
    const account = await this.load()
    if (!account) return null
    try {
      const body = await this.request(account, 'GET', '/api/platform/keys')
      const wallet = body?.wallet as Record<string, unknown> | undefined
      const group = body?.group as Record<string, unknown> | undefined
      const keys = Array.isArray(body?.keys) ? (body.keys as Array<Record<string, unknown>>) : []
      const available = typeof wallet?.available_micro === 'number' ? wallet.available_micro : 0
      return {
        email: account.email,
        name: account.name,
        balanceUsd: Math.floor(available / 10_000) / 100,
        group: typeof group?.name === 'string' ? group.name.slice(0, 40) : null,
        keyActive: account.keyId !== null && keys.some((k) => k.id === account.keyId)
      }
    } catch (error) {
      if (error instanceof NovaHttpError && (error.status === 401 || error.status === 419)) await this.forget()
      throw error
    }
  }

  /** Revokes this computer's key on cdkai.cc, ends the website session and forgets everything locally. */
  public async signOut(): Promise<void> {
    const account = await this.load()
    if (account) {
      if (account.keyId) await this.revokeKey(account, account.keyId)
      try {
        await this.request(account, 'POST', '/api/auth/logout', {})
      } catch (error) {
        logger.debug('NOVA logout request failed; the local session is cleared anyway', error as Error)
      }
    }
    await this.forget()
  }

  private async revokeKey(account: StoredAccount, keyId: string): Promise<void> {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(keyId)) return
    try {
      await this.request(account, 'DELETE', `/api/platform/keys/${keyId}`)
    } catch (error) {
      logger.warn('Could not revoke the previous NOVA Studio key', error as Error)
    }
  }

  private signInError(error: unknown): Exclude<NovaSignInResult, { ok: true }>['error'] {
    if (error instanceof NovaOfflineError) return 'offline'
    if (error instanceof NovaHttpError) {
      if (error.body?.requires_otp === true) return 'otp_required'
      if (error.status === 422 || error.status === 401 || error.status === 403) return 'wrong_credentials'
      if (error.status === 429) return 'too_many_attempts'
    }
    logger.warn('NOVA sign-in failed', error as Error)
    return 'unavailable'
  }

  private keyError(error: unknown): Exclude<NovaKeyResult, { ok: true }>['error'] {
    if (error instanceof NovaOfflineError) return 'offline'
    if (error instanceof NovaHttpError) {
      if (error.status === 401 || error.status === 419) return 'signed_out'
      if (error.status === 403) return 'email_unverified'
      if (error.status === 422) return 'key_limit'
      if (error.status === 429) return 'too_many_attempts'
    }
    logger.warn('Creating the NOVA Studio key failed', error as Error)
    return 'unavailable'
  }

  private async request(
    account: StoredAccount,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: NOVA_ORIGIN,
      Referer: `${NOVA_ORIGIN}/login`
    }
    const cookie = SESSION_COOKIES.flatMap((name) => {
      const value = account.cookies[name]
      return value && headerSafe(value) ? [`${name}=${value}`] : []
    }).join('; ')
    if (cookie) headers.Cookie = cookie
    if (account.csrf && headerSafe(account.csrf)) headers['X-CSRF-TOKEN'] = account.csrf
    if (body) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await this.deps.fetch(`${NOVA_ORIGIN}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      throw new NovaOfflineError((error as Error).message)
    }

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attributes] = raw.split(';')
      const at = pair.indexOf('=')
      if (at <= 0) continue
      const name = pair.slice(0, at).trim() as SessionCookie
      if (!SESSION_COOKIES.includes(name)) continue
      const value = pair.slice(at + 1).trim()
      const expired = attributes.some((a) => /^\s*max-age\s*=\s*(0|-)/i.test(a))
      if (!value || expired || value === 'deleted') delete account.cookies[name]
      else if (headerSafe(value)) account.cookies[name] = value
    }

    const text = await response.text()
    if (text.length > MAX_BODY_BYTES) throw new NovaHttpError(response.status, null)
    let data: Record<string, unknown> | null = null
    try {
      const parsed = text ? JSON.parse(text) : null
      data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      data = null
    }
    const csrf = data?.csrf_token
    if (typeof csrf === 'string' && headerSafe(csrf)) account.csrf = csrf
    if (response.status < 200 || response.status >= 300) throw new NovaHttpError(response.status, data)
    if (data === null && method === 'GET') throw new NovaHttpError(502, null)
    return data
  }

  private async load(): Promise<StoredAccount | null> {
    if (this.loaded) return this.account
    this.loaded = true
    if (!this.deps.secretBox.isAvailable()) return this.account
    try {
      const sealed = await fs.readFile(this.deps.storagePath())
      const stored = JSON.parse(this.deps.secretBox.decrypt(sealed)) as StoredAccount
      if (typeof stored?.email === 'string' && stored.cookies && typeof stored.csrf === 'string') {
        this.account = { ...stored, keyId: typeof stored.keyId === 'string' ? stored.keyId : null }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('Ignoring an unreadable NOVA session', error as Error)
    }
    return this.account
  }

  private async save(): Promise<void> {
    if (!this.account || !this.deps.secretBox.isAvailable()) return
    try {
      const sealed = this.deps.secretBox.encrypt(JSON.stringify(this.account))
      await fs.writeFile(this.deps.storagePath(), sealed, { mode: 0o600 })
    } catch (error) {
      logger.warn('Could not save the NOVA session; it will last until NOVA Studio quits', error as Error)
    }
  }

  private async forget(): Promise<void> {
    this.account = null
    this.loaded = true
    this.verifiedAt = 0
    await fs.rm(this.deps.storagePath(), { force: true }).catch(() => undefined)
  }
}

export const novaAccountService = new NovaAccountService()
