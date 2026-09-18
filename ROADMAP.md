# Roadmap

Captures everything scoped in planning beyond v1, in the order it was agreed
to make sense to build — later phases depend on earlier ones being solid,
not just being a wishlist.

## v2 — Connectors + real price search
- **Gmail connector via MCP**: draft-only by default, user reviews/sends —
  never auto-send. This is the trust-sensitive one; get it right before any
  other connector.
- **Price comparison follow-up** (the Amazon case): use a shopping-search
  API (Google Shopping / SerpAPI-style aggregator), not a live headless-browser
  crawl of individual retailers — near-instant vs. 10-30s/site, and avoids
  scraping ToS risk on other retailers. Design as a swappable `PriceSearchTool`
  so a real browsing agent can drop in later without touching the UI.

## v3 — Actions, not just suggestions
- Turn follow-up chips into real actions, tiered by consequence:
  - **Tier 1 (auto)**: read-only — search, filter, fetch more content
  - **Tier 2 (auto, but shown)**: reversible — fill a field, navigate, sort reviews
  - **Tier 3 (always confirm first)**: add to cart, submit a form, send email
- Start with a **whitelist of supported actions per site** (Amazon add-to-cart,
  Gmail send) rather than generic "find and click any element" — that's where
  these agents get flaky (wrong button, redesign breaks the selector).
- **Activity log + undo** where possible — non-negotiable once real actions
  are live, this is what makes "an agent that acts" trustworthy instead of
  scary.
- Voice: text-to-voice output, then voice input.

## v4 — Research index
- Cluster related threads into a "research topic" (semantic similarity +
  time proximity, not just domain).
- Cross-thread synthesis: "you've looked at 4 laptops this week — here's how
  this one compares," proactively surfaced when landing on a new page that
  matches an existing cluster.
- Start with keyword/tag retrieval; only add vector embeddings once keyword
  search visibly misses things.
- This index is also the intended interface for **Arjun integration** —
  Arjun queries this index rather than needing its own separate memory of
  what's been browsed.

## v5 — Accessibility variant
- Not a toggle on the main product — a separate front end on the same
  backend (summarization, actionable items, follow-ups are all reusable).
- **Blind/low-vision**: voice-first interaction. Follow-ups must be spoken as
  numbered options ("say 1 for…"), not tappable chips — the chip UI doesn't
  work if you can't see it.
- **Deaf/hard-of-hearing**: the gap isn't the UI, it's audio/video content on
  the page — needs transcription of embedded video/audio before summarizing.
- **Speech-impaired**: already served by text being a first-class mode, not
  an accessibility fallback — keep it that way if voice input becomes primary
  for the blind-user variant.

## Deferred, no strong opinion yet on sequencing
- Multi-tab / cross-page synthesis for one research session
- Digest mode (end-of-day rollup)
- Export a thread to Markdown/Notion
