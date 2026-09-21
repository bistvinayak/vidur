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

const TOOL = {
  name: 'report_findings',
  description: 'Report the summary, actionable items, and suggested follow-ups for the page or question.',
  input_schema: REPORT_FINDINGS_SCHEMA,
}

/**
 * Claude's vision input needs actual image bytes, not a URL — unlike the
 * OpenRouter path, which can often hand a provider a remote URL directly.
 */
async function fetchImageAsBase64(url: string): Promise<{ mediaType: string; data: string } | null> {
  try {
    const res = await fetchWithTimeout(url, {})
    if (!res.ok) return null
    const mediaType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0]
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return { mediaType, data: btoa(binary) }
  } catch {
    return null // page keeps working with text-only if one image fails to fetch
  }
}

async function callAnthropic(apiKey: string, model: string, messages: unknown[], maxTokens: number): Promise<ProviderResult> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'report_findings' },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Anthropic error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const toolUse = data.content?.find((b: any) => b.type === 'tool_use')
  if (!toolUse) {
    const text = data.content?.find((b: any) => b.type === 'text')?.text ?? ''
    return { summary: sanitizeSummaryText(text), actionableItems: [], followUps: [] }
  }
  return parseFindingsArgs(toolUse.input)
}

export function createAnthropicProvider(apiKey: string, model: string): ModelProvider {
  return {
    async summarizePage(page: ExtractedPage, opts: ProviderCallOpts) {
      const content: unknown[] = [
        { type: 'text', text: buildPageIntro(page) + languageInstruction(opts.outputLanguage) + `\n\nPage content:\n${page.text}` },
      ]
      for (const img of page.images.slice(0, 5)) {
        const encoded = await fetchImageAsBase64(img.src)
        if (encoded) {
          content.push({ type: 'image', source: { type: 'base64', media_type: encoded.mediaType, data: encoded.data } })
        }
      }
      return callAnthropic(apiKey, model, [{ role: 'user', content }], 700)
    },

    async askFollowUp(priorMessages: ChatMessage[], userMessage: string, opts: ProviderCallOpts) {
      const messages = [
        ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage + languageInstruction(opts.outputLanguage) },
      ]
      return callAnthropic(apiKey, model, messages, 700)
    },
  }
}
