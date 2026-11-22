# Image Parse-Archive-Reuse

Every image is **parsed once when it first enters the session and archived**; later requests never re-send image bytes — root-cause prevention of multimodal session wedges.

## Settings

- **Image pixel budget**: total pixel area (width×height); oversized images auto-downscale proportionally. Default 2048×2048 = the DSH official default.
- **Per-message describe cap**: the first N images per paste get machine descriptions, the rest archive only. Default 20 = the official cap.
- **Multi-image parse concurrency**: concurrent parses for a multi-image paste (1–8). Default 4.

Edits apply on Save; whenever a value differs from the official default, a Restore-default control appears at the field's top-right corner.

## Behavior

- Pasting archives in place: your message bubble stays **identical to native DSH** (text + thumbnail); the machine description rides a **collapsed parse-record row** (the official context-injection presentation; parsed via the session's currently selected model — non-multimodal models add no row, by design).
- On-demand re-view: the model can call `mm_view_image` to view an archived original (image-capable routes only).
- Saving the pixel budget applies it to every current pi-ai model route; Restore default also clears those per-route overrides.
- **Master switch = the toggle at this page's top-right (symmetric)**: on = takeover (absent pixel-budget rows auto-filled); off = automatic handover back to the official default (rows still equal to the plugin's applied value are cleared; divergent manual values survive); settings persist across toggles.
