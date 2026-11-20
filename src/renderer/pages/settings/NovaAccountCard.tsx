import { useNavigate } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { formatUsd, useNovaSummary } from '@renderer/hooks/useNovaMedia'
import { NOVA_PROVIDER_ID } from '@shared/data/presets/nova'

/** The NOVA account at the top of Settings: who is signed in and what is left to spend. */
const NovaAccountCard: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { summary } = useNovaSummary()

  if (summary === undefined) return <div className="mx-2.5 mb-2 h-[58px]" />

  const name = summary?.name || summary?.email || t('nova_ui.settings.signed_out')
  const initial = (summary?.name || summary?.email || 'N').trim().charAt(0).toUpperCase()

  return (
    <button
      type="button"
      onClick={() => void navigate({ to: '/settings/provider', search: { id: NOVA_PROVIDER_ID } })}
      className="mx-2.5 mb-2 flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-none">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-[13px] text-primary-foreground">
        {initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold text-[13px]">{name}</span>
        <span className="truncate text-muted-foreground text-xs">
          {summary?.keyActive
            ? t('nova_ui.settings.balance', { amount: formatUsd(summary.balanceUsd) })
            : t('nova_ui.settings.connect')}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

export default NovaAccountCard
