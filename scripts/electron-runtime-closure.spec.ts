/**
 * Desktop installer Host closure: omit the Electron asar and Web-only carriers.
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ELECTRON_HOST_OMIT,
  ELECTRON_RUNTIME_CLOSURE_NAME,
  electronRuntimeClosureDependencies,
  renderElectronRuntimeClosureManifest,
} from './electron-runtime-closure.ts'

const root = resolve(import.meta.dirname, '..')

describe('electron runtime closure', () => {
  it('unions Host and desktop Client workspace packages without Electron or Web-only carriers', async () => {
    const dependencies = await electronRuntimeClosureDependencies(root)
    expect(dependencies['@deepseek-ai/dsh']).toBe('workspace:^')
    expect(dependencies['@deepseek-ai/dsh-base']).toBe('workspace:^')
    expect(dependencies['@deepseek-ai/dsh-electron-app']).toBe('workspace:^')
    expect(dependencies['@deepseek-ai/dsh-electron-ipc']).toBe('workspace:^')
    expect(dependencies['@deepseek-ai/dsh-client-connection']).toBe('workspace:^')
    expect(dependencies['@deepseek-ai/dsh-native-command']).toBe('workspace:^')
    expect(dependencies['@deepseek-ai/dsh-util-workspace-path']).toBe('workspace:^')
    expect(dependencies['@deepseek-ai/dsh-host-directory-picker']).toBe('workspace:^')
    expect(dependencies['@deepseek-ai/dsh-session-title-llm']).toBe('workspace:^')
    expect(dependencies['@deepseek-ai/dsh-web-frontend']).toBeUndefined()
    for (const name of ELECTRON_HOST_OMIT) {
      expect(dependencies[name], name).toBeUndefined()
    }
    const rendered = renderElectronRuntimeClosureManifest(dependencies)
    expect(rendered).toContain(`"name": "${ELECTRON_RUNTIME_CLOSURE_NAME}"`)
    expect(rendered.endsWith('\n')).toBe(true)
  })
})
