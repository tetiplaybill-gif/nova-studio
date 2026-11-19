import Color from 'color'

import { usePreference } from '@data/hooks/usePreference'
import { getForegroundColor } from '@renderer/utils/style'

/** Cherry Studio's default accent; installs that never picked a color get NOVA's instead. */
const LEGACY_DEFAULT_PRIMARY = '#00b96b'
const NOVA_PRIMARY = '#ff6a2b'

export default function useUserTheme() {
  const [storedPrimary, setColorPrimary] = usePreference('ui.theme_user.color_primary')
  const colorPrimary = storedPrimary?.toLowerCase() === LEGACY_DEFAULT_PRIMARY ? NOVA_PRIMARY : storedPrimary
  const [userFontFamily, setUserFontFamily] = usePreference('ui.theme_user.font_family')
  const [userCodeFontFamily, setUserCodeFontFamily] = usePreference('ui.theme_user.code_font_family')

  const setOptionalCssVar = (name: string, value?: string) => {
    if (value?.trim()) {
      document.documentElement.style.setProperty(name, `'${value}'`)
      return
    }

    document.documentElement.style.removeProperty(name)
  }

  const initUserTheme = (theme: { colorPrimary: string } = { colorPrimary }) => {
    const colorPrimary = Color(theme.colorPrimary)

    document.documentElement.style.setProperty('--cs-theme-primary', colorPrimary.toString())
    document.documentElement.style.setProperty('--cs-theme-primary-foreground', getForegroundColor(colorPrimary.hex()))
    setOptionalCssVar('--app-user-font-family', userFontFamily)
    setOptionalCssVar('--app-user-code-font-family', userCodeFontFamily)
  }

  return {
    colorPrimary: Color(colorPrimary),

    initUserTheme,

    userTheme: { colorPrimary, userFontFamily, userCodeFontFamily },

    setUserTheme(userTheme: { colorPrimary: string; userFontFamily: string; userCodeFontFamily: string }) {
      void setColorPrimary(userTheme.colorPrimary)
      void setUserFontFamily(userTheme.userFontFamily)
      void setUserCodeFontFamily(userTheme.userCodeFontFamily)
      initUserTheme(userTheme)
    }
  }
}
