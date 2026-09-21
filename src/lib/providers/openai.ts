import type { ChatMessage, ExtractedPage } from '../types'
import {
  buildPageIntro,
  fetchWithTimeout,
  LOCATE_TARGET_SCHEMA,
  languageInstruction,
  parseFindingsArgs,
  parseLocateResult,
  REPORT_FINDINGS_SCHEMA,
  sanitizeSummaryText,
  type LocateResult,
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

const LOCATE_TARGET_TOOL = {
  type: 'function' as const,
  function: {
    name: 'locate_target',
    description: 'Identify the pixel location (as fractions of image size) of the UI element the instruction refers to.',
    parameters: LOCATE_TARGET_SCHEMA,
  },
}

async function callTool(
  apiKey: string,
  model: string,
  messages: unknown[],
  maxTokens: number,
  tool: { type: 'function'; function: { name: string; description: string; parameters: unknown } },
): Promise<{ args: any } | { rawContent: string }> {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: 'function', function: { name: tool.function.name } },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]
  if (!toolCall) {
    return { rawContent: data.choices?.[0]?.message?.content ?? '' }
  }
  try {
    return { args: JSON.parse(toolCall.function.arguments) }
  } catch {
    throw new Error('The model returned a malformed response — try again, or switch models in Settings.')
  }
}

async function callOpenAI(apiKey: string, model: string, messages: unknown[], maxTokens: number): Promise<ProviderResult> {
  const result = await callTool(apiKey, model, messages, maxTokens, REPORT_FINDINGS_TOOL)
  if ('rawContent' in result) {
    return { summary: sanitizeSummaryText(result.rawContent), actionableItems: [], followUps: [] }
  }
  return parseFindingsArgs(result.args)
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
      return callOpenAI(apiKey, model, [{ role: 'user', content }], 700)
    },

    async askFollowUp(priorMessages: ChatMessage[], userMessage: string, opts: ProviderCallOpts) {
      const messages = [
        ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage + languageInstruction(opts.outputLanguage) },
      ]
      return callOpenAI(apiKey, model, messages, 700)
    },

    async locateElement(screenshotDataUrl: string, instruction: string): Promise<LocateResult> {
      const content = [
        { type: 'text', text: `Find this in the screenshot: "${instruction}". Report its location as fractions of the image's width/height.` },
        { type: 'image_url', image_url: { url: screenshotDataUrl } },
      ]
      const result = await callTool(apiKey, model, [{ role: 'user', content }], 300, LOCATE_TARGET_TOOL)
      if ('rawContent' in result) return { found: false, xFraction: 0, yFraction: 0, description: '' }
      return parseLocateResult(result.args)
    },
  }
}
