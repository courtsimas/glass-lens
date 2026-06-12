# glass-lens

**Cross-browser glass refraction for live DOM.** One SVG filter bends the page's own rendered
pixels — text stays selectable, links stay clickable, straight through the lens. Works in
Chromium, Safari, and Firefox. Zero dependencies, no build step, no canvas, no WebGL, no flags.

Most "liquid glass" implementations on the web rely on `backdrop-filter: url(#svg-filter)`,
which only Chromium supports. This library takes a different route that works everywhere:
the filter is applied to the content itself with plain `filter: url()`, and every piece of
geometry inside the filter is expressed in `objectBoundingBox` fractions — the one unit system
every browser resolves correctly for SVG filter primitives on HTML elements.

## Demo

Serve the repo with any static server and open `index.html`:

```sh
npx serve
```

(Opening the file directly via `file://` works in most browsers too, but a server avoids
local-file quirks.)

## Usage

```html
<script src="src/glass-lens.js"></script>
<script>
  const lens = new GlassLens(document.querySelector("#card"), {
    width: 200,       // lens size, px
    height: 130,
    radius: 52,       // corner radius, px
    strength: 0.1,    // refraction amount (fraction of the target's bounding box)
    depth: 34,        // px from the rim over which the bend falls off
    curvature: 2.2,   // falloff exponent — higher hugs the rim tighter
    chroma: 0,        // > 0 adds chromatic fringing (3-pass, costs more)
    follow: document.querySelector("#stage"),  // optional: lens follows the pointer here
  });

  // or drive it yourself:
  lens.moveTo(x, y);          // px, relative to the target element
  lens.set({ radius: 80 });   // any option; shape changes regenerate the map
  lens.destroy();
</script>
```

The file is UMD-style: it attaches `GlassLens` to `window` in a plain script tag and exports
via `module.exports` under CommonJS. For ESM projects, import it and grab the global, or wrap
it — it's one file with no dependencies, vendoring is the intended distribution.

### Options

| Option      | Default | Description                                                        |
| ----------- | ------- | ------------------------------------------------------------------ |
| `width`     | `200`   | Lens width in px                                                   |
| `height`    | `130`   | Lens height in px                                                  |
| `radius`    | `52`    | Lens corner radius in px                                           |
| `strength`  | `0.1`   | Displacement scale, as a fraction of the target's bounding box. Clamped to a minimum of `0` |
| `depth`     | `34`    | Distance in px from the rim over which displacement falls to zero  |
| `curvature` | `2.2`   | Falloff exponent; higher concentrates the bend at the rim          |
| `chroma`    | `0`     | Spread between per-channel displacement scales; `0` disables the 3-pass chromatic fringe |
| `blur`      | `0`     | Gaussian blur of the refracted pixels, in px; `0` disables it      |
| `tint`      | `#ffffff` | Color overlay laid over the lens; any CSS color                  |
| `frost`     | `0`     | Opacity of the tint overlay, `0`–`1`; `0` disables it              |
| `x`, `y`    | —       | Initial lens center, px relative to the target                     |
| `surface`   | `true`  | Render the specular/rim-light overlay div                          |
| `follow`    | `null`  | Element; the lens tracks `pointermove` within it                   |

### Methods

- `moveTo(x, y)` — move the lens center (px, relative to the target). rAF-throttled.
- `set(options)` — update any option. Shape options (`width`, `height`, `radius`, `depth`,
  `curvature`) regenerate the displacement map; `strength` and `chroma` only rebuild the filter
  graph; everything else is a cheap reposition.
- `destroy()` — remove the filter, overlay, and listeners.

## How it works

1. **The map.** A small PNG is generated on a canvas from the lens's shape: the red channel
   encodes horizontal displacement, green vertical, with 128 as neutral, and the alpha channel
   carries the rounded-rect coverage (used as the shape mask when `blur` is on). The lens is a
   rounded-rect signed-distance field with a configurable falloff from the rim. The map has
   four-fold symmetry, so only the top-left quadrant is computed; the rest is mirrored with
   sign flips.

2. **The filter.** The map enters an SVG filter through `feImage` (data URL), is composited
   over a neutral-gray `feFlood`, and drives `feDisplacementMap` against `SourceGraphic` —
   the element's real rendered pixels. Nothing is sampled from behind the element; the
   content's own pixels move, which is why selection and clicks survive.

3. **The mask sandwich.** The displaced result is clipped to the lens subregion. A black
   `feFlood` of the same subregion punches a hole in the original (`feComposite operator="out"`),
   and the displaced result is composited back over the hole. The mask is a plain rectangle —
   the rounded corners come free, because the map is neutral at the corners, so displaced and
   original pixels are identical there and the seam is invisible.

4. **Movement is nearly free.** Sliding the lens updates the fractional subregion (x/y/width/
   height) of three primitives. The map itself never regenerates on movement, only on shape
   change.

## Cross-browser notes (read these before filing a bug)

These constraints are why the library is shaped the way it is — honor them and the effect
behaves identically in every browser.

- **`objectBoundingBox` everywhere.** Some engines cannot resolve `userSpaceOnUse` (pixel)
  geometry for filter primitives applied to HTML content — `feImage` silently renders nothing
  and primitive subregions invalidate the filter. Expressed in bounding-box fractions, the same
  primitives work everywhere. This single attribute is the difference between "Chromium-only
  demo" and "works in every browser."
- **Decode before attach.** A browser may resolve `feImage` at first paint; if the data-URL PNG
  hasn't decoded yet, it can cache an empty result against the filter ID and never re-read it.
  The library awaits `img.decode()` before the filter touches the DOM.
- **Fresh ID per update.** Browsers cache filter output by filter ID, including stale output
  when only primitive attributes change. Every update renames the filter and repoints
  `filter: url(#...)`. This is an attribute swap, not a DOM rebuild — it's cheap.
- **Source-graphic size ceiling.** Browsers limit how large a filtered element can be before
  they tile the output into mismatched blocks or drop the effect entirely. The limit is
  undocumented and varies by version and platform. Keep the refracted element modest — a card,
  a toolbar, a control — not the whole page.
- **No live `<video>`.** Browsers composite video on the GPU and never hand frames to the SVG
  filter pipeline. Glass over video needs a WebGL renderer reading the video as a texture;
  that's out of scope here.

## Browser support

Chromium, Firefox, and Safari (macOS and iOS), current releases. The technique degrades
loudly rather than gracefully in very old browsers (pre-GPU-filter-pipeline builds may render
the element without the effect); if you need to gate it, feature-detect with a 1×1 probe or
gate on `CSS.supports("filter", "url(#x)")` plus a version check.

## Prior art

The displacement-map-via-`feImage` idea has a longer lineage in the post-WWDC25 liquid-glass
exploration by many authors; the cross-browser specifics here were worked out independently.

## License

MIT
