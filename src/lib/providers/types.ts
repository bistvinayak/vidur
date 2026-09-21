import { selectSkill } from '../skills'
import type { ActionableItem, ChatMessage, ExtractedPage, FollowUp } from '../types'

export interface ProviderCallOpts {
  outputLanguage: string
}

export interface ProviderResult {
  summary: string
  actionableItems: ActionableItem[]
  followUps: FollowUp[]
}

/** Every provider adapter (OpenRouter, Anthropic, OpenAI) implements this. */
export interface ModelProvider {
  summarizePage(page: ExtractedPage, opts: ProviderCallOpts): Promise<ProviderResult>
  askFollowUp(priorMessages: ChatMessage[], userMessage: string, opts: ProviderCallOpts): Promise<ProviderResult>
}

const REQUEST_TIMEOUT_MS = 45_000

/**
 * Every provider call goes through this. Without it, a stalled connection or
 * an overloaded free-tier model just hangs forever with no error — the panel
 * sits on "Thinking…"/"Summarizing…" indefinitely, which is a much worse
 * failure mode than a clear "it timed out, try again" a few seconds later.
 */
export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s — the model may be overloaded. Try again, or switch models in Settings.`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export function languageInstruction(outputLanguage: string): string {
  if (!outputLanguage) return ''
  return ` Respond in ${outputLanguage}, regardless of what language the source content is in.`
}

/** Shared tool schema all three providers ask for, just wrapped differently per API. */
export const REPORT_FINDINGS_SCHEMA = {
  type: 'object' as const,
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
}

const MAX_SUMMARY_LENGTH = 4000

/**
 * Some free/reasoning models emit their chain-of-thought and self-correction
 * text as literal <think>/<tool_call> tags that aren't always fully stripped
 * by a provider's tool-calling normalization before reaching us — seen in
 * practice on a dense LinkedIn search-results page that pushed a model into
 * runaway, repetitive generation instead of a clean structured response.
 * This is the one place all three providers' output passes through before
 * a summary reaches the UI, so it's where that gets caught, not per-provider.
 */
export function sanitizeSummaryText(text: string): string {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?tool_call>/gi, '')
    .trim()

  if (!cleaned) {
    throw new Error('The model returned an empty or malformed response — try again, or switch models in Settings.')
  }
  if (cleaned.length > MAX_SUMMARY_LENGTH) {
    // A wall of text this long past a hard prompt instruction to be concise
    // is a sign of degenerate/runaway generation, not a legitimately long
    // summary — truncate rather than dump it all into the chat.
    return cleaned.slice(0, MAX_SUMMARY_LENGTH) + '\n\n[Truncated — the model\'s response ran unusually long, which can mean it struggled with this page. Try again or switch models if this keeps happening.]'
  }
  return cleaned
}

export function parseFindingsArgs(args: any): ProviderResult {
  return {
    summary: sanitizeSummaryText(args.summary ?? ''),
    actionableItems: (args.actionable_items ?? []).map((a: any) => ({ type: a.type, label: a.label, detail: a.detail })),
    followUps: (args.suggested_followups ?? []).slice(0, 3).map((f: any) => ({ label: f.label, prompt: f.prompt })),
  }
}

export function buildPageIntro(page: ExtractedPage): string {
  const skill = selectSkill(page.url)
  const base =
    `Page title: ${page.title}\nURL: ${page.url}\n\n` +
    `Summarize this page and pull out anything actionable — deadlines, prices, red flags, ` +
    `things worth noticing that aren't just restating the page. The summary must be under ` +
    `120 words — a hard limit, not a suggestion. If the page has little real content, say so ` +
    `briefly rather than padding the summary by restating the same point in different words. ` +
    `Synthesize, don't enumerate every item if this is a list or search-results page; call out ` +
    `the few things that actually matter instead.`
  return skill.instructions ? `${base}\n\n${skill.instructions}` : base
}
