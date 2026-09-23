import { OPENROUTER_FREE_MODELS, ANTHROPIC_MODELS, OPENAI_MODELS } from './types'
import type { Settings, Thread } from './types'

const THREADS_KEY = 'threads'
const SETTINGS_KEY = 'settings'

const DEFAULT_SETTINGS: Settings = {
  provider: 'openrouter',
  openrouterApiKey: '',
  openrouterModel: OPENROUTER_FREE_MODELS.find((m) => m.recommended)!.id,
  anthropicApiKey: '',
  anthropicModel: ANTHROPIC_MODELS.find((m) => m.recommended)!.id,
  openaiApiKey: '',
  openaiModel: OPENAI_MODELS.find((m) => m.recommended)!.id,
  outputLanguage: '',
  blockedDomains: [],
  langfuseEnabled: false,
  langfusePublicKey: '',
  langfuseSecretKey: '',
  langfuseHost: 'https://cloud.langfuse.com',
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get<{ settings?: Settings }>(SETTINGS_KEY)
  const merged = { ...DEFAULT_SETTINGS, ...result.settings }
  // Dev convenience only: if nothing's been saved via the Settings page yet,
  // fall back to the key in .env (npm run dev). A production build has no
  // .env baked in, so this is a no-op outside local development.
  if (!merged.openrouterApiKey && import.meta.env.VITE_OPENROUTER_API_KEY) {
    merged.openrouterApiKey = import.meta.env.VITE_OPENROUTER_API_KEY
  }
  return merged
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
