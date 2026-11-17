/**
 * NOVA Studio shows one provider: NOVA. Every other preset stays in the bundled registry (so the
 * upstream catalog and its tests are unchanged) but is treated as unavailable by ProviderService.
 *
 * `enabled` exists so the upstream provider tests, which exercise other presets, can turn the rule off.
 */
export const novaOnlyProviders = { enabled: true }

export const NOVA_PROVIDER_ID = 'nova'

export function isHiddenInNovaStudio(providerId: string | null | undefined, presetProviderId?: string | null): boolean {
  return novaOnlyProviders.enabled && providerId !== NOVA_PROVIDER_ID && presetProviderId !== NOVA_PROVIDER_ID
}
