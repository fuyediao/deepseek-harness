/**
 * Desktop window chrome: the native File/Edit/View/Window bar stays hidden.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  applyDesktopWindowTitle,
  DESKTOP_PRODUCT_NAME,
  DESKTOP_WINDOW_CHROME,
  desktopWindowTitle,
  hideDesktopMenuBar,
} from '../src/window-chrome.ts'

describe('desktop window chrome', () => {
  it('constructs the window with a hidden native menu bar', () => {
    expect(DESKTOP_WINDOW_CHROME).toEqual({
      width: 1280,
      height: 840,
      autoHideMenuBar: true,
    })
  })

  it('removes the native menu bar so Alt does not reveal it', () => {
    const window = {
      setMenu: vi.fn(),
      setMenuBarVisibility: vi.fn(),
    }
    hideDesktopMenuBar(window)
    expect(window.setMenu).toHaveBeenCalledWith(null)
    expect(window.setMenuBarVisibility).toHaveBeenCalledWith(false)
  })

  it('rewrites the official frontend product suffix to GeoCRM Harness', () => {
    expect(desktopWindowTitle('')).toBe(DESKTOP_PRODUCT_NAME)
    expect(desktopWindowTitle('DeepSeek Harness')).toBe(DESKTOP_PRODUCT_NAME)
    expect(desktopWindowTitle('First title — DeepSeek Harness')).toBe('First title — GeoCRM Harness')
  })

  it('keeps later renderer titles rewritten after the window exists', () => {
    const window = {
      setTitle: vi.fn(),
      on: vi.fn(),
    }
    applyDesktopWindowTitle(window)
    expect(window.setTitle).toHaveBeenCalledWith(DESKTOP_PRODUCT_NAME)
    expect(window.on).toHaveBeenCalledWith('page-title-updated', expect.any(Function))
    const listener = window.on.mock.calls[0]![1] as (
      event: { preventDefault(): void },
      title: string,
    ) => void
    const event = { preventDefault: vi.fn() }
    listener(event, 'Revised title — DeepSeek Harness')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(window.setTitle).toHaveBeenLastCalledWith('Revised title — GeoCRM Harness')
  })
})
