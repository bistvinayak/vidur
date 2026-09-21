import { useEffect, useState } from 'react'
import { getAllThreads, threadIdForUrl } from '../lib/storage'
import type { ChatMessage, Thread } from '../lib/types'

type View = { name: 'list' } | { name: 'thread'; threadId: string }

function formatMessageForCopy(m: ChatMessage): string {
  const items = (m.actionableItems ?? []).map((a) => `- ${a.label}${a.detail ? `: ${a.detail}` : ''}`).join('\n')
  return m.content + (items ? `\n\n${items}` : '')
}

function formatThreadForCopy(thread: Thread): string {
  const header = `${thread.title || thread.domain}\n${thread.url}\n`
  const body = thread.messages.map((m) => `${m.role === 'user' ? 'You' : 'Vidur'}: ${formatMessageForCopy(m)}`).join('\n\n')
  return `${header}\n${body}`
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function App() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [view, setView] = useState<View>({ name: 'list' })
  const [activeTabUrl, setActiveTabUrl] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [autoSummarizing, setAutoSummarizing] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [draft, setDraft] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | undefined>()

  function handleCopy(key: string, text: string) {
    copyToClipboard(text).then((ok) => {
      if (ok) {
        setCopiedKey(key)
        setTimeout(() => setCopiedKey((k) => (k === key ? undefined : k)), 1500)
      } else {
        setError('Could not copy — your browser may be blocking clipboard access.')
      }
    })
  }

  const refreshThreads = () => getAllThreads().then(setThreads)

  useEffect(() => {
    refreshThreads()
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setActiveTabUrl(tab?.url))
    chrome.storage.local
      .get<{ inFlightTabId?: number; lastError?: { message: string } }>(['inFlightTabId', 'lastError'])
      .then((r) => {
        setAutoSummarizing(Boolean(r.inFlightTabId))
        if (r.lastError) setError(r.lastError.message)
      })

    // The actual "Summarize this page" trigger is now the toolbar icon click
    // (see background/index.ts) — it can complete before this panel has even
    // finished mounting, or while it's already open on a different view, so
    // this is how the panel finds out rather than a direct response to a click.
    function handleStorageChange(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area !== 'local') return
      if ('inFlightTabId' in changes) setAutoSummarizing(Boolean(changes.inFlightTabId.newValue))
      if ('threads' in changes) refreshThreads()
      if ('lastError' in changes && changes.lastError.newValue) {
        setError((changes.lastError.newValue as { message: string }).message)
      }
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  const activeThread = view.name === 'thread' ? threads.find((t) => t.id === view.threadId) : undefined
  const currentPageThreadId = activeTabUrl ? threadIdForUrl(activeTabUrl) : undefined
  const currentPageThread = threads.find((t) => t.id === currentPageThreadId)

  async function handleSummarize() {
    setBusy(true)
    setError(undefined)

    // Resolved here, not in the background service worker: a service worker
    // has no window of its own, so chrome.tabs.query({currentWindow: true})
    // called from there resolves against an ambiguous "last focused window"
    // instead of the window this panel is actually docked to. The side panel
    // itself is window-scoped, so this query is reliable from here.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      setBusy(false)
      return setError('Could not find the active tab — try clicking on the page first, then Summarize again.')
    }

    try {
      // If the background service worker dies mid-request (killed for
      // exceeding MV3's execution limits, extension reloaded mid-flight,
      // etc.), this rejects rather than hanging — without the try/catch,
      // that rejection would skip setBusy(false) entirely and leave the
      // spinner stuck forever with no error shown, indistinguishable from
      // an actual hang.
      const res = await chrome.runtime.sendMessage({ type: 'SUMMARIZE_ACTIVE_TAB', tabId: tab.id })
      if (!res.ok) return setError(res.error)
      await refreshThreads()
      setView({ name: 'thread', threadId: res.thread.id })
    } catch (err) {
      setError('Lost connection to the extension — try again. (' + String((err as Error)?.message ?? err) + ')')
    } finally {
      setBusy(false)
    }
  }

  async function handleSend(text: string) {
    if (!activeThread || !text.trim()) return
    setDraft('')
    setBusy(true)
    setError(undefined)
    try {
      const res = await chrome.runtime.sendMessage({ type: 'CONTINUE_THREAD', threadId: activeThread.id, text })
      if (!res.ok) return setError(res.error)
      await refreshThreads()
    } catch (err) {
      setError('Lost connection to the extension — try again. (' + String((err as Error)?.message ?? err) + ')')
    } finally {
      setBusy(false)
    }
  }

  if (view.name === 'list') {
    return (
      <div className="app">
        <header className="header">
          <h1>Vidur</h1>
          <button className="icon-btn" onClick={() => chrome.runtime.openOptionsPage()} title="Settings">
            ⚙
          </button>
        </header>

        <button className="primary-btn" onClick={handleSummarize} disabled={busy}>
          {busy ? 'Reading page…' : currentPageThread ? 'Summarize again' : 'Summarize this page'}
        </button>
        <p className="hint">Or just click the Vidur toolbar icon on any page — that's the more reliable trigger.</p>
        {autoSummarizing && <p className="empty">Summarizing the page you clicked the icon on…</p>}
        {error && <p className="error">{error}</p>}

        <h2 className="section-title">History</h2>
        {threads.length === 0 && !autoSummarizing && <p className="empty">No summaries yet — click the Vidur icon on any page.</p>}
        <ul className="thread-list">
          {threads.map((t) => (
            <li key={t.id}>
              <button className="thread-item" onClick={() => setView({ name: 'thread', threadId: t.id })}>
                <span className="thread-title">{t.title || t.domain}</span>
                <span className="thread-domain">{t.domain}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (!activeThread) return null

  return (
    <div className="app">
      <header className="header">
        <button className="icon-btn" onClick={() => setView({ name: 'list' })} title="Back">
          ←
        </button>
        <h1 className="truncate">{activeThread.title}</h1>
        <button
          className="icon-btn"
          onClick={() => handleCopy('thread', formatThreadForCopy(activeThread))}
          title="Copy whole conversation"
        >
          {copiedKey === 'thread' ? '✓' : '⧉'}
        </button>
      </header>

      <div className="messages">
        {activeThread.messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <button
              className="copy-btn"
              onClick={() => handleCopy(`msg-${i}`, formatMessageForCopy(m))}
              title="Copy this message"
            >
              {copiedKey === `msg-${i}` ? '✓' : '⧉'}
            </button>
            <p>{m.content}</p>
            {m.actionableItems && m.actionableItems.length > 0 && (
              <ul className="actionable-list">
                {m.actionableItems.map((a, j) => (
                  <li key={j}>
                    <strong>{a.label}</strong>
                    {a.detail ? ` — ${a.detail}` : ''}
                  </li>
                ))}
              </ul>
            )}
            {m.followUps && m.followUps.length > 0 && (
              <div className="chips">
                {m.followUps.map((f, j) => (
                  <button key={j} className="chip" onClick={() => handleSend(f.prompt)} disabled={busy}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant thinking">Thinking…</div>}
      </div>

      {error && <p className="error">{error}</p>}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          handleSend(draft)
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask a follow-up…"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
