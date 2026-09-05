// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GeoCrmBrandMark, GeoCrmBrandName } from '../src/client/GeoCrmBrand.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

describe('GeoCrmBrand', () => {
  it('renders a decorative mark at the requested size', () => {
    const { container } = render(<GeoCrmBrandMark size={24} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('24')
    expect(svg?.getAttribute('height')).toBe('24')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders the localized product name', () => {
    const { container } = render(<GeoCrmBrandName t={key => en[key]} />)
    expect(container.textContent).toBe('GeoCRM')
  })
})
