/**
 * Native window chrome for the single desktop window. The page owns product
 * chrome; Electron's default File/Edit/View/Window bar is not shown.
 * @module @deepseek-ai/dsh-electron-shell/window-chrome
 */

import { fileURLToPath } from 'node:url'

/** BrowserWindow size and menu-bar visibility used when constructing the window. */
export const DESKTOP_WINDOW_CHROME = {
  width: 1280,
  height: 840,
  autoHideMenuBar: true,
} as const

/** Native window and taskbar name for this desktop product. */
export const DESKTOP_PRODUCT_NAME = 'GeoCRM Harness'

/**
 * Absolute path of the GeoCRM product icon used as the native window icon.
 * Bundled `lib/main.js` resolves `../icons` next to `lib/`.
 * @returns the PNG path passed to `BrowserWindow`.
 */
export function desktopWindowIconPath(): string {
  return fileURLToPath(new URL('../icons/icon.png', import.meta.url))
}

/** Official product suffix the shared frontend writes into `document.title`. */
export const UPSTREAM_WINDOW_TITLE = 'DeepSeek Harness'

/**
 * Other product suffixes a local or dirty frontend build writes into
 * `document.title` when `DSH_CLIENT_TITLE` is unset.
 */
export const UPSTREAM_WINDOW_TITLE_ALIASES = [
  'DSH Local Build',
  'DSH 本地构建',
] as const

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
 * Rewrite a renderer document title so the native window shows GeoCRM Harness.
 * Session titles stay; official and local-build product suffixes change.
 * @param title - `document.title` from the renderer.
 * @returns the native window title.
 */
export function desktopWindowTitle(title: string): string {
  let rewritten = title.replaceAll(UPSTREAM_WINDOW_TITLE, DESKTOP_PRODUCT_NAME)
  for (const alias of UPSTREAM_WINDOW_TITLE_ALIASES) {
    rewritten = rewritten.replaceAll(alias, DESKTOP_PRODUCT_NAME)
  }
  return rewritten.trim() === '' ? DESKTOP_PRODUCT_NAME : rewritten
}

/**
 * Pin the native window name to GeoCRM Harness and keep later renderer titles rewritten.
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
