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
  name: 'report_findings',
  description: 'Report the summary, actionable items, and suggested follow-ups for the page or question.',
  input_schema: REPORT_FINDINGS_SCHEMA,
}

const LOCATE_TARGET_TOOL = {
  name: 'locate_target',
  description: 'Identify the pixel location (as fractions of image size) of the UI element the instruction refers to.',
  input_schema: LOCATE_TARGET_SCHEMA,
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

/** A screenshot from chrome.tabs.captureVisibleTab is already a data: URL — the bytes are inline, no fetch needed. */
function parseDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Expected a data: URL screenshot.')
  return { mediaType: match[1], data: match[2] }
}

async function callTool(
  apiKey: string,
  model: string,
  messages: unknown[],
  maxTokens: number,
  tool: { name: string; description: string; input_schema: unknown },
): Promise<{ args: any } | { rawContent: string }> {
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
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Anthropic error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const toolUse = data.content?.find((b: any) => b.type === 'tool_use')
  if (!toolUse) {
    return { rawContent: data.content?.find((b: any) => b.type === 'text')?.text ?? '' }
  }
  return { args: toolUse.input }
}

async function callAnthropic(apiKey: string, model: string, messages: unknown[], maxTokens: number): Promise<ProviderResult> {
  const result = await callTool(apiKey, model, messages, maxTokens, REPORT_FINDINGS_TOOL)
  if ('rawContent' in result) {
    return { summary: sanitizeSummaryText(result.rawContent), actionableItems: [], followUps: [] }
  }
  return parseFindingsArgs(result.args)
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

    async locateElement(screenshotDataUrl: string, instruction: string): Promise<LocateResult> {
      const { mediaType, data } = parseDataUrl(screenshotDataUrl)
      const content = [
        { type: 'text', text: `Find this in the screenshot: "${instruction}". Report its location as fractions of the image's width/height.` },
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
      ]
      const result = await callTool(apiKey, model, [{ role: 'user', content }], 300, LOCATE_TARGET_TOOL)
      if ('rawContent' in result) return { found: false, xFraction: 0, yFraction: 0, description: '' }
      return parseLocateResult(result.args)
    },
  }
}
