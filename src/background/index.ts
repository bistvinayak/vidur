import { extractPdfText } from '../lib/pdf'
import { getProvider } from '../lib/providers'
import { selectSkill } from '../lib/skills'
import { getSettings, getThread, saveSettings, threadIdForUrl, upsertThread } from '../lib/storage'
import type { ChatMessage, ExtractedPage, Settings, Thread } from '../lib/types'

// Explicitly false, not just omitted: Chrome persists this setting against
// the extension's ID (not in the extension's own storage), and an earlier
// version of this code set it to true. Since the ID is pinned (see
// manifest.config.ts), removing/reloading the unpacked extension does NOT
// reset it on its own — without this explicit override, chrome.action.onClicked
// below would silently never fire, because Chrome would still be consuming
// the click to just open the panel, per the old setting.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {})
})

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

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url)
}

/**
 * Runs inside the tab (via chrome.scripting.executeScript), same as
 * extractPageContent — self-contained, no imports. Fetches the PDF's own
 * bytes from within its own document context: same-origin, uses the page's
 * own session/cookies automatically, and needs no extension host_permissions
 * for arbitrary sites. Returns base64 since executeScript results must be
 * structured-cloneable and a raw ArrayBuffer of a large PDF is worth
 * avoiding as a giant JSON array of numbers.
 */
function fetchPdfAsBase64(): Promise<string> {
  return fetch(location.href)
    .then((res) => res.arrayBuffer())
    .then((buf) => {
      const bytes = new Uint8Array(buf)
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
      }
      return btoa(binary)
    })
}

/**
 * Combines per-frame extractions into one page. An iframe's own title/url
 * (e.g. a viewer sub-app served from a different subdomain) isn't
 * meaningful — the frame with a real title is treated as the primary one
 * for those fields, while text and images are pooled across every frame.
 */
function mergeFrameResults(frames: ExtractedPage[]): ExtractedPage | undefined {
  if (frames.length === 0) return undefined
  const primary = frames.find((f) => f.title) ?? frames[0]

  const text = frames
    .map((f) => f.text)
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 20000)

  const seen = new Set<string>()
  const images: { src: string; alt: string }[] = []
  for (const frame of frames) {
    for (const img of frame.images) {
      if (seen.has(img.src)) continue
      seen.add(img.src)
      images.push(img)
    }
  }

  return { url: primary.url, title: primary.title, text, images: images.slice(0, 8) }
}

async function extractHtmlPage(tab: chrome.tabs.Tab): Promise<ExtractedPage | undefined> {
  // allFrames: many sites (Perusall and similar reading/annotation tools
  // included) render the actual document inside an iframe, not the top
  // frame — without this, extraction silently only ever saw the page shell
  // (nav, sidebars) and missed the real content entirely.
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id!, allFrames: true },
    func: extractPageContent,
  })
  return mergeFrameResults(results.map((r) => r.result).filter((r): r is ExtractedPage => Boolean(r)))
}

async function extractPdfPage(tab: chrome.tabs.Tab): Promise<ExtractedPage | undefined> {
  let base64: string
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: fetchPdfAsBase64,
    })
    if (!result) throw new Error('empty result')
    base64 = result
  } catch (err) {
    // Chrome's own built-in PDF viewer may block script injection entirely —
    // a real platform restriction, not something retrying fixes.
    throw new Error(
      "Couldn't access this PDF (" +
        String((err as Error)?.message ?? err) +
        ") — Chrome's built-in PDF viewer may be blocking extension access to it.",
    )
  }

  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const text = await extractPdfText(bytes)
  if (!text) throw new Error('Could not extract any text from this PDF — it may be a scanned image with no text layer.')

  return { url: tab.url!, title: tab.title || 'PDF document', text, images: [] }
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

  const page = isPdfUrl(tab.url) ? await extractPdfPage(tab) : await extractHtmlPage(tab)
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
  thread.skillLabel = selectSkill(page.url).label // keep current even on a pre-existing thread from before this shipped

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
    await chrome.storage.local.set({ [IN_FLIGHT_KEY]: tab.id, lastError: null })
    await runSummarize(tab)
  } catch (err) {
    // This is the one trigger path with no direct caller waiting on a
    // response to show an error to — without writing it somewhere the panel
    // can see, a failure here (like the request-timeout case above) is
    // invisible: the spinner just stops with nothing in History and no clue
    // why, indistinguishable from a hang unless you happen to have the
    // service worker's console open.
    console.error('Vidur: summarize on icon click failed:', err)
    await chrome.storage.local.set({ lastError: { message: String((err as Error)?.message ?? err), at: Date.now() } })
  } finally {
    await chrome.storage.local.remove(IN_FLIGHT_KEY)
  }
})

/** Runs inside the tab — self-contained, no imports. */
function getViewportSize(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * Runs inside the tab — self-contained, no imports. Purely a visual overlay
 * for transparency (so the user sees where the click is about to land, the
 * same "watch it happen" feel as Claude's own browser use) — it does NOT
 * perform the real click itself. The actual click goes through
 * chrome.debugger from the background (see performActionClick) since a
 * synthetic DOM MouseEvent dispatched from injected JS is exactly the kind
 * of event many sites' listeners can detect and ignore as untrusted.
 */
function animateCursorTo(x: number, y: number): Promise<void> {
  return new Promise((resolve) => {
    const cursor = document.createElement('div')
    cursor.style.cssText =
      'position:fixed;top:0;left:0;width:20px;height:20px;margin:-10px;border-radius:50%;' +
      'background:rgba(37,99,235,0.55);border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.5);' +
      'z-index:2147483647;pointer-events:none;transition:transform 0.5s ease;' +
      `transform:translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px);`
    document.body.appendChild(cursor)
    requestAnimationFrame(() => {
      cursor.style.transform = `translate(${x}px, ${y}px)`
    })
    setTimeout(() => {
      cursor.remove()
      resolve()
    }, 650)
  })
}

/**
 * Screenshot + vision-grounded coordinates, capped at the CSS viewport size
 * of the tab — does not click anything yet. Returns everything the UI needs
 * to show a confirmation (the screenshot, the description, the location)
 * before CONFIRM_ACTION_CLICK actually touches the page.
 */
async function locateActionTarget(tabId: number, instruction: string) {
  const tab = await chrome.tabs.get(tabId)
  if (!tab.windowId) throw new Error('Could not find this tab\'s window.')

  const settings = await getSettings()
  const provider = getProvider(settings)

  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
  const [{ result: viewport }] = await chrome.scripting.executeScript({ target: { tabId }, func: getViewportSize })
  if (!viewport) throw new Error('Could not read this page\'s size.')

  const located = await provider.locateElement(screenshotDataUrl, instruction)
  if (!located.found) {
    return { ok: true as const, found: false, screenshotDataUrl }
  }

  return {
    ok: true as const,
    found: true,
    x: Math.round(located.xFraction * viewport.width),
    y: Math.round(located.yFraction * viewport.height),
    xFraction: located.xFraction,
    yFraction: located.yFraction,
    description: located.description,
    screenshotDataUrl,
  }
}

/**
 * The actual click — chrome.debugger simulates it at the CDP/input level,
 * which most sites treat as a genuine user click, unlike a synthetic DOM
 * MouseEvent. Attaches and detaches immediately around just this one
 * action, not for the session, to keep Chrome's "being debugged" banner as
 * brief as possible.
 */
async function performActionClick(tabId: number, x: number, y: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, func: animateCursorTo, args: [x, y] })

  const target = { tabId }
  // '0.1' is what chrome.debugger.attach expects here — not a CDP protocol
  // version, Chrome's own extension-debugger API version (confirmed against
  // Chrome's docs; matches major version + minor version-or-greater).
  await chrome.debugger.attach(target, '0.1')
  try {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  } finally {
    await chrome.debugger.detach(target).catch(() => {})
  }
}

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

  if (message?.type === 'LOCATE_ACTION_TARGET') {
    locateActionTarget(message.tabId, message.instruction)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err.message ?? err) }))
    return true
  }

  if (message?.type === 'CONFIRM_ACTION_CLICK') {
    performActionClick(message.tabId, message.x, message.y)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message ?? err) }))
    return true
  }

  return false
})
