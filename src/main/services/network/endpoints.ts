import { RELEASE_HISTORY_URL } from '@main/services/AppUpdaterService'
import { resolveRegistryBaseUrl } from '@main/services/ProviderRegistryUpdaterService'

import type { NetworkEndpoint } from './types'

/**
 * Built-in URLs probed by System Doctor. NOVA Studio talks to cdkai.cc rather than Cherry Studio's
 * services, so the `cloud` slot checks the NOVA API and `diagnostics` checks the NOVA website.
 */
export async function builtinEndpoints(): Promise<readonly NetworkEndpoint[]> {
  return [
    { id: 'update', url: RELEASE_HISTORY_URL },
    { id: 'registry', url: `${await resolveRegistryBaseUrl()}/manifest.json` },
    { id: 'cloud', url: 'https://api.cdkai.cc/v1/models' },
    { id: 'diagnostics', url: 'https://cdkai.cc/' }
  ]
}
