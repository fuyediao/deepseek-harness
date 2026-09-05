/**
 * Desktop sidebar brand occupants. They shadow the official DeepSeek mark
 * and wordmark on the Electron renderer only.
 */

import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { en } from './locales.ts'
import css from './GeoCrmBrand.module.css'

/** Registration-side copy for {@link GeoCrmBrandName}. */
export interface GeoCrmBrandNameInjected {
  /** Section copy (same dictionary as the Models card). */
  t: (key: keyof typeof en) => string
}

/** Official GeoCRM pin fill from the product icon. */
const GEOCRM_PIN_FILL = '#4FC08D'

/**
 * Render the GeoCRM map-pin mark at the sidebar's requested size.
 * @param props - Host-supplied mark presentation.
 * @returns the GeoCRM pin on a theme-aware tile (aria-hidden decorative brand art).
 */
export function GeoCrmBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={css.mark}
      fill="none"
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="currentColor" />
      <svg x="3.25" y="3.25" width="17.5" height="17.5" viewBox="0 0 512 512" fill="none">
        <path
          fill={GEOCRM_PIN_FILL}
          fillRule="evenodd"
          d="M 256 80 C 160 80 82 158 82 254 C 82 371 256 460 256 460 C 256 460 430 371 430 254 C 430 158 352 80 256 80 Z M 348 236 A 92 92 0 1 1 164 236 A 92 92 0 1 1 348 236 Z"
        />
        <path
          fill={GEOCRM_PIN_FILL}
          fillRule="evenodd"
          d="M 256 156 C 266 206 206 226 336 236 C 206 246 266 266 256 316 C 246 266 306 246 176 236 C 306 226 246 206 256 156 Z M 272 236 A 16 16 0 1 1 240 236 A 16 16 0 1 1 272 236 Z"
        />
      </svg>
    </svg>
  )
}

/**
 * Render the GeoCRM product name beside the expanded mark.
 * @param props - localized product name.
 * @returns the sidebar brand name.
 */
export function GeoCrmBrandName({ t }: InjectFace<GeoCrmBrandNameInjected>) {
  return <span className={css.name}>{t('brandName')}</span>
}
