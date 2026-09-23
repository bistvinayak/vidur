import { Langfuse } from 'langfuse'
import type { Settings } from './types'

// One conversation thread = one Langfuse trace (keyed by the same thread id
// already used everywhere else in this codebase), so every call across a
// whole conversation — the initial summary and every follow-up — shows up
// nested under one trace in Langfuse's UI. That's "the agent thread," made
// inspectable: what was actually sent, what came back, which model in the
// OpenRouter fallback chain actually served it, and how long each turn took.
//
// Confirmed via the installed SDK's own type definitions (not assumed):
// langfuse-core bundles cleanly in an MV3 service worker — its Node-only
// code paths (dynamic import of node:fs/node:crypto) are gated behind an
// environment check that never fires here; this environment takes the
// "Edge runtime" branch using the standard global `crypto`, same as
// Cloudflare Workers/Vercel edge functions.

let cached: { client: Langfuse; cacheKey: string } | null = null

function getClient(settings: Settings): Langfuse | null {
  if (!settings.langfuseEnabled || !settings.langfusePublicKey || !settings.langfuseSecretKey) return null

  const cacheKey = `${settings.langfusePublicKey}:${settings.langfuseSecretKey}:${settings.langfuseHost}`
  if (cached?.cacheKey === cacheKey) return cached.client

  const client = new Langfuse({
    publicKey: settings.langfusePublicKey,
    secretKey: settings.langfuseSecretKey,
    baseUrl: settings.langfuseHost || 'https://cloud.langfuse.com',
  })
  cached = { client, cacheKey }
  return client
}

/**
 * Every call below explicitly flushes rather than relying on the SDK's
 * background batching interval — an MV3 service worker can be torn down
 * between events, and an un-flushed batch sitting in memory when that
 * happens is silently lost. This is the same category of bug as the
 * request-hang issue found earlier in this project; flushing eagerly here
 * trades a little latency for not silently dropping trace data.
 */
async function safeFlush(client: Langfuse): Promise<void> {
  try {
    await client.flushAsync()
  } catch {
    // A tracing failure should never take down the actual feature.
  }
}

export async function startOrUpdateTrace(settings: Settings, params: { threadId: string; name: string; url: string }): Promise<void> {
  const client = getClient(settings)
  if (!client) return
  client.trace({ id: params.threadId, name: params.name, metadata: { url: params.url } })
  await safeFlush(client)
}

export async function logGeneration(
  settings: Settings,
  params: {
    threadId: string
    name: 'summarize' | 'follow_up' | 'locate_element'
    model: string
    input: string
    output: string
    startTime: Date
    endTime: Date
    error?: string
  },
): Promise<void> {
  const client = getClient(settings)
  if (!client) return
  client.generation({
    traceId: params.threadId,
    name: params.name,
    model: params.model,
    input: params.input,
    output: params.error ? undefined : params.output,
    startTime: params.startTime,
    endTime: params.endTime,
    level: params.error ? 'ERROR' : 'DEFAULT',
    statusMessage: params.error,
  })
  await safeFlush(client)
}
