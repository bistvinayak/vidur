import { getProvider } from '../lib/providers'
import { getSettings, getThread, saveSettings, threadIdForUrl, upsertThread } from '../lib/storage'
import type { ChatMessage, ExtractedPage, Settings, Thread } from '../lib/types'

const LOCAL_MIRROR_URL = 'http://localhost:4300/api/threads'
const KEY_FIELDS = ['openrouterApiKey', 'anthropicApiKey', 'openaiApiKey'] as const

/**
 * Settings crossing to the web page (a page's own JS/devtools, not the
 * extension's own trusted UI) never carry raw API keys — only whether one's
 * set. The Settings page inside the extension still reads/writes the real
 * keys directly via chrome.storage.local, unaffected by this.
 */
function redactKeys(settings: Settings) {
  const redacted: any = { ...settings }
  for (const field of KEY_FIELDS) {
    redacted[`${field}Set`] = Boolean(settings[field])
    redacted[field] = ''
  }
  return redacted
}

/** Blank/omitted key fields in an update mean "leave it as-is", not "clear it". */
function mergeSettingsUpdate(current: Settings, incoming: Partial<Settings>): Settings {
  const merged = { ...current, ...incoming }
  for (const field of KEY_FIELDS) {
    if (!incoming[field]) merged[field] = current[field]
  }
  return merged
}

/**
 * Best-effort mirror to the local web viewer (server/). chrome.storage.local
 * on this device stays the source of truth for the extension itself — this
 * just lets a browser tab at localhost:4300 read the same history. Silently
 * no-ops if `npm run server` isn't running.
 */
async function pushToLocalMirror(thread: Thread): Promise<void> {
  try {
    await fetch(LOCAL_MIRROR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(thread),
    })
  } catch {
    // Mirror server not running — extension keeps working without it.
  }
}

/**
 * Runs inside the page (via chrome.scripting.executeScript). Must be fully
 * self-contained — no imports, this function is serialized and injected as-is.
 */
function extractPageContent(): ExtractedPage {
  const MIN_DIMENSION = 100

  const clone = document.body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, style, noscript, nav, footer, header, iframe, svg').forEach((el) => el.remove())

  const main = clone.querySelector('article, main') ?? clone
  const text = (main.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 20000)

  const seen = new Set<string>()
  const images: { src: string; alt: string }[] = []
  document.querySelectorAll('img').forEach((img) => {
    const src = img.currentSrc || img.src
    if (!src || seen.has(src)) return
    if (img.naturalWidth && img.naturalWidth < MIN_DIMENSION) return
    if (img.naturalHeight && img.naturalHeight < MIN_DIMENSION) return
    seen.add(src)
    images.push({ src, alt: img.alt ?? '' })
  })

  return {
    url: location.href,
    title: document.title,
    text,
    images: images.slice(0, 8),
  }
}

/**
 * Does the actual work, given a Tab that's guaranteed to have activeTab
 * access — either because it's the exact tab object chrome.action.onClicked
 * just handed us (the click itself is the grant), or because a caller
 * already confirmed the grant is still fresh for that tabId.
 */
async function runSummarize(tab: chrome.tabs.Tab): Promise<Thread> {
  if (!tab?.id || !tab.url) throw new Error('Could not read that tab — try again from a normal web page.')

  const settings = await getSettings()
  const provider = getProvider(settings) // throws a clear error if the selected provider's key is missing

  const domain = new URL(tab.url).hostname
  if (settings.blockedDomains.some((d) => domain.endsWith(d))) {
    throw new Error(`${domain} is on your blocked list — this page won't be read.`)
  }

  const [{ result: page }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageContent,
  })
  if (!page) throw new Error('Could not read this page.')

  const { summary, actionableItems, followUps } = await provider.summarizePage(page, {
    outputLanguage: settings.outputLanguage,
  })

  const id = threadIdForUrl(page.url)
  const existing = await getThread(id)
  const message: ChatMessage = {
    role: 'assistant',
    content: summary,
    actionableItems,
    followUps,
    createdAt: Date.now(),
  }

  const thread: Thread = existing ?? {
    id,
    url: page.url,
    title: page.title,
    domain,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }
  thread.messages.push(message)
  thread.updatedAt = Date.now()
  thread.title = page.title

  await upsertThread(thread)
  await pushToLocalMirror(thread)
  return thread
}

/** Used by the panel's own "Summarize this page" button — works as long as
 * activeTab is still valid for this tab (i.e. it's the tab that was active
 * the last time the toolbar icon was clicked, and hasn't navigated since). */
async function summarizeActiveTab(tabId: number): Promise<Thread> {
  const tab = await chrome.tabs.get(tabId)
  return runSummarize(tab)
}

const IN_FLIGHT_KEY = 'inFlightTabId'

// The one fully reliable trigger: activeTab access is granted to whichever
// tab was active at the exact moment of this click — not to "whatever tab
// the user is currently looking at" if they've since switched away from the
// tab that was active when the panel was first opened. So this, not a
// button inside an already-open panel, is what actually runs the summary.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId != null) {
    // Not awaited on purpose — chrome.sidePanel.open must run as close to
    // the synchronous click handler as possible to still count as a user
    // gesture; awaiting something first can lose that.
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
  }
  if (!tab.id || !tab.url) return // e.g. a chrome:// page — nothing to summarize

  try {
    await chrome.storage.local.set({ [IN_FLIGHT_KEY]: tab.id })
    await runSummarize(tab)
  } catch (err) {
    console.error('Vidur: summarize on icon click failed:', err)
  } finally {
    await chrome.storage.local.remove(IN_FLIGHT_KEY)
  }
})

async function continueThread(threadId: string, userText: string): Promise<Thread> {
  const settings = await getSettings()
  const provider = getProvider(settings)

  const thread = await getThread(threadId)
  if (!thread) throw new Error('Thread not found.')

  const userMessage: ChatMessage = { role: 'user', content: userText, createdAt: Date.now() }
  thread.messages.push(userMessage)

  const { summary, actionableItems, followUps } = await provider.askFollowUp(thread.messages, userText, {
    outputLanguage: settings.outputLanguage,
  })

  thread.messages.push({
    role: 'assistant',
    content: summary,
    actionableItems,
    followUps,
    createdAt: Date.now(),
  })
  thread.updatedAt = Date.now()

  await upsertThread(thread)
  await pushToLocalMirror(thread)
  return thread
}

// Messages from the local web viewer (server/public/index.html), not from
// the extension's own UI. externally_connectable in the manifest already
// restricts which origins can reach this at all, but checking sender.origin
// here too is cheap insurance against any manifest misconfiguration.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.origin !== 'http://localhost:4300') return false

  if (message?.type === 'CONTINUE_THREAD') {
    continueThread(message.threadId, message.text)
      .then((thread) => sendResponse({ ok: true, thread }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message ?? err) }))
    return true
  }

  if (message?.type === 'GET_SETTINGS') {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings: redactKeys(settings) }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message ?? err) }))
    return true
  }

  if (message?.type === 'SAVE_SETTINGS') {
    getSettings()
      .then((current) => saveSettings(mergeSettingsUpdate(current, message.settings)))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message ?? err) }))
    return true
  }

  return false
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SUMMARIZE_ACTIVE_TAB') {
    summarizeActiveTab(message.tabId)
      .then((thread) => sendResponse({ ok: true, thread }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message ?? err) }))
    return true // keep the message channel open for the async response
  }

  if (message?.type === 'CONTINUE_THREAD') {
    continueThread(message.threadId, message.text)
      .then((thread) => sendResponse({ ok: true, thread }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message ?? err) }))
    return true
  }

  return false
})
