# Vidur

A browser extension that summarizes the page you're on, surfaces what's actually
actionable, and suggests the next question — instead of just re-stating the page.

## What's in v1

- Click the toolbar icon → side panel opens → **Summarize this page**
- Reads page text + up to 5 relevant images (filtered for size/position, not every icon on the page)
- Structured output: summary, actionable items (deadlines, prices, red flags…), and up to 3 follow-up chips tailored to what was actually found
- Each page gets its own conversation thread (by URL), browsable in History, with follow-up chat
- Output language setting (leave blank to match the source page)
- Per-domain block list as an explicit opt-out
- Runs on free OpenRouter models with automatic fallback chains — see `src/lib/openrouter.ts`
- Every conversation is also mirrored to a **local web page** (`server/`) so it's browsable outside the side panel too — see "Local web viewer" below

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
5. Click the extension icon on any page, then open **Settings** (gear icon) and paste in your OpenRouter API key.
6. Click the extension icon again → **Summarize this page**.

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
- This is a **read-only mirror** for now — replying to a thread still only
  works from the side panel. Two-way sync (or moving storage entirely to the
  server) is a natural next step once this is worth doing.
- Because the extension fetches to `localhost:4300`, that's the one
  `host_permissions` entry in the manifest — everything else stays scoped to
  `activeTab`.

## Why activeTab instead of `<all_urls>`

The manifest requests `activeTab` + `scripting`, not a blanket host permission.
That means the extension only ever touches the page you were on **when you
clicked it** — it can't read pages in the background, and Chrome Web Store
review is meaningfully lighter on extensions that don't ask for `<all_urls>`
up front.

## Known limitations to fix before this goes beyond your own machine

- **Image URLs are sent as-is** to the model rather than fetched and base64-encoded.
  Works for public images; will silently fail to "see" an image behind auth or
  certain CDNs. Swap in a fetch-and-encode step in `src/lib/openrouter.ts` if
  that turns out to matter.
- **The free-model fallback chain is hardcoded** in `src/lib/openrouter.ts`.
  OpenRouter's free roster changes often — if a model in the list gets pulled
  entirely (not just rate-limited), update that file. Worth moving to a small
  remote JSON config later so this doesn't require a new Chrome Web Store
  submission every time.
- **No rate-limit/retry backoff beyond what OpenRouter's `models` fallback
  already does** — if all three chain entries are down at once, the user just
  sees the error.
