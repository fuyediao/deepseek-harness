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

/**
 * Render the GeoCRM mark at the sidebar's requested size.
 * @param props - Host-supplied mark presentation.
 * @returns a geometric mark (aria-hidden decorative brand art).
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
      <path
        d="M8 8.25h5.1c2.35 0 3.9 1.45 3.9 3.75s-1.55 3.75-3.9 3.75H8V8.25Zm2.05 1.8v3.9h3.05c1.2 0 1.85-.7 1.85-1.95s-.65-1.95-1.85-1.95H10.05Z"
        fill="var(--dsw-alias-label-primary-inverted)"
      />
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
