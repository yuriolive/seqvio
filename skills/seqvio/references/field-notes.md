# Field Notes

Failure modes observed on real runs, with the fix. Read this before authoring or
rendering. Each entry cost a wasted render cycle to discover.

---

## 1. The published npm renderer cannot render (v0.8.1)

`npm install -g @seqvio/renderer@latest` installs a CLI whose `--help`,
`seqvio-doctor`, and argument parsing all work — then every render fails at the
bundling step:

```
Could not resolve ".../node_modules/@seqvio/renderer/src/browser/runtime.tsx"
```

Cause: `bundle-scene.js` resolves `<packageRoot>/src/browser/runtime.tsx`, but the
published tarball declares `"files": ["dist"]`, so `src/` is never shipped.

**Do not debug the composition when you see this.** It is a packaging bug and it
fails identically for every input. Use a repository checkout instead:

```bash
git clone https://github.com/makesynt/seqvio.git
cd seqvio && npm ci && npm run build
node packages/renderer/dist/cli.js --component <path> --output <path> ...
```

`seqvio-doctor` does **not** catch this — it reports `node-pty` missing and
otherwise passes, so a green-ish doctor report is not evidence that render works.
The only real smoke test is an actual short render.

Related: `node-pty` is missing from the global install too. It is only needed for
terminal capture, so silent and narrated whiteboard renders work without it.

## 2. Always pass `--width` / `--height` matching the composition

The CLI defaults to **1920x1080** regardless of what the composition declares.
A 1280x720 `WhiteboardScene` rendered without explicit flags is pinned to the
top-left of a 1920x1080 frame, and the unused area is not blank — stray strokes
and guide-like marks appear in it, which reads as a rendering bug in the scene
itself.

Always pass the composition's own dimensions explicitly:

```bash
--width 1280 --height 720 --fps 30
```

## 3. `--preset preview` is unusable for anything with text

`preview` is `pixelRatio: 1` + JPEG q80. Handwriting-style fonts blur into
illegibility at 1x. It is fine for checking layout and timing structure, and
useless for judging or delivering a text-bearing frame.

- structural check / does-it-run: `--preset preview`
- anything a human reads or reviews: `--preset final` (pixelRatio 2, PNG)

Do not send a `preview` render for review and expect meaningful feedback about
content.

## 4. Under `excalidrawTheme`, never put text inside a shape

`DrawShape` `rectangle` / `rounded-rectangle` / `circle` receive a dense roughjs
**hachure fill** even with `fillColor="none"`. The existing docs call this
"faint" — it is not. It is high-contrast diagonal crosshatch that renders text
placed inside the shape unreadable.

Consequences for authoring:

- **Never** place `DrawText` inside a themed `DrawShape` as a "box with a label".
  Color the text itself, or attach the label outside the shape edge.
- The fill is an **asset** for data marks: hachure-filled `rectangle`s make
  excellent hand-drawn **bar chart bars**, and filled small `circle`s make good
  scatter points and graph nodes. Use it deliberately there.
- `rounded-rectangle` additionally mis-jitters at some seeds, producing a long
  stray curve across the frame. Prefer `rectangle` when a box is needed.

## 5. Narration length drives total duration — retime the visuals to match

`meta.duration` and `Scene duration` are **fallbacks only**. With
`--audioManifest`, resolved narration timings override them, and total duration
becomes the max of base duration and cue ends.

The failure this produces: visuals choreographed over 296 frames, narration
resolving to 1355 frames, and a video that finishes drawing in 10 seconds then
holds one static frame for 35 seconds while the voice keeps talking. The render
succeeds and reports no problem.

Correct order of operations:

1. Author the composition with placeholder scene durations.
2. `extract`, then `synthesize`.
3. Read the resolved manifest and get the **actual** per-cue frame spans:

```bash
node -e "const m=require('<abs path>/audio-manifest.resolved.json');
m.narration.forEach(n=>console.log(n.sceneId||n.id, n.startFrame, '->', n.endFrame))"
```

4. Set each `Scene duration` to its cue length, `meta.duration` to the sum, and
   **scale every child `start`/`duration` inside each scene** so the drawing
   fills roughly 85% of that scene's window.
5. Render.

Note the resolved manifest's top-level `duration` field may disagree with the sum
of its own cue spans; trust the cue `startFrame`/`endFrame` values.

When scaling child timings programmatically, remember that computed expressions
(`start={62 + i * 22}`) are not plain numeric literals and will be missed by a
naive regex pass. Grep for `i \*` afterwards.

## 6. `edge-tts` on Windows needs an explicit `EDGE_TTS_BIN`

`edge-tts` is the no-API-key fallback provider and it works, but
`pip install --user edge-tts` puts the binary somewhere not on PATH, and the
path is not the one `site.USER_BASE` suggests:

```
C:\Users\<user>\AppData\Roaming\Python\Python313\Scripts\edge-tts.exe
```

(note the `PythonXYZ` segment). Locate it and export explicitly:

```bash
export EDGE_TTS_BIN="/c/Users/<user>/AppData/Roaming/Python/Python313/Scripts/edge-tts.exe"
```

## 7. Probe frames before committing to a full render

A `--preset final` render of ~3,500 frames takes ~5 minutes single-worker. Do not
discover a text collision at the end of it.

Render a 3-frame window at the **end** of each scene (when that scene is at its
most crowded), extract a still, and look at it:

```bash
node packages/renderer/dist/cli.js --component <c> --output output/p.mp4 \
  --width 1280 --height 720 --startFrame <sceneEnd-8> --endFrame <sceneEnd-6> \
  --preset standard --audioManifest <resolved.json>
ffmpeg -y -i output/p.mp4 -vframes 1 output/probe.png
```

Check specifically for: labels overlapping data marks, arrows crossing text, and
annotations colliding with a threshold line. These are invisible in the source
and obvious in the frame.

Use `--workers 4` on the final full render.

## 8. The visual vocabulary is small — plan around it

Actual primitives available in `@seqvio/whiteboard`:

- `DrawShape` types: `circle`, `rectangle`, `rounded-rectangle`, `arrow`, `line`,
  `underline`, `star` (seven, and that is all)
- `DrawIcon` names: `check`, `cross`, `arrow-right`, `arrow-down`, `circle`,
  `star`, `lightbulb`, `heart`, `plus`, `minus`, `play`, `document` (twelve)
- `DrawText`, `DrawImage`, `Hand`

There is no built-in robot, server, database, cloud, or person icon. Custom
inline `<path>` art bypasses the theme entirely (stays smooth, no jitter) unless
you run each `d` through roughjs with a **fixed** per-stroke seed.

This is enough for genuinely visual work if you compose from data-diagram forms
rather than looking for an icon per concept:

- magnitude / change over time -> bar chart: `line` axis + `rectangle` bars
  (hachure fill is the bar fill) + labels **below** the axis + an `arrow`
  callout on the outlier
- one-to-many / spread / fan-out -> few large `circle` sources, `arrow`s
  radiating to a grid of small `circle`s, count annotated at the fan mouth
- threshold / why a rule missed -> scatter against a rule line: two `line` axes,
  a colored `line` as the threshold, `circle` points placed above and below it,
  `check` / `cross` icons for the verdict
- conjunction of conditions -> condition labels on the left, `arrow`s converging
  into one `circle` junction, single `arrow` out to the verdict
- disjunction / either-path -> two labeled paths, `arrow`s merging into one node,
  `arrow` out, `underline` on the result

Add `<Hand action="write" follow visible />` to every scene. The pen following
the active stroke is most of what makes output read as a whiteboard video rather
than animated slides.

## 9. Text-only output is the default failure, and it is on you

Left alone, the natural output of this framework is centered `DrawText` lines
appearing in sequence — a slide deck with handwriting. Nothing in the render
pipeline warns about it and every gate passes.

Before rendering, count: if the composition is more than roughly 60% `DrawText`
by element count, and has no axis, no data marks, and no arrows connecting
things, it is a text deck. Redesign it against the forms in item 8 and the
"Scene-level visual metaphors" section of `production-techniques.md` — one
distinct metaphor per scene, never the same layout twice.
