import type { ActionableItem, ChatMessage, ExtractedPage, FollowUp } from './types'

// Free-tier fallback chains on OpenRouter. Vision + tool-calling capable
// models come first in both chains since either chain may need to read an
// image. Kept as a plain array (not hardcoded deeper in the file) so it's
// the one place to update when OpenRouter's free roster rotates — see
// README for the note about moving this to a remote config later.
export const HEAVY_CHAIN = [
  'inclusionai/ling-3.0-flash-vl:free',
  'nex-agi/nex-n2.5-pro:free',
  'nex-agi/nex-n2.5-mini:free',
]

export const LIGHT_CHAIN = [
  'nex-agi/nex-n2.5-mini:free',
  'cohere/north-mini-code:free',
  'nex-agi/nex-n2.5-pro:free',
]

const REPORT_FINDINGS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'report_findings',
    description: 'Report the summary, actionable items, and suggested follow-ups for the page or question.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'A concise summary or answer.' },
        actionable_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'e.g. deadline, price, red_flag, contact' },
              label: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['type', 'label'],
          },
        },
        suggested_followups: {
          type: 'array',
          description: 'At most 3. Concrete next questions/actions this specific content makes obvious, not generic ones.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Shown to the user as a tappable chip.' },
              prompt: { type: 'string', description: 'What to send back to the model if tapped.' },
            },
            required: ['label', 'prompt'],
          },
        },
      },
      required: ['summary'],
    },
  },
}

interface CallResult {
  summary: string
  actionableItems: ActionableItem[]
  followUps: FollowUp[]
}

async function callOpenRouter(
  apiKey: string,
  models: string[],
  messages: unknown[],
): Promise<CallResult> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Required by OpenRouter for attribution/rate-limit purposes.
      'HTTP-Referer': 'https://github.com/page-copilot',
      'X-Title': 'Page Copilot',
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
    // Model ignored tool_choice (happens on some free models) — fall back
    // to treating the raw text content as the summary.
    const content = data.choices?.[0]?.message?.content ?? ''
    return { summary: content, actionableItems: [], followUps: [] }
  }

  const args = JSON.parse(toolCall.function.arguments)
  return {
    summary: args.summary ?? '',
    actionableItems: (args.actionable_items ?? []).map((a: any) => ({
      type: a.type,
      label: a.label,
      detail: a.detail,
    })),
    followUps: (args.suggested_followups ?? []).slice(0, 3).map((f: any) => ({
      label: f.label,
      prompt: f.prompt,
    })),
  }
}

function languageInstruction(outputLanguage: string): string {
  if (!outputLanguage) return ''
  return ` Respond in ${outputLanguage}, regardless of what language the source content is in.`
}

/** First message of a thread: summarize a freshly extracted page (text + up to 5 images). */
export async function summarizePage(
  page: ExtractedPage,
  opts: { apiKey: string; outputLanguage: string },
): Promise<CallResult> {
  const content: unknown[] = [
    {
      type: 'text',
      text:
        `Page title: ${page.title}\nURL: ${page.url}\n\n` +
        `Summarize this page and pull out anything actionable — deadlines, prices, red flags, ` +
        `things worth noticing that aren't just restating the page.${languageInstruction(opts.outputLanguage)}\n\n` +
        `Page content:\n${page.text}`,
    },
  ]

  // Sending the remote URL directly — most OpenRouter providers fetch it
  // server-side. If a chosen free model can't reach a given host (auth-gated
  // images, some CDNs), switch this to fetching the bytes and sending a
  // base64 data: URI instead — more reliable, more code. See README.
  for (const img of page.images.slice(0, 5)) {
    content.push({ type: 'image_url', image_url: { url: img.src } })
  }

  return callOpenRouter(opts.apiKey, HEAVY_CHAIN, [{ role: 'user', content }])
}

/** Continuing an existing thread — no new page extraction, so the lighter chain is enough. */
export async function askFollowUp(
  priorMessages: ChatMessage[],
  userMessage: string,
  opts: { apiKey: string; outputLanguage: string },
): Promise<CallResult> {
  const messages = [
    ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage + languageInstruction(opts.outputLanguage) },
  ]
  return callOpenRouter(opts.apiKey, LIGHT_CHAIN, messages)
}
