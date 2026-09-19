import { OPENROUTER_FREE_MODELS } from '../types'
import type { ChatMessage, ExtractedPage } from '../types'
import {
  buildPageIntro,
  languageInstruction,
  parseFindingsArgs,
  REPORT_FINDINGS_SCHEMA,
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

/** Preferred model first, then the rest of the free roster as automatic fallback. */
function buildChain(preferredModel: string): string[] {
  const rest = OPENROUTER_FREE_MODELS.map((m) => m.id).filter((id) => id !== preferredModel)
  return [preferredModel, ...rest]
}

async function callOpenRouter(apiKey: string, models: string[], messages: unknown[]): Promise<ProviderResult> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
    // which has no tool calling) — fall back to raw text as the summary.
    return { summary: data.choices?.[0]?.message?.content ?? '', actionableItems: [], followUps: [] }
  }

  return parseFindingsArgs(JSON.parse(toolCall.function.arguments))
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
      return callOpenRouter(apiKey, chain, [{ role: 'user', content }])
    },

    async askFollowUp(priorMessages: ChatMessage[], userMessage: string, opts: ProviderCallOpts) {
      const messages = [
        ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage + languageInstruction(opts.outputLanguage) },
      ]
      return callOpenRouter(apiKey, chain, messages)
    },
  }
}
