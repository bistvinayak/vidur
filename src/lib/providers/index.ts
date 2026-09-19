import type { Settings } from '../types'
import { createAnthropicProvider } from './anthropic'
import { createOpenAIProvider } from './openai'
import { createOpenRouterProvider } from './openrouter'
import type { ModelProvider } from './types'

export type { ModelProvider, ProviderResult, ProviderCallOpts } from './types'

export function getProvider(settings: Settings): ModelProvider {
  switch (settings.provider) {
    case 'anthropic':
      if (!settings.anthropicApiKey) throw new Error('Add your Anthropic API key in Settings first.')
      return createAnthropicProvider(settings.anthropicApiKey, settings.anthropicModel)
    case 'openai':
      if (!settings.openaiApiKey) throw new Error('Add your OpenAI API key in Settings first.')
      return createOpenAIProvider(settings.openaiApiKey, settings.openaiModel)
    case 'openrouter':
    default:
      if (!settings.openrouterApiKey) throw new Error('Add your OpenRouter API key in Settings first.')
      return createOpenRouterProvider(settings.openrouterApiKey, settings.openrouterModel)
  }
}
