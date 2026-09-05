// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GeoCrmBrandMark, GeoCrmBrandName, GeoCrmHeroMark, GeoCrmHeroWordmark } from '../src/client/GeoCrmBrand.tsx'
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
    expect(container.innerHTML).toContain('M 256 80')
    expect(container.innerHTML).not.toContain('M8 8.25h5.1')
  })

  it('renders the localized product name', () => {
    const { container } = render(<GeoCrmBrandName t={key => en[key]} />)
    expect(container.textContent).toBe('GeoCRM Harness')
  })

  it('renders the transparent hero mark without a tile', () => {
    const { container } = render(<GeoCrmHeroMark size={34} className="hero-fish" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('34')
    expect(svg?.getAttribute('height')).toBe('34')
    expect(svg?.getAttribute('class')).toBe('hero-fish')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(container.innerHTML).toContain('M 256 80')
    expect(container.innerHTML).toContain('#4FC08D')
    expect(container.innerHTML).toContain('#646CFF')
    expect(container.innerHTML).not.toContain('rx="6"')
    expect(container.innerHTML).not.toContain('M8 8.25h5.1')
  })

  it('renders the localized hero product name', () => {
    const { container } = render(<GeoCrmHeroWordmark className="headline" t={key => en[key]} />)
    expect(container.textContent).toBe('GeoCRM Harness')
    expect(container.querySelector('.headline')).toBeTruthy()
  })
})
