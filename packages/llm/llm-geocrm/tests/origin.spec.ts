import { describe, expect, it } from 'vitest'
import { DEFAULT_BASE_URL } from '../src/adapter.ts'
import {
  BASE_URL_ENV,
  DEPLOYMENT_DOMAIN_ENV,
  originFromDeploymentDomain,
  resolveGeoCrmOrigin,
} from '../src/origin.ts'

describe('originFromDeploymentDomain', () => {
  it('builds https://api.{host} and strips URL or api. prefixes', () => {
    expect(originFromDeploymentDomain(undefined)).toBeUndefined()
    expect(originFromDeploymentDomain('')).toBeUndefined()
    expect(originFromDeploymentDomain('   ')).toBeUndefined()
    expect(originFromDeploymentDomain('powersource.app')).toBe('https://api.powersource.app')
    expect(originFromDeploymentDomain('https://powersource.app/')).toBe('https://api.powersource.app')
    expect(originFromDeploymentDomain('http://api.powersource.app')).toBe('https://api.powersource.app')
  })
})

describe('resolveGeoCrmOrigin', () => {
  it('prefers GEOCRM_BASE_URL, then the deployment domain, then config, then localhost', () => {
    expect(resolveGeoCrmOrigin({})).toBe(DEFAULT_BASE_URL)
    expect(resolveGeoCrmOrigin({ baseURL: 'http://127.0.0.1:4000/' })).toBe('http://127.0.0.1:4000')
    expect(resolveGeoCrmOrigin({ baseURL: '   ' })).toBe(DEFAULT_BASE_URL)

    const env = (values: Record<string, string>) => ({
      get: (name: string) => {
        const value = values[name]
        return value === undefined ? undefined : { value, source: 'project-env' as const }
      },
    })

    expect(resolveGeoCrmOrigin(
      { baseURL: 'http://ignored' },
      env({ [BASE_URL_ENV]: 'https://api.vps.example/' }),
    )).toBe('https://api.vps.example')

    expect(resolveGeoCrmOrigin(
      { baseURL: 'http://ignored' },
      env({ [DEPLOYMENT_DOMAIN_ENV]: 'vps.example' }),
    )).toBe('https://api.vps.example')

    expect(resolveGeoCrmOrigin(
      {},
      env({ [BASE_URL_ENV]: 'https://api.from-base', [DEPLOYMENT_DOMAIN_ENV]: 'from-domain' }),
    )).toBe('https://api.from-base')

    expect(resolveGeoCrmOrigin({}, env({ [BASE_URL_ENV]: '   ' }))).toBe(DEFAULT_BASE_URL)
    expect(resolveGeoCrmOrigin({}, env({ [DEPLOYMENT_DOMAIN_ENV]: '' }))).toBe(DEFAULT_BASE_URL)
  })
})
