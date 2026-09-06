// @vitest-environment jsdom
/** Vendor marks for the GeoCRM Models catalog. */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GeoCrmVendorIcon } from '../src/client/GeoCrmVendorIcon.tsx'

describe('GeoCrmVendorIcon', () => {
  it('renders a mark for each known vendor and a letter for others', () => {
    const ids = [
      'chatgpt:gpt-6-astra',
      'openai:gpt-x',
      'gemini:gemini-3.8-flash',
      'claude:claude-fable-5-1',
      'anthropic:claude-opus-5',
      'grok:grok-4.6',
      'deepseek:deepseek-v4-flash',
      'other:foo',
      ':empty',
      '',
    ]
    for (const modelId of ids) {
      const { container } = render(<GeoCrmVendorIcon modelId={modelId} />)
      expect(container.querySelector('svg')).toBeTruthy()
    }
    const muted = render(<GeoCrmVendorIcon modelId="chatgpt:gpt-6-astra" muted />)
    expect(muted.container.querySelector('span')?.style.filter).toContain('grayscale')
  })
})
