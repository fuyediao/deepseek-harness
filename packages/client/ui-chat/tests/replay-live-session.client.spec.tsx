// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import type {
  ChatConversationViewNode, ChatSnapshot, ChatViewSlotProps,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  ConversationNodeAssembler,
  type ConversationNodeDefinition,
  type ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { inspectRequestPrompt } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { commandDefinition } from '../src/client/conversation-nodes/command.ts'
import { compactionDefinition } from '../src/client/conversation-nodes/compaction.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'
import { nextStepInboxDefinition } from '../src/client/conversation-nodes/inbox.ts'
import { messageDefinition } from '../src/client/conversation-nodes/message.ts'
import { requestPromptDefinition } from '../src/client/conversation-nodes/request-prompt.ts'
import { retryDefinition } from '../src/client/conversation-nodes/retry.ts'
import { toolDefinition } from '../src/client/conversation-nodes/tool.ts'
import { turnErrorDefinition } from '../src/client/conversation-nodes/turn-error.ts'
import { turnMaxTokensDefinition } from '../src/client/conversation-nodes/turn-max-tokens.ts'
import { turnTailDefinition } from '../src/client/conversation-nodes/turn-tail.ts'
import { turnProcessDefinition } from '../src/client/conversation-nodes/turn-process.ts'
import { ChatView } from '../src/client/chat/ChatView.tsx'
import { createChatStore } from '../src/client/stores.ts'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EMPTY_CONVERSATION_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'

const FIXTURE = join(process.cwd(), 'tmp-session-events.json')

const DEFINITIONS: readonly ConversationNodeDefinition[] = [
  nextStepInboxDefinition,
  messageDefinition,
  requestPromptDefinition(inspectRequestPrompt),
  assistantDefinition,
  turnProcessDefinition,
  toolDefinition,
  commandDefinition,
  compactionDefinition,
  retryDefinition,
  turnErrorDefinition,
  turnMaxTokensDefinition,
  turnTailDefinition,
]

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return DEFINITIONS
  }

  fallbackEntry(): ConversationNodeDefinition {
    return unknownFallbackDefinition
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

/**
 * Load durable session events from the decoded live-session fixture.
 * @returns event-like entries the Conversation assembler accepts.
 */
function loadFixtureEntries(): SessionEventLikeEntry[] {
  const records = JSON.parse(readFileSync(FIXTURE, 'utf8')) as readonly Record<string, unknown>[]
  return records.flatMap((record) => {
    if (typeof record.seq !== 'number' || typeof record.type !== 'string') return []
    return [{ type: 'event' as const, event: record as unknown as SessionEvent }]
  })
}

/**
 * Assemble the Chat target over the given window.
 * @param entries - session event-like entries.
 * @returns the assembler after Chat activation.
 */
function assembler(entries: readonly SessionEventLikeEntry[]): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, false)
  value.activateTarget('chat')
  return value
}

/**
 * Read the Chat snapshot, failing if the target was not registered.
 * @param value - assembler after Chat activation.
 * @returns the Chat snapshot.
 */
function snapshotOf(value: ConversationNodeAssembler): ChatSnapshot {
  const current = value.snapshot('chat') as ChatSnapshot | undefined
  if (current === undefined) throw new Error('chat view was not registered')
  return current
}

describe('replay live GeoCRM session into origin/master Chat', () => {
  it.skipIf(!existsSync(FIXTURE))('builds visible Chat nodes with isAppendSurfaceEvent matchers', () => {
    const entries = loadFixtureEntries()
    const surface = entries.filter(entry => (
      entry.event.type === 'user/message'
      || entry.event.type === 'assistant/message'
      || entry.event.type === 'tool/result'
    ))
    const appendCount = surface.filter(entry => (
      entry.type === 'event' && isAppendSurfaceEvent(entry.event)
    )).length
    let built: ChatSnapshot
    try {
      built = snapshotOf(assembler(entries))
    } catch (error) {
      throw new Error(
        `Chat assembler threw on ${entries.length} events `
        + `(${surface.length} surface, ${appendCount} append): ${String(error)}`,
      )
    }
    const kinds = built.order.map((key) => {
      const node = built.nodes.get(key) as ChatConversationViewNode | undefined
      return node?.kind ?? `missing:${key}`
    })
    const process = built.order.map((key) => {
      const node = built.nodes.get(key) as ChatConversationViewNode | undefined
      return {
        kind: node?.kind,
        process: built.nodes.processSource(key).getSnapshot() === undefined ? 'missing' : 'ok',
      }
    })
    expect(appendCount, 'fixture surface events should be append-origin').toBe(surface.length)
    expect(built.order.length, `Chat order empty; kinds=${JSON.stringify(kinds)}`).toBeGreaterThan(0)
    expect(kinds, `kinds=${JSON.stringify(kinds)}`).toContain('user')
    expect(process.filter(row => row.kind === 'turn-process')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'turn-process' })]),
    )
    // Keep the process map in the assertion so a missing owner is visible.
    expect(process.filter(row => row.kind === 'turn-process' && row.process === 'missing')).toEqual([])
  })

  it.skipIf(!existsSync(FIXTURE))('paints ChatView rows from the assembled snapshot', () => {
    const built = snapshotOf(assembler(loadFixtureEntries()))
    const chatStore = createSnapshotStore(built)
    const sessionStore = createSnapshotStore<SessionSnapshot>({
      sessionId: 'session-c654754f-0fd3-4226-9dea-8c994ade249c' as SessionId,
      queue: [],
      pendingSubmissions: [],
      running: false,
      removed: false,
      openState: 'open',
      openError: null,
      hasMore: false,
      loadingOlder: false,
      promptError: null,
      blank: false,
      subagent: null,
      lastAgentError: null,
      promptAttempted: true,
      awaitingFirstTurn: false,
    })
    const keyed = new Map<string, ReturnType<typeof bindSnapshotSelector>>()
    const useKeyed = (
      resolve: (key: string) => { getSnapshot: () => unknown; subscribe: (fn: () => void) => () => void },
    ): ChatViewSlotProps['useChatNode'] => (
      ((key: string, selector?: (value: unknown) => unknown) => {
        let hook = keyed.get(key)
        if (hook === undefined) {
          hook = bindSnapshotSelector({
            getSnapshot: () => resolve(key).getSnapshot(),
            subscribe: (listener: () => void) => resolve(key).subscribe(listener),
          } as never)
          keyed.set(key, hook)
        }
        return hook(selector ?? (value => value))
      }) as ChatViewSlotProps['useChatNode']
    )
    const chat = createChatStore().create()
    const renderSlot = ((_key: string, _owner: object, opts?: { fallback?: ReactNode }) => (
      opts?.fallback ?? null
    )) as ChatViewSlotProps['renderSlot']
    const props = {
      sessionId: sessionStore.getSnapshot().sessionId,
      useSession: bindSnapshotSelector(sessionStore),
      useChat: bindSnapshotSelector(chatStore),
      useChatNode: useKeyed(key => built.nodes.source(key)),
      useChatNodeProcess: useKeyed(key => built.nodes.processSource(key)),
      useConversation: bindSnapshotSelector(createSnapshotStore(EMPTY_CONVERSATION_SNAPSHOT)),
      useTrajectory: () => { throw new Error('unused') },
      useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
        ids: [], byId: {}, current: undefined, phase: 'ready',
        subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
      })),
      useSessionPendingInteraction: bindSnapshotSelector(createSnapshotStore(new Map())),
      useWorkspaces: bindSnapshotSelector(createSnapshotStore({
        items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      })),
      useProjection: () => undefined,
      useInput: () => { throw new Error('unused') },
      inputActions: {
        setDraft: () => {},
        addAttachments: () => true,
        removeAttachment: () => {},
        pruneAttachments: () => {},
        submit: () => {},
      },
      useStore: bindSnapshotSelector(chat),
      actions: chat.actions,
      useTranscriptView: bindSnapshotSelector(createSnapshotStore('normal' as const)),
      renderSlot,
      SessionProvider: ({ children }: { children?: unknown }) => children,
      viewRequest: null,
      openView: () => {},
      completeViewRequest: () => {},
      openDetails: () => {},
      openFile: async () => {},
      loadOlder: () => {},
      loadThrough: async () => {},
      loadImage: Object.assign(async () => '', { peek: () => undefined }),
      chatScroll: { save: () => {}, read: () => null },
      forkAt: () => {},
      fileMentions: () => undefined,
      t: makeTranslate(zh, commonZh),
    } as unknown as ChatViewSlotProps
    const view = render(<ChatView {...props} />)
    expect(view.container.querySelectorAll('[data-chat-flow-kind]').length).toBeGreaterThan(0)
    expect(view.container.querySelectorAll('[data-chat-flow-kind="user"]').length).toBe(3)
  })
})
