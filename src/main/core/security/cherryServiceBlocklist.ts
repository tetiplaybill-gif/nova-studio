/**
 * NOVA Studio never contacts services run by the Cherry Studio team. The features that used them are
 * hidden or rewired, and this list is the backstop: main-process `net.fetch` calls and default-session
 * requests to these domains (and their subdomains) are refused before they leave the computer.
 */
const CHERRY_SERVICE_DOMAINS = [
  'cherry-ai.com',
  'cherryai.com',
  'cherryai.com.cn',
  'cherryin.ai',
  'cherryin.net',
  'cherryin.dev',
  'cherrystudio.com'
] as const

export function isCherryServiceUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return false
  }
  return CHERRY_SERVICE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/** webRequest URL patterns covering every blocked domain and subdomain, over http and https. */
export const CHERRY_SERVICE_URL_PATTERNS: string[] = CHERRY_SERVICE_DOMAINS.flatMap((domain) => [
  `*://${domain}/*`,
  `*://*.${domain}/*`
])

export class CherryServiceBlockedError extends Error {
  constructor(url: string) {
    super(`NOVA Studio does not connect to Cherry Studio services (${new URL(url).hostname})`)
    this.name = 'CherryServiceBlockedError'
  }
}

/** Any `fetch`-shaped function, such as global `fetch` or Electron's `net.fetch`. */
type FetchLike = (input: never, init?: never) => Promise<unknown>

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return (input as { url?: string } | null)?.url ?? ''
}

/** Wraps a `fetch`-shaped function so requests to Cherry Studio services fail without being sent. */
export function blockCherryServices<F extends FetchLike>(fetchImpl: F): F {
  const send = fetchImpl as unknown as (input: unknown, init?: unknown) => Promise<unknown>
  const guarded = (input: unknown, init?: unknown) => {
    const url = urlOf(input)
    if (isCherryServiceUrl(url)) return Promise.reject(new CherryServiceBlockedError(url))
    return send(input, init)
  }
  return guarded as unknown as F
}

/** Installs the guard on Electron's `net.fetch`, which the main process uses for its own HTTP calls. */
export function installCherryServiceBlock<N extends { fetch: FetchLike }>(netModule: N): void {
  try {
    netModule.fetch = blockCherryServices(netModule.fetch.bind(netModule) as N['fetch'])
  } catch {
    // A frozen module object: the default-session webRequest filter still applies.
  }
}
