/**
 * GeoCRM Models catalog: live `GET /ai/models` rows with search, vendor marks,
 * combined labels, Not Configured badges, and enable toggles on keyed
 * vendors. Unkeyed vendors cannot be enabled. This is the allowlist the
 * composer reads after Save; it is not the adapter-default id/name editor
 * used by other families.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import { GeoCrmVendorIcon } from './GeoCrmVendorIcon.tsx'
import {
  geocrmCatalogLabel,
  geocrmModelId,
  isGeocrmCatalogNotConfigured,
} from './geocrm-keyed-models.ts'
import { discoveryRequestOf, type ModelDraft, type ProbeTarget } from './ModelListEditor.tsx'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link GeoCrmCatalogEditor}. */
export interface GeoCrmCatalogEditorProps {
  /** Enabled rows as the card currently drafts them. */
  models: readonly ModelDraft[]
  /** Whether the user layer currently owns the whole array. */
  overridden?: boolean
  /** Replace the drafted enabled rows. */
  onChange: (models: ModelDraft[]) => void
  /** Return to the adapter default enabled set. */
  onReset?: () => void
  /** Endpoint facts for discovery. */
  probe: ProbeTarget
  /** The Host operations whose interrogation loads the live catalog. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control. */
  disabled: boolean
}

/**
 * Display name for one discovered row.
 * @param model - live catalog row.
 * @returns the endpoint name, or the picker id.
 */
function nameOf(model: LlmDiscoveredModel): string {
  return model.name !== undefined && model.name.length > 0 ? model.name : model.id
}

/**
 * Render the GeoCRM live catalog with search and enable toggles.
 * @param props - drafted allowlist, probe, and copy.
 * @returns the catalog editor.
 */
export function GeoCrmCatalogEditor(props: GeoCrmCatalogEditorProps): ReactNode {
  const { models, onChange, probe, operations, t, disabled } = props
  const [busy, setBusy] = useState(true)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [live, setLive] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  const [query, setQuery] = useState('')
  const enabled = useMemo(() => {
    const ids = new Set<string>()
    for (const model of models) {
      const id = geocrmModelId(model)
      if (id.length > 0) ids.add(id)
    }
    return ids
  }, [models])

  const load = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const answer = await operations.discoverModels(probe.settingsNs, discoveryRequestOf(probe))
      if (answer.kind === 'refused') {
        setFailure(answer.message)
        setLive(undefined)
        return
      }
      setLive(answer.models)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void operations.discoverModels(probe.settingsNs, discoveryRequestOf(probe)).then((answer) => {
      if (cancelled) return
      if (answer.kind === 'refused') {
        setFailure(answer.message)
        setLive(undefined)
        setBusy(false)
        return
      }
      setLive(answer.models)
      setFailure(undefined)
      setBusy(false)
    })
    return () => { cancelled = true }
  }, [operations, probe.settingsNs, probe.provider, probe.baseURL, probe.api, probe.apiKey])

  const visible = useMemo(() => {
    const rows = live ?? []
    const needle = query.trim().toLowerCase()
    const filtered = needle.length === 0
      ? [...rows]
      : rows.filter((model) => {
        const label = geocrmCatalogLabel(model.id, nameOf(model)).toLowerCase()
        return label.includes(needle) || model.id.toLowerCase().includes(needle)
      })
    return filtered.sort((left, right) => {
      const leftOn = enabled.has(left.id) ? 0 : 1
      const rightOn = enabled.has(right.id) ? 0 : 1
      return leftOn - rightOn
    })
  }, [enabled, live, query])

  const setEnabled = (model: LlmDiscoveredModel, next: boolean): void => {
    const kept = models.filter((row) => {
      const id = geocrmModelId(row)
      return id.length > 0 && id !== model.id
    })
    onChange(next
      ? [...kept, { id: model.id, ...model.name === undefined ? {} : { name: model.name } }]
      : kept)
  }

  return (
    <section className={styles['geocrmCatalog']} aria-label={t('models')}>
      <div className={styles['geocrmCatalogHead']}>
        <span className={styles['modelCatalogTitle']}>{t('models')}</span>
        <span className={styles['modelCatalogMeta']}>
          {busy ? t('catalogLoading') : t('catalogLive')}
        </span>
        {props.overridden === true && props.onReset !== undefined
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled}
              onClick={props.onReset}
            >
              {t('resetModels')}
            </button>
          )
          : null}
      </div>
      <div className={styles['geocrmCatalogToolbar']}>
        <input
          className={`${styles['input']} ${styles['geocrmCatalogSearch']}`}
          type="search"
          value={query}
          placeholder={t('catalogSearch')}
          aria-label={t('catalogSearch')}
          disabled={disabled}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <button
          type="button"
          className={styles['iconButton']}
          disabled={disabled || busy}
          title={busy ? t('catalogRefreshing') : t('catalogRefresh')}
          aria-label={busy ? t('catalogRefreshing') : t('catalogRefresh')}
          onClick={() => { void load() }}
        >
          <RefreshIcon />
        </button>
      </div>
      {live !== undefined && visible.length === 0
        ? (
          <p className={styles['modelEmpty']}>
            {query.trim().length === 0 ? t('catalogEmpty') : t('catalogNoMatches')}
          </p>
        )
        : null}
      <ul className={styles['geocrmCatalogList']}>
        {visible.map((model) => {
          const label = geocrmCatalogLabel(model.id, nameOf(model))
          const notConfigured = isGeocrmCatalogNotConfigured(model)
          const on = enabled.has(model.id)
          return (
            <li key={model.id} className={styles['geocrmCatalogRow']}>
              <GeoCrmVendorIcon modelId={model.id} muted={notConfigured} />
              <span className={notConfigured ? styles['geocrmCatalogLabelMuted'] : styles['geocrmCatalogLabel']}>
                {label}
              </span>
              {notConfigured
                ? <span className={styles['geocrmCatalogBadge']}>{t('notConfigured')}</span>
                : (
                  <button
                    type="button"
                    role="switch"
                    className={styles['geocrmSwitch']}
                    aria-checked={on}
                    aria-label={t('catalogToggle').replace('{model}', label)}
                    disabled={disabled}
                    onClick={() => { setEnabled(model, !on) }}
                  >
                    <span className={styles['geocrmSwitchThumb']} />
                  </button>
                )}
            </li>
          )
        })}
      </ul>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
    </section>
  )
}

/** Refresh glyph for the catalog toolbar. */
function RefreshIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5M3 11.5V8h3.2M13 4.5V8H9.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
