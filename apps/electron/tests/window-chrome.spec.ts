/**
 * Desktop window chrome: the native File/Edit/View/Window bar stays hidden.
 */
import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_WINDOW_CHROME, hideDesktopMenuBar } from '../src/window-chrome.ts'

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
})
