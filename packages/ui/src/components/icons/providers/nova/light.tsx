import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const NovaLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="#FF6A2B" d="M0 0H120V120H0z" />
    <path
      fill="#1A0A02"
      d="M60 22c3.2 21.5 16.5 34.8 38 38-21.5 3.2-34.8 16.5-38 38-3.2-21.5-16.5-34.8-38-38 21.5-3.2 34.8-16.5 38-38z"
    />
  </svg>
)
export { NovaLight }
export default NovaLight
