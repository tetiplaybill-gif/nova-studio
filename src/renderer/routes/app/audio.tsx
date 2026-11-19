import { createFileRoute } from '@tanstack/react-router'

import AudioPage from '@renderer/pages/audio/AudioPage'

export const Route = createFileRoute('/app/audio')({
  component: AudioPage
})
