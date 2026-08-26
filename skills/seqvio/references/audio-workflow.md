# Audio Workflow

Use this reference when a composition needs narration, caption metadata, or audio-aligned scene timing.

## When to use it

Use the audio workflow when:

- the video needs voiceover
- scene duration should follow synthesized narration

Silent whiteboard renders can skip this flow entirely.

Hard-coded subtitle burn-in (`--burnCaptions`) is **not** part of the default narrated workflow. See [Caption burn-in (optional)](#caption-burn-in-optional) below.

## Authoring contract

For ExplainerDocument, author voice and visuals together in each scene:

1. declare spoken text in `explanation.cues`
2. anchor `explanation.beats` to exact phrases in those cues
3. point each Beat at stable visual target ids
4. compile the document so Seqvio emits narration and logical visual timing together

For hand-authored TSX, use the lower-level contract below.

In the composition TSX file:

1. declare narration cues in `meta.audio.narration`
2. set `sceneId` on each cue for multi-scene work
3. set `lockToAudio: true` when total duration should follow resolved audio

Example starting points:

- `examples/compositions/seqvio-overview-en.tsx`
- `examples/compositions/seqvio-overview-zh.tsx`
- `examples/compositions/seqvio-audio-demo.tsx`

## Step 1 — Extract manifest

```bash
node packages/renderer/dist/audio-cli.js extract \
  --component examples/compositions/seqvio-overview-en.tsx \
  --out output/seqvio-overview-en.manifest.json
```

This reads narration metadata from the composition and writes a manifest JSON file.

## Step 2 — Synthesize audio

Credentials are read from process environment variables. The CLI does not auto-load `.env`.

```bash
# macOS / Linux
export ELEVENLABS_API_KEY=your_key

# Windows (PowerShell)
# $env:ELEVENLABS_API_KEY="your_key"

node packages/renderer/dist/audio-cli.js synthesize \
  --provider elevenlabs \
  --manifest output/seqvio-overview-en.manifest.json \
  --outDir output/seqvio-overview-en-audio
```

The output directory contains:

- synthesized audio files
- `audio-manifest.resolved.json` with actual cue timings

## Language selection

Pass `--lang` and the voice follows from it. Do not leave the voice unset:
`EDGE_TTS_VOICE` defaults to `zh-CN-YunxiNeural`, so an English script comes out
read by a Mandarin voice, which sounds subtly wrong rather than obviously broken
and survives review.

```bash
node packages/renderer/dist/audio-cli.js synthesize   --provider edge-tts --lang pt-BR   --manifest output/x.manifest.json --outDir output/x-audio
```

Known tags: `en-US`, `en-GB`, `pt-BR`, `pt-PT`, `es-ES`, `es-MX`, `fr-FR`,
`de-DE`, `it-IT`, `nl-NL`, `ja-JP`, `ko-KR`, `zh-CN`, `zh-TW`, `hi-IN`, `ar-SA`,
`ru-RU`. Bare subtags (`pt`, `es`) resolve to the regional default. `--voice`
overrides `--lang`; `edge-tts --list-voices` is the full catalogue, and voices
ending `MultilingualNeural` keep one narrator across localised cuts.

### Localising a whole explainer

Translating the narration is the smaller half of the job:

1. **Re-time.** A translation is rarely the same length. Re-run extract and
   synthesize, read the new per-cue frame spans, and rescale every scene and
   child timing (see the retime step in `field-notes.md` item 5). Our pt-BR cut
   came out 192 frames shorter than the English one.
2. **Translate the on-screen text.** Labels are authored in the composition and
   the audio pipeline never touches them. Skip this and the video is bilingual:
   Portuguese narration over English labels.
3. **Localise formats too.** Thousands separators (`78,804` to `78.804`), decimal
   commas, and month abbreviations (`Aug 18` to `18 ago`) are part of the
   translation, not incidental.
4. **Check accents render.** The hand-drawn fonts do carry Latin accents, but
   verify a frame rather than assuming: a missing glyph shows as a box or a
   silently dropped mark.

## Provider selection

Default provider: `elevenlabs`

Supported providers:

| Provider | When to use |
| --- | --- |
| `elevenlabs` | Default; requires `ELEVENLABS_API_KEY` |
| `openai` | Requires `OPENAI_API_KEY` |
| `minimax` | Requires authenticated `mmx` CLI |
| `edge-tts` | Local CLI-based fallback |

If the preferred provider is unavailable, switch explicitly with `--provider` instead of stopping.

Common environment variables:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `OPENAI_API_KEY`
- `EDGE_TTS_VOICE`
- `EDGE_TTS_BIN`
- `SEQVIO_TTS_PROVIDER`

See [`.env.example`](../../../.env.example) for the full template.

## Step 3 — Render with resolved audio

```bash
node packages/renderer/dist/cli.js \
  --component examples/compositions/seqvio-overview-en.tsx \
  --output output/seqvio-overview-en.mp4 \
  --width 1280 \
  --height 720 \
  --fps 30 \
  --quality medium \
--audioManifest output/seqvio-overview-en-audio/audio-manifest.resolved.json
```

Important flags:

- `--audioManifest` — path to `audio-manifest.resolved.json` (required for narrated renders)

Do **not** add `--burnCaptions` unless you explicitly want hard-coded subtitles in the video frames. Voiceover is already muxed from the manifest; burned captions are a separate visual overlay.

## Subtitles (on by default)

`synthesize` segments narration into short, sentence-shaped subtitle cues and
writes them three ways:

- into `captions` in the resolved manifest, which the renderer burns in
- `captions.srt` and `captions.vtt` sidecars next to the audio, for platforms
  that take a subtitle upload

Segmentation matters: a narration cue is a whole spoken paragraph, and showing
one as a single caption covers a third of the frame. Cues are split at sentence
then clause boundaries to a default 84-character maximum, with each segment timed
proportionally inside the cue's own resolved window. Tune with
`--maxSubtitleChars`, or pass `--noSubtitleFiles` to skip the sidecars.

`seqvio-render` burns subtitles **by default** whenever caption cues exist. Pass
`--noBurnCaptions` for a clean image plus sidecar subtitles instead — the right
choice for YouTube or Bilibili, where the platform renders uploaded subtitles and
burnt-in text cannot be turned off or translated.

## Caption burn-in details

The overlay is a bottom-centred pill sized for one segmented line, not a
paragraph.

**Use `--burnCaptions` only when all of these apply:**

- You need silent autoplay with on-screen text (e.g. some social clips)
- Captions are **short lines**, not full narration paragraphs per scene
- The composition reserves bottom safe area (roughly the lower 140px)

**Do not use `--burnCaptions` when:**

- Publishing to YouTube, Bilibili, or similar — upload SRT/VTT separately instead
- Each scene cue is the full voiceover script (overlay will cover much of the frame)
- Whiteboard content extends into the lower third

Example (only when burn-in is intentional):

```bash
pnpm --filter @seqvio/renderer exec seqvio-render \
  --component ../../examples/compositions/seqvio-audio-demo.tsx \
  --output ../../output/caption-demo.mp4 \
  --width 1280 --height 720 --fps 30 --quality medium \
  --audioManifest ../../output/seqvio-audio-demo-audio/audio-manifest.resolved.json \
  --burnCaptions
```

## Audio-aligned timing rules

- Prefer one narration cue per scene or coherent spoken passage.
- Set `sceneId` on each cue in multi-scene compositions.
- After changing narration text, re-run extract and synthesize before rendering.
- ExplainerDocument `ExplanationBeat` timing is resolved automatically after
  synthesis. Inspect `explanationBeats`, `sceneTimings[].timeMap`, and QA rather
  than manually redistributing element frames.
- Every resolved Beat must have `outputFrame`; `resolutionError` means the anchor
  text or occurrence must be repaired and narration synthesized again.
- `low_confidence_explanation_beat` means whole-cue character timing was used.
  Split the cue, use a more specific phrase, or choose a provider with finer
  timing chunks when tighter alignment is required.
- Hand-authored TSX without ExplanationBeat metadata still requires manual visual
  timing against the resolved cue windows.

## Refreshing README demo videos

Tracked demo assets live in `docs/assets/videos/`, not `output/`.

After regenerating a narrated overview:

1. render to a temporary path under `output/`
2. copy the final MP4 into `docs/assets/videos/`
3. keep the source composition in `examples/compositions/`

## Troubleshooting

- Missing provider credentials: switch provider or export the required env vars
- Scene feels too short: check serialized whiteboard draw timing, not just authored `start`
- Voiceover missing: confirm `--audioManifest` points to `audio-manifest.resolved.json`
- Burned captions missing: only relevant if you intentionally passed `--burnCaptions`; otherwise upload subtitles on the target platform
- Bottom of frame obscured: you likely used `--burnCaptions` with long per-scene caption text — re-render without it

See [`docs/TROUBLESHOOTING.md`](../../../docs/TROUBLESHOOTING.md) for more detail.
