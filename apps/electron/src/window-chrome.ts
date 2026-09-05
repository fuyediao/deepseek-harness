/**
 * Native window chrome for the single desktop window. The page owns product
 * chrome; Electron's default File/Edit/View/Window bar is not shown.
 * @module @deepseek-ai/dsh-electron-shell/window-chrome
 */

/** BrowserWindow size and menu-bar visibility used when constructing the window. */
export const DESKTOP_WINDOW_CHROME = {
  width: 1280,
  height: 840,
  autoHideMenuBar: true,
} as const

/** Native window and taskbar name for this desktop product. */
export const DESKTOP_PRODUCT_NAME = 'GeoCRM'

/** Product suffix the shared official frontend writes into `document.title`. */
export const UPSTREAM_WINDOW_TITLE = 'DeepSeek Harness'

/** Methods {@link applyDesktopWindowTitle} needs from a constructed BrowserWindow. */
export interface DesktopTitleHost {
  /** Replace the native window title. */
  setTitle(title: string): void
  /** Subscribe to renderer `document.title` updates. */
  on(
    event: 'page-title-updated',
    listener: (event: { preventDefault(): void }, title: string) => void,
  ): void
}

/**
 * Rewrite a renderer document title so the native window shows GeoCRM.
 * Session titles stay; only the shipped frontend product suffix changes.
 * @param title - `document.title` from the renderer.
 * @returns the native window title.
 */
export function desktopWindowTitle(title: string): string {
  const rewritten = title.replaceAll(UPSTREAM_WINDOW_TITLE, DESKTOP_PRODUCT_NAME)
  return rewritten.trim() === '' ? DESKTOP_PRODUCT_NAME : rewritten
}

/**
 * Pin the native window name to GeoCRM and keep later renderer titles rewritten.
 * @param window - the constructed BrowserWindow.
 */
export function applyDesktopWindowTitle(window: DesktopTitleHost): void {
  window.setTitle(DESKTOP_PRODUCT_NAME)
  window.on('page-title-updated', (event, title) => {
    event.preventDefault()
    window.setTitle(desktopWindowTitle(title))
  })
}

/** Methods {@link hideDesktopMenuBar} needs from a constructed BrowserWindow. */
export interface DesktopMenuBarHost {
  setMenu(menu: null): void
  setMenuBarVisibility(visible: boolean): void
}

/**
 * Remove the native menu bar after the window exists. `setMenu(null)` drops
 * the Windows/Linux File/Edit/View/Window bar so Alt does not reveal it.
 * @param window - the constructed BrowserWindow.
 */
export function hideDesktopMenuBar(window: DesktopMenuBarHost): void {
  window.setMenu(null)
  window.setMenuBarVisibility(false)
}
