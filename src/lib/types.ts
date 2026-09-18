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
}

export interface ExtractedPage {
  url: string
  title: string
  text: string
  images: { src: string; alt: string }[]
}

export interface Settings {
  openrouterApiKey: string
  outputLanguage: string // e.g. "English", "Hindi", "Spanish" — empty = match source
  blockedDomains: string[] // domains the extension should never read
}
