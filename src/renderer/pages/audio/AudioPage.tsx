import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SegmentedControl } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { NovaVoiceSettings } from '@shared/ipc/schemas/novaMedia'

import SpeechPanel from './components/SpeechPanel'
import TranscribePanel from './components/TranscribePanel'

type Tab = 'speech' | 'transcribe'

/** NOVA speech: text to speech with every NOVA voice model, and transcription of files or recordings. */
const AudioPage: FC = () => {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('speech')
  const [settings, setSettings] = useState<NovaVoiceSettings | null>(null)

  useEffect(() => {
    void ipcApi.request('nova.voice.settings').then(setSettings)
  }, [])
  const updateSettings = async (changes: Partial<NovaVoiceSettings>) =>
    setSettings(await ipcApi.request('nova.voice.update_settings', changes))

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center border-border-subtle border-b px-4 py-2.5">
        <SegmentedControl
          size="sm"
          options={[
            { value: 'speech', label: t('nova_media.audio.tab.speech') },
            { value: 'transcribe', label: t('nova_media.audio.tab.transcribe') }
          ]}
          value={tab}
          onValueChange={setTab}
        />
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'speech' ? (
          <SpeechPanel settings={settings} onSettings={(changes) => void updateSettings(changes)} />
        ) : (
          <TranscribePanel settings={settings} onSettings={(changes) => void updateSettings(changes)} />
        )}
      </div>
    </div>
  )
}

export default AudioPage
