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

## 4. The "hachure fill" was a bug in `roughOptions`, now fixed

Hand-drawn shapes used to render as dense diagonal crosshatch that ignored
`fillColor="none"`, made text inside a shape unreadable, and sent the following
pen skating across the frame. It was never a theme behaviour or a roughjs quirk
to work around — it was one line:

```ts
// packages/whiteboard/src/utils/roughPath.ts
fill: 'none',   // roughjs reads fill as a COLOUR; 'none' means "please fill"
```

roughjs emitted a `fillSketch` set of hachure lines, identical to what
`fill: 'red'` produces, and `drawableToPathD` concatenated every set — fill
sketch included — into the single `d` that gets stroked. So the crosshatch was
fill geometry being drawn as outline. For a 500x220 rectangle:

| options | path segments | positional jumps |
| --- | --- | --- |
| `fill: 'none'` | 532 | 264 (up to 546px, the shape diagonal) |
| `fill` omitted | 8 | 3 |

The fix omits `fill` and filters non-stroke sets out of `drawableToPathD`.
If you are on a build that predates it, verify with:

```bash
node -e "const g=require('roughjs/bundled/rough.cjs.js').generator();
const d=g.toPaths(g.rectangle(0,0,500,220,{seed:42,fill:'none'})).map(p=>p.d).join(' ');
console.log('M count:', (d.match(/M/g)||[]).length)"
```

Above ~10 means the bug is present.

Still true regardless:

- **Prefer labels outside the shape.** A filled shape behind text is a contrast
  risk even when the fill is clean; put the label above or beside the shape, or
  colour the text itself.
- **Fills need a backing element, not path fill.** A jittered outline is a set of
  disconnected edge strokes, not one closed subpath, so `fill` painted on the
  path renders nothing usable. `DrawShape` draws a plain `<circle>` / `<rect>`
  behind the stroke for `circle` and rect types. Any new fillable shape type
  needs the same treatment.
- `rounded-rectangle` can still mis-jitter at some seeds, producing a stray
  curve. Prefer `rectangle` when a plain box is needed.

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

## 10. If the pen spins or skates, suspect path geometry, not the Hand

`Hand` places the pencil at the stroke head by sampling `getPointAtLength` and a
tangent on the registered path. A hand-drawn path is not one continuous stroke:
roughjs draws each edge as its own sub-stroke, so even a clean rectangle outline
has a few genuine pen-up gaps, and a buggy one had hundreds (item 4).
`getPointAtLength` walks straight through those gaps as though they were stroke.

Two consequences, both fixed in `getStrokeHeadOnPath`:

- A tangent sampled across a gap reports the direction of the *jump*, not of the
  stroke, so the pencil snapped to a meaningless angle and back every few frames.
  The tangent is now averaged over only the contiguous run of samples containing
  the head; walking outward stops at the first gap.
- When the head sits exactly on a gap there is no direction at all. The function
  returns `penUp: true` and `Hand` holds its previous angle instead of snapping.

When the pen still looks wrong, measure the geometry before touching `Hand`:
count `M` commands and real positional jumps in the generated `d`. A shape whose
outline has more than a handful of jumps is a geometry bug upstream.

`Hand` keeps rotation in a `useRef` across frames, which is safe under
`--workers N` only because a fresh worker sees `drawId === null`, treats the
frame as a draw change, and snaps straight to the true angle rather than lerping
up from zero. Preserve that branch if you refactor the smoothing.
