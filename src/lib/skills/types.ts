export interface Skill {
  id: string
  label: string
  matches(url: string): boolean
  /** Appended to the base prompt when this skill matches. Empty for the generic fallback. */
  instructions: string
}
