/** Shared between background/index.ts and the side panel — the message payload shapes for the click-action flow. */

export interface LocateActionResponse {
  ok: boolean
  found?: boolean
  x?: number // CSS pixels, already scaled to this tab's viewport — sent back for CONFIRM_ACTION_CLICK
  y?: number
  xFraction?: number // 0-1, for positioning a marker over the (possibly resized) screenshot in the UI
  yFraction?: number
  description?: string
  screenshotDataUrl?: string
  error?: string
}

export interface ConfirmActionResponse {
  ok: boolean
  error?: string
}
