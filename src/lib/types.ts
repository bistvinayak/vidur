export interface ActionableItem {
  type: string // e.g. "deadline", "price", "red_flag", "contact"
  label: string
  detail?: string
}

export interface FollowUp {
  label: string
  prompt: string // what gets sent back to the model if the user taps this
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  actionableItems?: ActionableItem[]
  followUps?: FollowUp[]
  createdAt: number
}

export interface Thread {
  id: string // derived from URL
  url: string
  title: string
  domain: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  skillLabel?: string // e.g. "Job posting" — which src/lib/skills/ entry matched this URL
}

export interface ExtractedPage {
  url: string
  title: string
  text: string
  images: { src: string; alt: string }[]
}

export type Provider = 'openrouter' | 'anthropic' | 'openai'

export interface FreeModelOption {
  id: string
  label: string
  recommended?: boolean
  note: string
}

// Curated from OpenRouter's free-tier roster — see src/lib/providers/openrouter.ts
// for why these specifically (vision + tool-calling support). This list
// rotates on OpenRouter's side; update here if one gets pulled entirely.
export const OPENROUTER_FREE_MODELS: FreeModelOption[] = [
  {
    id: 'inclusionai/ling-3.0-flash-vl:free',
    label: 'Ling 3.0 Flash VL',
    recommended: true,
    note: 'Vision + tool calling, 262K context — best overall fit for this extension.',
  },
  { id: 'nex-agi/nex-n2.5-pro:free', label: 'Nex N2.5 Pro', note: 'Vision + tool calling, 262K context.' },
  { id: 'nex-agi/nex-n2.5-mini:free', label: 'Nex N2.5 Mini', note: 'Lighter/faster version of the above.' },
  {
    id: 'thinkingmachines/inkling:free',
    label: 'Inkling',
    note: 'Vision, huge 1.05M context, but no tool calling — actionable items are parsed from text instead.',
  },
  {
    id: 'cohere/north-mini-code:free',
    label: 'North Mini Code',
    note: 'Tool calling, no vision — image reading falls back to text-only for that page.',
  },
]

export const ANTHROPIC_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', note: 'Fastest, cheapest — good default for a per-page task.' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', recommended: true, note: 'Best balance of quality and cost.' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', note: 'Most capable, priciest — for the hardest pages.' },
]

export const OPENAI_MODELS = [
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', recommended: true, note: 'Cheapest — good default for a per-page task.' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', note: 'Flagship — better quality, higher cost.' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', note: 'Most capable, priciest.' },
]

export interface Settings {
  provider: Provider

  openrouterApiKey: string
  openrouterModel: string // one of OPENROUTER_FREE_MODELS[].id — tried first, other free models fall back after it

  anthropicApiKey: string
  anthropicModel: string

  openaiApiKey: string
  openaiModel: string

  outputLanguage: string // e.g. "English", "Hindi", "Spanish" — empty = match source
  blockedDomains: string[] // domains the extension should never read
}
