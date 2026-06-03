---
title: "From static slides to a postable video: finishing my LINE-style chat generator with GitHub Copilot"
published: false
tags: devchallenge, githubchallenge
cover_image: https://raw.githubusercontent.com/yama3133/line-chat-app/main/assets/cover.jpg
---

*This is a submission for the GitHub Finish-Up-A-Thon Challenge.*

## What I Built

A while back I built a small web tool that turns a block of conversation text into a vertical (9:16), iPhone-style **LINE chat** slide — with the message bubbles animating in one by one. It was made for talks: paste a conversation, download an animated `.pptx`, present it. I even wrote it up here on DEV.

But it always had a missing half. A `.pptx` is great on a projector and awkward everywhere else — you can't really post it. What I actually wanted, and never finished, was to turn the same conversation into a **video** I could drop into a social post, where the bubbles pop in like a chat happening live.

This challenge was the push to finish that. The app now exports the conversation as a vertical **mp4** (and webm), with bubbles fading in one at a time and a "typing…" indicator before each incoming message — all in the browser, no server involved.

## Demo

- **App:** https://line-chat-app-nine.vercel.app
- **Repo:** https://github.com/yama3133/line-chat-app

![A frame from an exported video — bubbles appear one by one, with a "typing…" indicator](https://raw.githubusercontent.com/yama3133/line-chat-app/main/assets/video-demo.jpg)

*The image above is a single frame; the real export is an animated **mp4 / GIF**. When posting on DEV, attach your exported mp4 or GIF here so it plays inline.*

## The Comeback Story

### Where it was
- pptx generation only (python-pptx + hand-written animation XML), already shipped and documented.
- There was an animated *preview* in the browser, but the only thing you could **save** was a pptx.
- The "export it as a video" idea sat untouched for months.

### What I added
1. **Rebuilt the LINE / iPhone UI on a `<canvas>`.** The pptx version draws with python-pptx shapes and the old browser preview was CSS — neither can be recorded as a video, so the UI had to be redrawn on canvas.
2. **Accurate bubble wrapping** with `ctx.measureText`, instead of the character-width guess the python version had to rely on.
3. **The one-by-one fade-in animation**, driven by a single `renderFrame(ctx, opts, t)` that draws the exact state at time `t` (the same function is reused for recording).
4. **Recording with `MediaRecorder`.** I expected to need ffmpeg.wasm for mp4 — but Chrome's MediaRecorder supports `video/mp4;codecs=avc1.42E01E` (H.264) directly, so mp4 comes out with no extra dependency.
5. **A reliability fix that surprised me:** a naive `requestAnimationFrame` record loop silently stalls when the tab isn't focused. I switched to `setTimeout` + `canvas.captureStream(0)` + `track.requestFrame()`, so recording keeps going even in a background tab.
6. **A "typing…" indicator** before each incoming bubble, for a more chat-like feel.

### Still on the list
- GIF export (handy for Slack / LINE) via ffmpeg.wasm or gif.js.

## My Experience with GitHub Copilot

I leaned on Copilot for the part that's tedious but well-defined: **drawing the LINE / iPhone UI on canvas**. The approach was comment-driven — I wrote each function's spec as a comment first, then let Copilot fill in the body:

```js
// Draw the phone frame (black, rounded) filling the logical area, then the
// inner screen (chat background) inset by L.phone.pad. Return {x, y, w, h}.
function drawPhoneFrame(ctx) { /* Copilot */ }
```

Where it shone:
- Repetitive shape code — the 4 signal bars, the 3-dot menu, the battery with its little nub — came out correct from a one-line comment.
- It picked up my existing constants (`V` for colors, `L` for layout) and reused them instead of hardcoding values.
- Asking it to implement all the `TODO(Copilot)` functions at once filled the whole UI layer in a single pass.

Where I took over: the bubble-wrapping math, the animation timing, and the background-recording fix were things I designed and wrote by hand.

The split that worked for me: **Copilot builds the UI scaffolding fast; I own the logic.** My one practical tip is to treat comments as the spec — the more precise the comment, the better the completion.
