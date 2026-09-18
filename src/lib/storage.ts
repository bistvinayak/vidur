import type { Settings, Thread } from './types'

const THREADS_KEY = 'threads'
const SETTINGS_KEY = 'settings'

const DEFAULT_SETTINGS: Settings = {
  openrouterApiKey: '',
  outputLanguage: '',
  blockedDomains: [],
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get<{ settings?: Settings }>(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...result.settings }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

export function threadIdForUrl(url: string): string {
  // Strip query/hash so ?ref=... variants of the same page share a thread.
  const u = new URL(url)
  return `${u.origin}${u.pathname}`
}

export async function getAllThreads(): Promise<Thread[]> {
  const result = await chrome.storage.local.get<{ threads?: Thread[] }>(THREADS_KEY)
  const list = result.threads ?? []
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getThread(id: string): Promise<Thread | undefined> {
  const threads = await getAllThreads()
  return threads.find((t) => t.id === id)
}

export async function upsertThread(thread: Thread): Promise<void> {
  const threads = await getAllThreads()
  const idx = threads.findIndex((t) => t.id === thread.id)
  if (idx >= 0) threads[idx] = thread
  else threads.push(thread)
  await chrome.storage.local.set({ [THREADS_KEY]: threads })
}

export async function deleteThread(id: string): Promise<void> {
  const threads = await getAllThreads()
  await chrome.storage.local.set({ [THREADS_KEY]: threads.filter((t) => t.id !== id) })
}
