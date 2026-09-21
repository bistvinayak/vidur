# Vidur

A browser extension that summarizes the page you're on, surfaces what's actually
actionable, and suggests the next question — instead of just re-stating the page.

## What's in v1

- Click the Vidur toolbar icon on any page — that both opens the side panel and summarizes the page you were on. (This has to be the trigger, not a button inside an already-open panel — see "Why the toolbar icon, not a button" below.)
- Reads page text + up to 5 relevant images (filtered for size/position, not every icon on the page)
- Structured output: summary, actionable items (deadlines, prices, red flags…), and up to 3 follow-up chips tailored to what was actually found
- Each page gets its own conversation thread (by URL), browsable in History, with follow-up chat
- Output language setting (leave blank to match the source page)
- Per-domain block list as an explicit opt-out
- Runs on free OpenRouter models with automatic fallback chains — see `src/lib/providers/openrouter.ts`
- Every conversation is also mirrored to a **local web page** (`server/`) so it's browsable outside the side panel too — see "Local web viewer" below
- **Pick your own model provider** — OpenRouter (free), Claude, or GPT — from either the extension's Settings page or the web page's own settings, with a recommended default model per provider
- **Site-type skills** — a job posting, a LinkedIn profile, an Amazon product, and a search-results page each get a tailored prompt via free URL-pattern routing, not a second model call — see `src/lib/skills/`
- **Voice** — 🔊 read any message or the whole conversation aloud, 🎤 speak a follow-up instead of typing — native browser APIs, no extra cost
- **Copy/share** — copy any message or the whole conversation as plain text, on both the side panel and the web page
- **PDF support** — a `.pdf` tab gets its text extracted (via `pdfjs-dist`, workerless) and summarized the same way as any other page. See "PDF support" below for how this works and its one real limitation.
- **Reads content inside iframes**, not just the top frame — needed for sites (reading/annotation tools especially) that embed the actual document in a sub-frame

## Not in v1 (see ROADMAP.md)

Gmail connector, price-comparison search, DOM actions (add to cart, send email),
voice, the cross-thread research index, and Arjun integration are all scoped
but deliberately deferred — see ROADMAP.md for why and in what order.

## Setup

1. **Get an OpenRouter API key** — free account at https://openrouter.ai/keys
2. Install dependencies:
   ```
   npm install
   ```
3. Build the extension:
   ```
   npm run build
   ```
4. Load it in Chrome:
   - Go to `chrome://extensions`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked** → select the `dist/` folder
5. Click the Vidur icon once (panel opens, and it'll try to summarize whatever
   page you're on — this'll fail with "add your API key" the first time,
   that's expected). Open **Settings** (gear icon) and paste in your key.
6. Click the Vidur icon again on the page you want summarized.

## Why the toolbar icon, not a button inside the panel

The first version of this had a "Summarize this page" button inside the
side panel, which seemed natural but doesn't actually work reliably: Chrome's
`activeTab` permission is granted to *the specific tab that was active at the
exact moment you click the toolbar icon* — not to "whatever tab you're
currently looking at." Side panels are designed to stay open while you
switch tabs, so if you open the panel on tab A and then switch to tab B, a
button click inside the panel still only has permission for tab A, not B —
Chrome doesn't consider a click inside already-open extension UI a fresh
"invoke the extension" gesture. That's confirmed in
[Chrome's own activeTab docs](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

So the toolbar icon click is the one truly reliable trigger, and it now
does the summarizing directly (`chrome.action.onClicked` in
`src/background/index.ts`) rather than just opening the panel for a button
inside it to act later. The panel's own button still exists as a manual
re-run — it works as long as you haven't switched tabs since the last icon
click — but the icon is the trigger to reach for by default.

For live-reloading during development, `npm run dev` works with `@crxjs/vite-plugin`'s
HMR — reload the unpacked extension once after the first `npm run dev` start, then
most changes hot-reload without re-loading it.

## Local web viewer

`chrome.storage.local` (what the side panel reads from) is sandboxed to the
extension — a plain web page can't read it directly, even from `localhost`.
So the extension separately mirrors every thread to a tiny local server, and
a web page reads *that*:

```
npm run server
```

Then open **http://localhost:4300** in any regular tab — it lists every
conversation and updates every 5s as new ones come in from the extension.

- All data lives in `server/data/threads.json` — one plain folder on your
  machine, gitignored, nothing leaves your computer. Delete it to wipe history.
- The extension still works fully offline from this server — `chrome.storage.local`
  stays the source of truth; the push to `localhost:4300` is fire-and-forget
  and silently no-ops if the server isn't running.
- **Two-way**: you can reply to a thread and change Settings (provider, model,
  output language) directly from the web page. This works via
  `externally_connectable` in the manifest — the web page calls
  `chrome.runtime.sendMessage(EXTENSION_ID, ...)` straight to the background
  script (the same code path the side panel uses), not a second copy of the
  model-calling logic. The extension's ID is pinned via the `key` field in
  `manifest.config.ts` so it stays stable across reloads — see the comment
  there if you ever need to regenerate it.
- API keys never round-trip back to the web page in plain text — `GET_SETTINGS`
  redacts them to a `*Set: true/false` flag; the raw key only ever lives in
  `chrome.storage.local`, read directly (not via messaging) by the extension's
  own Settings page.
- Because the extension fetches/messages `localhost:4300`, that's the one
  `host_permissions` + `externally_connectable` entry in the manifest —
  everything else stays scoped to `activeTab`.

## Choosing a model provider

Both the extension's Settings (gear icon in the side panel) and the web
page's own Settings (gear icon top-left) let you pick:

- **OpenRouter (free)** — the default. Pick a specific free model (Ling 3.0
  Flash VL is recommended); the rest of the free roster is tried automatically
  as fallback if it's down. See `src/lib/types.ts` for the full list.
- **Claude (Anthropic)** or **GPT (OpenAI)** — bring your own paid API key.
  Useful once free-tier quality/rate-limits stop being enough for real use.

All three go through the same `ModelProvider` interface
(`src/lib/providers/`), so `src/background/index.ts` doesn't know or care
which one is active.

## PDF support

Chrome's own built-in PDF viewer isn't a normal web page, so the usual
DOM-scraping approach (`extractPageContent`) can't read it at all — a PDF
tab needs a completely different path:

1. When the active tab's URL ends in `.pdf`, a small script is injected into
   that tab (via `activeTab` + `scripting`, same permission as everything
   else — no new host access needed) that does `fetch(location.href)` from
   **inside the PDF's own document context**. That's same-origin and
   automatically carries the page's own session/cookies, which is why this
   doesn't need broader permissions even for a PDF behind a login.
2. The bytes come back to the background script, which parses them with
   `pdfjs-dist` running in its **legacy, workerless build** — confirmed by
   testing that pdfjs's default build assumes a browser environment an MV3
   service worker doesn't fully provide, and that service workers can't
   spawn the nested Worker pdfjs normally wants anyway. Loaded via dynamic
   `import()`, so its ~500KB only loads when a PDF is actually opened, not
   on every service worker cold start.
3. Extracted text feeds into the exact same summarization pipeline as any
   other page.

**The one real limitation, unresolved without live testing**: whether
Chrome allows script injection into its *own* built-in PDF viewer at all.
If it doesn't, step 1 fails with a clear error rather than a silent hang or
wrong result — but which way that goes needs testing in a real browser to
know for sure. A scanned PDF with no text layer (just images of pages) also
won't extract anything — that would need OCR, which isn't built yet.

## Why activeTab instead of `<all_urls>`

The manifest requests `activeTab` + `scripting`, not a blanket host permission.
That means the extension only ever touches the page you were on **when you
clicked it** — it can't read pages in the background, and Chrome Web Store
review is meaningfully lighter on extensions that don't ask for `<all_urls>`
up front.

## Known limitations to fix before this goes beyond your own machine

- **Image URLs are sent as-is to OpenRouter/OpenAI** rather than fetched and
  base64-encoded (the Anthropic adapter already does this properly — Claude's
  vision input requires it). Works for public images; will silently fail to
  "see" an image behind auth or certain CDNs on the other two providers.
- **The free-model list is hardcoded** in `src/lib/types.ts`
  (`OPENROUTER_FREE_MODELS`). OpenRouter's free roster changes often — if a
  model in the list gets pulled entirely (not just rate-limited), update it
  there. Worth moving to a small remote JSON config later so this doesn't
  require a new Chrome Web Store submission every time.
- **No rate-limit/retry backoff beyond what OpenRouter's `models` fallback
  already does** — if all three chain entries are down at once, the user just
  sees the error.
