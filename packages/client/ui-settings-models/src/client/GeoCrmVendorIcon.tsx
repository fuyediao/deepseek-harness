/**
 * Small vendor marks for the GeoCRM Models catalog, matching GeoCRM Electron
 * row layout (icon + combined label). Unknown slugs use a letter tile.
 */

import type { ReactNode } from 'react'
import { geocrmVendorPrefix } from './geocrm-keyed-models.ts'

/** Props of {@link GeoCrmVendorIcon}. */
export interface GeoCrmVendorIconProps {
  /** Composite picker id or vendor slug. */
  readonly modelId: string
  /** Mute and grayscale when the vendor has no key. */
  readonly muted?: boolean
}

/**
 * Render a 20px vendor mark.
 * @param props - picker id and muted state.
 * @returns the mark.
 */
export function GeoCrmVendorIcon(props: GeoCrmVendorIconProps): ReactNode {
  const vendor = geocrmVendorPrefix(props.modelId)
  return (
    <span
      aria-hidden
      style={props.muted === true ? { opacity: 0.45, filter: 'grayscale(1)' } : undefined}
    >
      {markOf(vendor)}
    </span>
  )
}

/**
 * Choose a mark for one vendor slug.
 * @param vendor - lowercase provider id.
 * @returns an inline SVG.
 */
function markOf(vendor: string): ReactNode {
  switch (vendor) {
    case 'chatgpt':
    case 'openai':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" fill="#10A37F" />
          <path
            d="M10.2 4.6c.9 0 1.7.3 2.3.9l.2.2.6-.3a2.6 2.6 0 0 1 3.5 1.7c.3 1-.1 2-.9 2.6l-.2.1.1.6a2.6 2.6 0 0 1-2 3.2l-.3.1-.2.6a2.6 2.6 0 0 1-3.5 1.7l-.6-.3-.2.2a2.6 2.6 0 0 1-3.7-1.1l-.1-.3-.6.1A2.6 2.6 0 0 1 3 13c-.3-1 .1-2 .9-2.6l.2-.1-.1-.6A2.6 2.6 0 0 1 6 6.5l.3-.1.2-.6A2.6 2.6 0 0 1 10.2 4.6Z"
            fill="#fff"
          />
        </svg>
      )
    case 'gemini':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" fill="#8E8E93" />
          <path d="M10 3.6c1.8 2.4 2.8 4.4 2.8 6.4S11.8 14 10 16.4C8.2 14 7.2 12 7.2 10S8.2 6 10 3.6Z" fill="#fff" />
          <path d="M3.6 10c2.4-1.8 4.4-2.8 6.4-2.8S14 8.2 16.4 10C14 11.8 12 12.8 10 12.8S6 11.8 3.6 10Z" fill="#fff" />
        </svg>
      )
    case 'claude':
    case 'anthropic':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" fill="#D97757" />
          <path d="M7.2 14.4 10 5.6l2.8 8.8h-1.6l-.4-1.3H9.2l-.4 1.3H7.2Zm2.4-3.3h1.8L10 7.6l-.4 3.5Z" fill="#fff" />
        </svg>
      )
    case 'grok':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" fill="#111" />
          <path d="M6.2 6.2h2.1l2 2.6 2-2.6h2.1L11.6 10l2.8 3.8h-2.1l-2-2.7-2 2.7H6.2L9 10 6.2 6.2Z" fill="#fff" />
        </svg>
      )
    case 'deepseek':
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" fill="#4D6BFE" />
          <path d="M6 10.2a4 4 0 0 1 4-4h1.2a2.8 2.8 0 1 1 0 5.6H10a1.6 1.6 0 0 0 0 3.2h4.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" fill="#6B7280" />
          <text x="10" y="14" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="600">
            {(vendor.charAt(0) || '?').toUpperCase()}
          </text>
        </svg>
      )
  }
}
