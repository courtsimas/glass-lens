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

## Install

From npm:

```sh
npm install glass-lens
```

Or load it straight from a CDN — no install, no build:

```html
<script src="https://unpkg.com/glass-lens"></script>
```

## Usage

```html
<script src="https://unpkg.com/glass-lens"></script>
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
via `module.exports` under CommonJS (`const GlassLens = require("glass-lens")`). For ESM
projects, import it and grab the global, or wrap it — it's one file with no dependencies, so
vendoring the script directly works just as well.

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

- `moveTo(x, y, clampRect?)` — move the lens center (px, relative to the target). rAF-throttled.
  Pass a viewport-space `clampRect` (e.g. from `getBoundingClientRect`) to keep the whole lens
  inside it; the `follow` option does this automatically against the followed element.
- `set(options)` — update any option. Shape options (`width`, `height`, `radius`, `depth`,
  `curvature`) regenerate the displacement map; `strength` and `chroma` only rebuild the filter
  graph; everything else is a cheap reposition.
- `refresh()` — force a clean re-render without rebuilding the filter graph (a cheap id swap).
  Call it when the *target's own content* changed but the lens didn't move — e.g. content scrolling
  under a static lens — so an engine that caches filter output by id repaints against the new pixels.
- `destroy()` — remove the filter, overlay, and listeners.

### Recipe: glass on a segmented control

The pointer-follow demo is eye-catching, but the more useful pattern is a *static* lens pinned to
a real component — a glass pill that glides between segments on select, the way native iOS does it.
Drop the `follow` option, size the lens to one segment, and animate `moveTo` on change. The target
is the whole control, so the glass refracts the control's own pixels and every button stays
clickable. (See it live in the [demo](https://courtsimas.github.io/glass-lens/).)

```js
const control = document.querySelector("#segmented");
const tabs = [...control.querySelectorAll(".seg")];

// a static frosted pill — note: no `follow`
const lens = new GlassLens(control, { strength: 0.11, frost: 0.12, tint: "#ffffff" });

// segment geometry in coordinates relative to the control
const geom = (tab) => {
  const c = control.getBoundingClientRect();
  const b = tab.getBoundingClientRect();
  return { x: b.left - c.left + b.width / 2, y: b.top - c.top + b.height / 2, w: b.width, h: b.height };
};

// size the pill to a segment, then snap it onto the active tab
const g = geom(tabs[0]);
lens.set({ width: g.w, height: g.h, radius: g.h / 2 });
lens.moveTo(geom(control.querySelector(".is-active")).x, g.y);

// ease it across on select (filter + specular highlight move together)
tabs.forEach((tab) => tab.addEventListener("click", () => {
  tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
  const startX = lens.x, dx = geom(tab).x - startX, cy = geom(tab).y, t0 = performance.now();
  const step = (now) => {
    const t = Math.min((now - t0) / 480, 1);
    lens.moveTo(startX + dx * (1 - Math.pow(1 - t, 3)), cy);  // easeOutCubic
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));
```

Give the track some texture (a gradient, not a flat fill) — refraction only reads when there's
something under the glass worth bending.

### Recipe: glass nav over a scrolling page

Because the lens refracts an element's *own* pixels (not the backdrop behind it), a "glass nav that
refracts the page scrolling behind it" is built by flipping the usual setup: make the **scroll
container** the target, pin a **static lens** to the top of it, and lay the nav labels as a crisp
overlay on top. As the content scrolls inside the container, the top strip refracts whatever passes
under it. Call `refresh()` on scroll so the refraction tracks the moving content.

```js
const scroller = document.querySelector("#page");   // overflow:auto, fixed height
const lens = new GlassLens(scroller, {
  width: scroller.clientWidth - 32, height: 56, radius: 28,
  x: scroller.clientWidth / 2, y: 44,               // a bar pinned at the top
  strength: 0.12, frost: 0.1, tint: "#ffffff",
});
scroller.addEventListener("scroll", () => {
  // rAF-throttle in real code
  lens.refresh();
}, { passive: true });
```

**Does this scale to a big, heavy page?** No — and that's important. A CSS `filter: url()` on a
large scroll container makes the browser rasterize that element's whole content to feed the filter
(on the CPU, for ordinary HTML), and that cost scales with the *content's* size and complexity, not
with the small visible bar. It's off the compositor's fast scroll path, and `contain` /
`content-visibility` can't scope it (a filter must read pixels outside the visible strip). It's fine
for a **bounded panel** like the demo, but not for a full, heavy production page. For that:

- **Frosted (blur) nav, no refraction:** use CSS `backdrop-filter: blur()` (with `-webkit-` for
  Safari). It's compositor-level, cross-browser Baseline, and scales because it only filters the
  small backdrop under the bar — not the whole document. glass-lens isn't needed for that look.
- **Refraction on a heavy page:** keep the filtered element *small*. Apply the lens to a fixed-size
  strip the height of the nav (optionally a scroll-synced clone of the slice behind it) so the
  rasterized buffer stays bar-sized regardless of page length.

## How it works

1. **The map.** A small PNG is generated on a canvas from the lens's shape: the red channel
   encodes horizontal displacement, green vertical, with 128 as neutral, and the alpha channel
   carries the anti-aliased rounded-rect coverage, which is used as the lens's shape mask. The lens
   is a rounded-rect signed-distance field with a configurable falloff from the rim. The map has
   four-fold symmetry, so only the top-left quadrant is computed; the rest is mirrored with
   sign flips.

2. **The filter.** The map enters an SVG filter through `feImage` (data URL), is composited
   over a neutral-gray `feFlood`, and drives `feDisplacementMap` against `SourceGraphic` —
   the element's real rendered pixels. Nothing is sampled from behind the element; the
   content's own pixels move, which is why selection and clicks survive.

3. **The mask sandwich.** The displaced result is clipped to the lens's true rounded shape using
   the map's alpha channel (`feComposite operator="in"`), and an identically-shaped hole is punched
   in the original (`feComposite operator="out"` against the same map). The two are composited
   back together, so the rounded edge of the fill and of the hole coincide — no seam. (An earlier
   version faked the rounded corners with a plain rectangle and relied on the map being a bit-exact
   no-op at the corners; older Chromium's `feDisplacementMap` doesn't treat neutral as an exact
   zero shift, so the square corners leaked. The explicit alpha mask removes that dependency.)

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
- **Fresh ID per update.** WebKit caches filter output by filter ID and will *not* repaint when
  only primitive subregion attributes change — so every reposition renames the filter and repoints
  `filter: url(#...)` (a cheap attribute swap, not a DOM rebuild) to force a clean repaint. This is
  what makes the lens track movement in Safari. If the *target's own content* changes underneath a
  static lens (e.g. scrolling) without the lens moving, call `refresh()` to re-mint and repaint
  against the new pixels.
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

One known WebKit caveat: Safari 26.2 and earlier can render the whole filter offset *below* the
lens and is markedly slower at the filter pipeline. WebKit fixed both in 26.4 ("Fixed tiling gaps
in CSS reference filters using `<feDisplacementMap>`" and "Improved drop-shadow and blur effects
rendering performance"), so the cross-browser-correct code here is right on 26.4+ — the fix for
affected users is to update Safari.

## Prior art

The displacement-map-via-`feImage` idea has a longer lineage in the post-WWDC25 liquid-glass
exploration by many authors; the cross-browser specifics here were worked out independently.

## License

MIT
