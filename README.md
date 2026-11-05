# playmate

**18+ only.** An AI partner plugin for [playhound](https://github.com/whatmekota/playhound). She talks to you in a voice, drives your stroker through the conversation, and can run a whole session by herself: putting on scripted videos from your library, talking over them, and taking the motion back when they end.

Needs playhound **1.5.0** or newer (the desktop app; some parts need it to reach local servers).

## Install

In playhound: **Settings → Plugins**. playmate is in the plugin list there: click **Install**, then switch it on. To install by hand, download `playmate-<version>.zip` from [Releases](https://github.com/whatmekota/playmate/releases) and drop it on that page.

Then open its panel (the Plugins drawer on the right), and set it up in Settings → Plugins → playmate.

## What it needs

- **A brain:** any OpenAI-compatible `chat/completions` endpoint.
  - A local model in **LM Studio** (default `http://127.0.0.1:1234/v1`). Nothing leaves your PC.
  - Or a cloud API with your key. There are presets for abliteration.ai, Venice, OpenRouter, DeepSeek, Groq, Together, Mistral and xAI, or you can enter a custom URL.
- **A voice** (optional): [Fish Audio](https://fish.audio) with your Fish API key. The free `s2.1-pro-free` model works. Voices are public Fish library voices, picked by id, link or search. Without a voice, replies show as text and the movement still happens.
- **Speech input** (optional): hold **T** (or the mic button) and talk. The speech can go to Venice, an OpenAI-compatible transcription API (Groq, OpenAI…), Fish Audio (needs paid credit), a whisper server with `/asr`, or whisper running inside playhound on your GPU. That last option is a one-time model download; after it, nothing leaves your PC.

## How she moves you

Her replies carry small tags that playhound turns into motion when the sentence they're in starts playing. They're shown as pills in the log:

| Tag | Does |
|---|---|
| `[speed N]`, `[depth N]`, `[move S D]` | strokes per minute, stroke length in % |
| `[pos low\|mid\|high]` | where the stroke sits |
| `[shape sine\|ease\|pulse\|saw\|sharp]` | the stroke's shape |
| `[edge]` / `[stop]` | a sudden stop and hold, or just hold still |
| `[more N]` | make the session N minutes longer (when you ask her to) |
| `[play WHAT]` | put on a video (see below) |
| `[end]` | end the session |

Everything stays inside your limits: her own movement limits in the settings, and playhound's speed ceiling on top of them. **Esc** (panic) stops everything, and the safe word (`red` by default) makes her stop and check in.

**Lead mode** lets her run the session: she speaks up when you're quiet, builds it up and winds it down. You can ask her for more time.

## Your library (off by default)

With **Let her pick videos** on, she can put on scripted videos from your library: `[play intense]`, `[play came]` (what you finished to before), `[play new]`, `[play maplestar gentle]`… Matching uses the whole library, whatever its size. While a video plays, its script drives the device and she talks over it: when a hard part is coming, when it eases off.

**Let her see the video** (experimental, off by default) lets you show her the screen with the camera button, or let her turns carry a snapshot. It needs a brain that takes images (abliteration's `abliterated-model-large-flash` does).

**Privacy:** with a cloud brain, what you write, her character, the library overview and the titles she puts on, and any snapshots all go to that service. With a local brain they stay on your PC.

## Characters

Two out of the box, the same character in two languages: **Maki (EN)** and **Маки** (Russian). Edit them in the panel under **Prompts**, add your own, and give each a voice and a language. The main prompt (shared by all characters) is editable too. The technical rules (tags, format) are separate and fixed, so editing the text can't break them.

## Build

    npm install
    npm run build          # dist/index.js and playmate.zip, for your own use
    npm run build:public   # release/playmate-<version>.zip and release/manifest.json
    npm test
    npm run typecheck

`npm run build` bakes any keys in a local `.env` (`VENICE_API_KEY`, `ABLITERATION_API_KEY`, `FISH_API_KEY`) into `playmate.zip` as built-in keys, which is handy for your own copy. **Never share that zip.** `build:public` ignores `.env`.

## Licence

MIT. Use and share it at your own risk; it's adult software that moves a device.
