/**
 * Desktop sidebar and blank-session hero brand occupants. They shadow the
 * official DeepSeek mark and wordmark on the Electron renderer only.
 */

import { useId } from 'react'
import type { HeroBrandMarkOwnerProps, HeroWordmarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { en } from './locales.ts'
import css from './GeoCrmBrand.module.css'

/** Registration-side copy for {@link GeoCrmBrandName} and {@link GeoCrmHeroWordmark}. */
export interface GeoCrmBrandNameInjected {
  /** Section copy (same dictionary as the Models card). */
  t: (key: keyof typeof en) => string
}

/** Official GeoCRM pin fill from the product icon. */
const GEOCRM_PIN_FILL = '#4FC08D'

const GEOCRM_PIN_OUTER =
  'M 256 80 C 160 80 82 158 82 254 C 82 371 256 460 256 460 C 256 460 430 371 430 254 C 430 158 352 80 256 80 Z'
const GEOCRM_PIN_HOLE = 'M 348 236 A 92 92 0 1 1 164 236 A 92 92 0 1 1 348 236 Z'
const GEOCRM_SPARK_OUTER =
  'M 256 156 C 266 206 206 226 336 236 C 206 246 266 266 256 316 C 246 266 306 246 176 236 C 306 226 246 206 256 156 Z'
const GEOCRM_SPARK_HOLE = 'M 272 236 A 16 16 0 1 1 240 236 A 16 16 0 1 1 272 236 Z'

/**
 * Render the GeoCRM map-pin mark at the sidebar's requested size.
 * @param props - Host-supplied mark presentation.
 * @returns the transparent pin with no tile (aria-hidden decorative brand art).
 */
export function GeoCrmBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={css.mark}
      fill="none"
      aria-hidden="true"
    >
      <path
        fill={GEOCRM_PIN_FILL}
        fillRule="evenodd"
        d={`${GEOCRM_PIN_OUTER} ${GEOCRM_PIN_HOLE}`}
      />
      <path
        fill={GEOCRM_PIN_FILL}
        fillRule="evenodd"
        d={`${GEOCRM_SPARK_OUTER} ${GEOCRM_SPARK_HOLE}`}
      />
    </svg>
  )
}

/**
 * Render the transparent GeoCRM pin (no tile) at the hero's requested size.
 * @param props - Host-supplied mark presentation.
 * @returns the floating pin and spark (aria-hidden decorative brand art).
 */
export function GeoCrmHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  const uid = useId().replaceAll(':', '')
  const pinGrad = `geocrm-hero-pin-${uid}`
  const sparkGrad = `geocrm-hero-spark-${uid}`
  const pinHole = `geocrm-hero-hole-${uid}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={pinGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#4FC08D" />
          <stop offset="100%" stop-color="#3FCF8E" />
        </linearGradient>
        <linearGradient id={sparkGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#646CFF" />
          <stop offset="100%" stop-color="#61DAFB" />
        </linearGradient>
        <mask id={pinHole}>
          <path d={GEOCRM_PIN_OUTER} fill="#fff" />
          <circle cx="256" cy="236" r="92" fill="#000" />
        </mask>
      </defs>
      <path d={GEOCRM_PIN_OUTER} fill={`url(#${pinGrad})`} mask={`url(#${pinHole})`} />
      <path d={GEOCRM_SPARK_OUTER} fill={`url(#${sparkGrad})`} />
      <circle cx="256" cy="236" r="16" fill="#000" />
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

/**
 * Render the GeoCRM product name in the blank-session headline seat.
 * @param props - Host headline class plus localized product name.
 * @returns the hero product name.
 */
export function GeoCrmHeroWordmark({
  className,
  t,
}: HeroWordmarkOwnerProps & InjectFace<GeoCrmBrandNameInjected>) {
  return <span className={className}>{t('brandName')}</span>
}
