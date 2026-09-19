import { askFollowUp, summarizePage } from '../lib/openrouter'
import { getSettings, getThread, threadIdForUrl, upsertThread } from '../lib/storage'
import type { ChatMessage, ExtractedPage, Thread } from '../lib/types'

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

const LOCAL_MIRROR_URL = 'http://localhost:4300/api/threads'

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

async function summarizeActiveTab(): Promise<Thread> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) throw new Error('No active tab.')

  const settings = await getSettings()
  if (!settings.openrouterApiKey) {
    throw new Error('Add your OpenRouter API key in Settings first.')
  }

  const domain = new URL(tab.url).hostname
  if (settings.blockedDomains.some((d) => domain.endsWith(d))) {
    throw new Error(`${domain} is on your blocked list — this page won't be read.`)
  }

  const [{ result: page }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageContent,
  })
  if (!page) throw new Error('Could not read this page.')

  const { summary, actionableItems, followUps } = await summarizePage(page, {
    apiKey: settings.openrouterApiKey,
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

async function continueThread(threadId: string, userText: string): Promise<Thread> {
  const settings = await getSettings()
  if (!settings.openrouterApiKey) {
    throw new Error('Add your OpenRouter API key in Settings first.')
  }

  const thread = await getThread(threadId)
  if (!thread) throw new Error('Thread not found.')

  const userMessage: ChatMessage = { role: 'user', content: userText, createdAt: Date.now() }
  thread.messages.push(userMessage)

  const { summary, actionableItems, followUps } = await askFollowUp(thread.messages, userText, {
    apiKey: settings.openrouterApiKey,
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SUMMARIZE_ACTIVE_TAB') {
    summarizeActiveTab()
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
