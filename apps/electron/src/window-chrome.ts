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
