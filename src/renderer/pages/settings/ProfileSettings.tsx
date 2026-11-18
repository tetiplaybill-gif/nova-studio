import { AccountSignOutButton } from '@renderer/components/AccountSignOutButton'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { UserProfileEditor } from '@renderer/components/UserProfileEditor'
import { cherryServices } from '@shared/data/presets/nova'

import NovaAccount from './ProviderSettings/ProviderSpecific/NovaAccount'
import { SubscriptionSettings } from './SubscriptionSettings'

export function ProfileSettings() {
  return (
    <SettingsContentColumn>
      <div className="space-y-6">
        <div id="setting-profile-profile">
          <UserProfileEditor />
        </div>
        {cherryServices.enabled ? (
          <>
            <SubscriptionSettings />
            <AccountSignOutButton />
          </>
        ) : (
          // NOVA Studio has no Cherry account: the profile shows the NOVA account, balance and top-up.
          <NovaAccount providerId="nova" />
        )}
      </div>
    </SettingsContentColumn>
  )
}
