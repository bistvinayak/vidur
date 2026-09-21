import { OPENROUTER_FREE_MODELS } from '../types'
import type { ChatMessage, ExtractedPage } from '../types'
import {
  buildPageIntro,
  fetchWithTimeout,
  languageInstruction,
  parseFindingsArgs,
  REPORT_FINDINGS_SCHEMA,
  sanitizeSummaryText,
  type ModelProvider,
  type ProviderCallOpts,
  type ProviderResult,
} from './types'

const REPORT_FINDINGS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'report_findings',
    description: 'Report the summary, actionable items, and suggested follow-ups for the page or question.',
    parameters: REPORT_FINDINGS_SCHEMA,
  },
}

/**
 * Preferred model first, then up to 2 more of the free roster as fallback —
 * OpenRouter's `models` array rejects requests with a 400 if given more
 * than 3 entries total, confirmed against the live API (not documented
 * clearly beforehand), so this is a hard cap, not a stylistic choice.
 */
function buildChain(preferredModel: string): string[] {
  const rest = OPENROUTER_FREE_MODELS.map((m) => m.id).filter((id) => id !== preferredModel)
  return [preferredModel, ...rest].slice(0, 3)
}

async function callOpenRouter(apiKey: string, models: string[], messages: unknown[], maxTokens: number): Promise<ProviderResult> {
  const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/vidur-extension',
      'X-Title': 'Vidur',
    },
    body: JSON.stringify({
      models,
      messages,
      max_tokens: maxTokens, // lower cap = lower worst-case latency, not just a safety net
      tools: [REPORT_FINDINGS_TOOL],
      tool_choice: { type: 'function', function: { name: 'report_findings' } },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenRouter error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]
  if (!toolCall) {
    // Model ignored tool_choice (happens on some free models, e.g. Inkling
    // which has no tool calling, or a reasoning model that emitted its own
    // <think>/<tool_call> text instead of a real structured call) — sanitize
    // before treating raw text as the summary, since it can otherwise carry
    // leaked chat-template artifacts straight into the UI.
    return { summary: sanitizeSummaryText(data.choices?.[0]?.message?.content ?? ''), actionableItems: [], followUps: [] }
  }

  let args: any
  try {
    args = JSON.parse(toolCall.function.arguments)
  } catch {
    throw new Error('The model returned a malformed response — try again, or switch models in Settings.')
  }
  return parseFindingsArgs(args)
}

export function createOpenRouterProvider(apiKey: string, preferredModel: string): ModelProvider {
  const chain = buildChain(preferredModel)

  return {
    async summarizePage(page: ExtractedPage, opts: ProviderCallOpts) {
      const content: unknown[] = [{ type: 'text', text: buildPageIntro(page) + languageInstruction(opts.outputLanguage) + `\n\nPage content:\n${page.text}` }]
      // Sending the remote URL directly — most OpenRouter providers fetch it
      // server-side. Switch to fetching + base64-encoding if a chosen model
      // can't reach a given host (auth-gated images, some CDNs).
      for (const img of page.images.slice(0, 5)) {
        content.push({ type: 'image_url', image_url: { url: img.src } })
      }
      return callOpenRouter(apiKey, chain, [{ role: 'user', content }], 1500)
    },

    async askFollowUp(priorMessages: ChatMessage[], userMessage: string, opts: ProviderCallOpts) {
      const messages = [
        ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage + languageInstruction(opts.outputLanguage) },
      ]
      // A conversational reply needs far less room than a full page
      // summary + actionable items — smaller cap, faster worst case.
      return callOpenRouter(apiKey, chain, messages, 700)
    },
  }
}
