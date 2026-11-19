import { createFileRoute } from '@tanstack/react-router'

import VideoPage from '@renderer/pages/video/VideoPage'

export const Route = createFileRoute('/app/video')({
  component: VideoPage
})
