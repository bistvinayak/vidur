import type { Skill } from './types'

export type { Skill } from './types'

/**
 * Routed by URL pattern, not a model call — free, instant, and deterministic
 * for the well-known cases. Add a new site type here as its own skill; the
 * generic fallback at the bottom of selectSkill() covers everything else.
 */
const SKILLS: Skill[] = [
  {
    id: 'job-posting',
    label: 'Job posting',
    matches: (url) => /linkedin\.com\/jobs\/view\//.test(url) || /indeed\.com\/(viewjob|vjk)/.test(url),
    instructions:
      'This is a job posting. Pull out: salary/comp range, location and remote/hybrid/onsite status, ' +
      'key requirements, and anything inconsistent or notable — a mismatched location, vague requirements, ' +
      'an unusually fresh or stale posting, applicant-count signals of urgency. Actionable items should ' +
      'cover salary, requirement gaps, and any red flags, not just a restatement of the role.',
  },
  {
    id: 'profile',
    label: 'Profile / portfolio',
    matches: (url) => /linkedin\.com\/in\//.test(url),
    instructions:
      "This is a person's profile or portfolio page. Summarize their background, skills, and notable " +
      'projects. If later asked about role fit, reason from their demonstrated skills and experience, ' +
      'not just job titles.',
  },
  {
    id: 'product',
    label: 'Product page',
    // Real Amazon URLs almost always have a title slug before /dp/, e.g.
    // amazon.com/Product-Name/dp/ASIN — so this checks the domain and the
    // path segment independently rather than requiring them adjacent.
    matches: (url) => /amazon\.[a-z.]+\//.test(url) && /\/(dp|gp\/product)\//.test(url),
    instructions:
      'This is a product page. Pull out: price, rating, and review-based signals — common complaints, ' +
      'red flags such as review patterns that look manipulated, and standout positives. Note shipping, ' +
      'return policy, or seller reputation if present.',
  },
  {
    id: 'search-results',
    label: 'Search / list results',
    matches: (url) => /\/(search|jobs\/search|results)(\?|\/|$)/.test(url) || /[?&]q=/.test(url),
    instructions:
      'This is a search-results or listing page with multiple items, not a single item. Do not ' +
      'enumerate every result. Identify the 2-4 most notable items — by relevance, price, rating, or ' +
      'recency — and synthesize what stands out across the set (patterns, outliers, gaps) rather than ' +
      'listing each one.',
  },
]

const GENERIC_SKILL: Skill = {
  id: 'generic',
  label: 'General page',
  matches: () => true,
  instructions: '',
}

export function selectSkill(url: string): Skill {
  return SKILLS.find((s) => s.matches(url)) ?? GENERIC_SKILL
}
