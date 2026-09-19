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

export function parseFindingsArgs(args: any): ProviderResult {
  return {
    summary: args.summary ?? '',
    actionableItems: (args.actionable_items ?? []).map((a: any) => ({ type: a.type, label: a.label, detail: a.detail })),
    followUps: (args.suggested_followups ?? []).slice(0, 3).map((f: any) => ({ label: f.label, prompt: f.prompt })),
  }
}

export function buildPageIntro(page: ExtractedPage): string {
  return (
    `Page title: ${page.title}\nURL: ${page.url}\n\n` +
    `Summarize this page and pull out anything actionable — deadlines, prices, red flags, ` +
    `things worth noticing that aren't just restating the page.`
  )
}
