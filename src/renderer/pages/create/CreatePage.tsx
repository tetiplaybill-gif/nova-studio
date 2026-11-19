import { type FC, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { SegmentedControl } from '@cherrystudio/ui'

const PaintingPage = lazy(() => import('../paintings/PaintingPage'))
const VideoPage = lazy(() => import('../video/VideoPage'))
const AudioPage = lazy(() => import('../audio/AudioPage'))
const AnalyzePage = lazy(() => import('../analyze/AnalyzePage'))

export const CREATE_TABS = ['image', 'video', 'speech', 'analyze'] as const
export type CreateTab = (typeof CREATE_TABS)[number]

interface Props {
  tab: CreateTab
  prompt?: string
  onTabChange: (tab: CreateTab) => void
}

/** One place for everything NOVA makes besides chat: image, video, speech and analysis. */
const CreatePage: FC<Props> = ({ tab, prompt, onTabChange }) => {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-border-subtle border-b px-4 py-2.5">
        <h1 className="m-0 font-[family-name:var(--font-family-display)] font-semibold text-[15px]">{t('nova_ui.nav.create')}</h1>
        <SegmentedControl
          size="sm"
          options={CREATE_TABS.map((value) => ({ value, label: t(`nova_ui.create.${value}`) }))}
          value={tab}
          onValueChange={onTabChange}
        />
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          {tab === 'image' && <PaintingPage />}
          {tab === 'video' && <VideoPage initialPrompt={prompt} />}
          {tab === 'speech' && <AudioPage />}
          {tab === 'analyze' && <AnalyzePage />}
        </Suspense>
      </div>
    </div>
  )
}

export default CreatePage
