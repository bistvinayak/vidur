import { useEffect, useState } from 'react'
import { getAllThreads, threadIdForUrl } from '../lib/storage'
import type { Thread } from '../lib/types'

type View = { name: 'list' } | { name: 'thread'; threadId: string }

export default function App() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [view, setView] = useState<View>({ name: 'list' })
  const [activeTabUrl, setActiveTabUrl] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [draft, setDraft] = useState('')

  const refreshThreads = () => getAllThreads().then(setThreads)

  useEffect(() => {
    refreshThreads()
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setActiveTabUrl(tab?.url))
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

    const res = await chrome.runtime.sendMessage({ type: 'SUMMARIZE_ACTIVE_TAB', tabId: tab.id })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    await refreshThreads()
    setView({ name: 'thread', threadId: res.thread.id })
  }

  async function handleSend(text: string) {
    if (!activeThread || !text.trim()) return
    setDraft('')
    setBusy(true)
    setError(undefined)
    const res = await chrome.runtime.sendMessage({ type: 'CONTINUE_THREAD', threadId: activeThread.id, text })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    await refreshThreads()
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
        {error && <p className="error">{error}</p>}

        <h2 className="section-title">History</h2>
        {threads.length === 0 && <p className="empty">No summaries yet — click the button above on any page.</p>}
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
      </header>

      <div className="messages">
        {activeThread.messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
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
