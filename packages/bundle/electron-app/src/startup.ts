/**
 * The desktop app's command-line provider: it parses the `dsh --profile
 * electron` flag family (`--no-window`) and its `--help` text, then provides
 * the immutable values as {@link ELECTRON_STARTUP_SERVICE}. Ordinary rows
 * inject that service before reading it from lazy config.
 * @module @deepseek-ai/dsh-electron-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'electron-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this ordinary plugin and injected by flag-configured rows. */
export const ELECTRON_STARTUP_SERVICE = 'electronStartup'

/** What the electron rows read from {@link ELECTRON_STARTUP_SERVICE}. */
export interface ElectronStartupValues {
  /**
   * Whether this invocation spawns the Electron window. `--no-window` starts
   * the IPC listener without spawning Electron, for keyless composition
   * smokes that drive the socket directly with no display.
   */
  openWindow: boolean
}

/**
 * This app's command: its flags, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function electronCommand(): Command {
  return new Command()
    .name('dsh --profile electron')
    .description('Run the GeoCRM Harness desktop app.')
    .helpOption('-h, --help', 'show this help')
    .option('--no-window', 'start the IPC listener without spawning the Electron window (composition smokes)')
    .addHelpText('after', `
Examples:
  dsh --profile electron             open the desktop app window
  dsh --profile electron --no-window start the Host composition without a window
`)
}

/** The electron flag family, as commander parsed it. */
interface ElectronOptions {
  window: boolean
}

/**
 * Parse and provide the Electron invocation as an ordinary Cordis service.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = electronCommand()
  program.action(() => {
    const options = program.opts<ElectronOptions>()
    ctx.provide(ELECTRON_STARTUP_SERVICE, { openWindow: options.window } satisfies ElectronStartupValues)
  })
  parseCmdline(ctx, program)
}
