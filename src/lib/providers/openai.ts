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

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'report_findings',
    description: 'Report the summary, actionable items, and suggested follow-ups for the page or question.',
    parameters: REPORT_FINDINGS_SCHEMA,
  },
}

async function callOpenAI(apiKey: string, model: string, messages: unknown[]): Promise<ProviderResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      tools: [TOOL],
      tool_choice: { type: 'function', function: { name: 'report_findings' } },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]
  if (!toolCall) {
    return { summary: data.choices?.[0]?.message?.content ?? '', actionableItems: [], followUps: [] }
  }
  return parseFindingsArgs(JSON.parse(toolCall.function.arguments))
}

export function createOpenAIProvider(apiKey: string, model: string): ModelProvider {
  return {
    async summarizePage(page: ExtractedPage, opts: ProviderCallOpts) {
      const content: unknown[] = [
        { type: 'text', text: buildPageIntro(page) + languageInstruction(opts.outputLanguage) + `\n\nPage content:\n${page.text}` },
      ]
      for (const img of page.images.slice(0, 5)) {
        content.push({ type: 'image_url', image_url: { url: img.src } })
      }
      return callOpenAI(apiKey, model, [{ role: 'user', content }])
    },

    async askFollowUp(priorMessages: ChatMessage[], userMessage: string, opts: ProviderCallOpts) {
      const messages = [
        ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage + languageInstruction(opts.outputLanguage) },
      ]
      return callOpenAI(apiKey, model, messages)
    },
  }
}
