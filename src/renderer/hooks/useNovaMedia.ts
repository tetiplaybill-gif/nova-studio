import type { TFunction } from 'i18next'
import { useCallback, useEffect, useState } from 'react'

import { useProviderById } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { NOVA_KEY_LABEL, NOVA_PROVIDER_ID } from '@shared/data/presets/nova'
import type { NovaAccountSummary } from '@shared/ipc/schemas/nova'
import type { NovaMediaError, NovaMediaModel, NovaMediaModelType } from '@shared/ipc/schemas/novaMedia'

let cached: NovaMediaModel[] | null = null

const byType = (type: NovaMediaModelType) => (m: NovaMediaModel) => m.type === type
/** Models serving one NOVA endpoint, whatever their main type (decision models also extract). */
export const byEndpoint = (endpoint: string) => (m: NovaMediaModel) => m.endpoints.includes(endpoint)

/** NOVA's model catalog for the media pages, filtered to one type. Shared across pages for the session. */
export function useNovaCatalog(filter: NovaMediaModelType | ((model: NovaMediaModel) => boolean)) {
  const [select] = useState(() => (typeof filter === 'function' ? filter : byType(filter)))
  const [models, setModels] = useState<NovaMediaModel[]>(() => cached?.filter(select) ?? [])
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState<NovaMediaError | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true)
      const result = await ipcApi.request('nova.media.catalog', { refresh })
      if (result.ok) {
        cached = result.data
        setModels(result.data.filter(select))
        setError(null)
      } else {
        setError(result)
      }
      setLoading(false)
    },
    [select]
  )

  useEffect(() => {
    void load()
  }, [load])

  return { models, loading, error, refresh: () => load(true) }
}

/**
 * The signed-in NOVA account (`null` when signed out, `undefined` while loading). Reloads when this
 * computer's NOVA key changes, so signing in or out updates screens that are already open.
 */
export function useNovaSummary() {
  const { provider } = useProviderById(NOVA_PROVIDER_ID)
  const keyIds = (provider?.apiKeys ?? [])
    .filter((key) => key.label === NOVA_KEY_LABEL)
    .map((key) => key.id)
    .join(',')
  const [summary, setSummary] = useState<NovaAccountSummary | null | undefined>(undefined)
  const refresh = useCallback(async () => {
    setSummary(await ipcApi.request('nova.summary').catch(() => null))
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh, keyIds])
  return { summary, refresh }
}

/** The NOVA balance in USD, refreshed on demand (after each paid job). */
export function useNovaBalance() {
  const { summary, refresh } = useNovaSummary()
  const balance = summary?.keyActive ? summary.balanceUsd : null
  return { balance, loaded: summary !== undefined, refresh }
}

/** One sentence explaining a failed NOVA media request. */
export function novaErrorText(t: TFunction, error: NovaMediaError): string {
  const reason = t(`nova_media.error.${error.error}`)
  return error.message ? `${reason} ${error.message}` : reason
}

export function formatUsd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`
}
