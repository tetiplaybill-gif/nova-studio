import { createFileRoute, redirect } from '@tanstack/react-router'

import { DeviceConnectionsSettings } from '@renderer/pages/settings/DeviceConnectionsSettings'
import { cherryServices } from '@shared/data/presets/nova'

export const Route = createFileRoute('/settings/device-connections')({
  beforeLoad: () => {
    // The pairing app is Cherry Studio's own phone app, which NOVA Studio does not offer.
    if (!cherryServices.enabled) throw redirect({ to: '/settings/general' })
  },
  component: DeviceConnectionsSettings
})
