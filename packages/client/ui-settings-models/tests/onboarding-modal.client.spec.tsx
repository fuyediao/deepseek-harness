/** Shared onboarding modal chrome: inert ownership and optional title focus. */
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OnboardingModal } from '../src/client/OnboardingModal.tsx'

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

describe('OnboardingModal', () => {
  it('leaves the page interactive when #root is absent', () => {
    render(<OnboardingModal title="Notice">body</OnboardingModal>)
    expect(screen.getByRole('dialog', { name: 'Notice' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Notice' }).getAttribute('tabindex')).toBeNull()
  })

  it('holds #root inert only while the modal is mounted', () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const view = render(<OnboardingModal title="Notice">
      <input aria-label="API key" />
    </OnboardingModal>)
    const title = screen.getByRole('heading', { name: 'Notice' })
    expect(appRoot.inert).toBe(true)
    expect(title.getAttribute('tabindex')).toBeNull()
    expect(document.activeElement).not.toBe(title)
    view.unmount()
    expect(appRoot.inert).toBeFalsy()
  })
})
