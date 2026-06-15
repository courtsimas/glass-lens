/*!
 * glass-lens — cross-browser SVG refraction for live DOM
 * One SVG filter, real pixels, works in Chromium, Safari, and Firefox.
 * MIT License
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GlassLens = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const XLINK = "http://www.w3.org/1999/xlink";

  let instanceSeq = 0;

  const el = (name, attrs = {}) => {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  // Resolve any CSS color string to an rgba() with the given alpha, using the
  // browser's own normalization (handles hex, named, rgb, hsl).
  let _colorCtx;
  const toRGBA = (color, alpha) => {
    if (!_colorCtx) _colorCtx = document.createElement("canvas").getContext("2d");
    _colorCtx.fillStyle = color;
    const c = _colorCtx.fillStyle; // "#rrggbb" or "rgba(r, g, b, a)"
    const [r, g, b] = c[0] === "#"
      ? [c.slice(1, 3), c.slice(3, 5), c.slice(5, 7)].map((h) => parseInt(h, 16))
      : c.match(/\d+/g).map(Number);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  /**
   * Generate a rounded-rect lens displacement map as a PNG data URL.
   * R channel = horizontal shift, G = vertical, 128 = neutral.
   * Quadrant-symmetric: only a quarter of the pixels are computed.
   */
  function generateLensMap({ width, height, radius, depth, curvature }) {
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const hw = w / 2, hh = h / 2;
    const rad = Math.min(radius, hw, hh);

    const put = (x, y, dx, dy, a) => {
      const i = (y * w + x) * 4;
      d[i] = Math.round(128 + dx * 127);
      d[i + 1] = Math.round(128 + dy * 127);
      d[i + 2] = 128;
      d[i + 3] = a;
    };

    for (let y = 0; y < Math.ceil(h / 2); y++) {
      for (let x = 0; x < Math.ceil(w / 2); x++) {
        const px = x + 0.5 - hw, py = y + 0.5 - hh;
        const qx = Math.abs(px) - hw + rad, qy = Math.abs(py) - hh + rad;
        // signed distance to the rounded rect (negative inside)
        const dist = Math.min(Math.max(qx, qy), 0)
                   + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - rad;
        let dx = 0, dy = 0;
        if (dist < 0) {
          const t = Math.min(-dist / depth, 1);     // 0 at rim → 1 deep inside
          const m = Math.pow(1 - t, curvature);     // bend strongest at the rim
          const nx = px / hw, ny = py / hh;
          const len = Math.hypot(nx, ny) || 1;
          dx = -(nx / len) * m;
          dy = -(ny / len) * m;
        }
        // alpha carries the rounded-rect coverage (anti-aliased at the rim) —
        // the filter uses it as the lens shape mask when one is needed
        const a = Math.round(Math.max(0, Math.min(1, 0.5 - dist)) * 255);
        put(x, y, dx, dy, a);
        put(w - 1 - x, y, -dx, dy, a);
        put(x, h - 1 - y, dx, -dy, a);
        put(w - 1 - x, h - 1 - y, -dx, -dy, a);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  }

  const SURFACE_STYLE = {
    position: "absolute",
    top: "0",
    left: "0",
    pointerEvents: "none",
    willChange: "transform",
    background:
      "linear-gradient(135deg, rgba(255,255,255,.26) 0%, rgba(255,255,255,.05) 38%," +
      " rgba(255,255,255,0) 62%, rgba(255,255,255,.13) 100%)",
    boxShadow:
      "inset 0 0 0 1px rgba(255,255,255,.30), inset 1.5px 2px 3px rgba(255,255,255,.40)," +
      " inset -1.5px -2.5px 4px rgba(20,20,30,.14), 0 10px 30px rgba(0,0,0,.30)",
  };

  const DEFAULTS = {
    width: 200,        // lens width, px
    height: 130,       // lens height, px
    radius: 52,        // lens corner radius, px
    strength: 0.1,     // displacement scale in objectBoundingBox units (fraction of target bbox)
    depth: 34,         // px from the rim over which the bend falls off
    curvature: 2.2,    // falloff exponent — higher = bend hugs the rim
    chroma: 0,         // 0 = single pass; >0 = chromatic fringe via 3 passes
    blur: 0,           // gaussian blur of the refracted pixels, px (0 = none)
    tint: "#ffffff",   // color overlay laid over the lens (any CSS color)
    frost: 0,          // opacity of the tint overlay, 0..1 (0 = no overlay)
    x: 100,            // initial lens center, px relative to target
    y: 80,
    surface: true,     // render the specular/rim overlay div
    follow: null,      // an element; lens follows the pointer within it
  };

  class GlassLens {
    /**
     * @param {HTMLElement} target  element whose rendered content gets refracted
     * @param {Partial<typeof DEFAULTS>} options
     */
    constructor(target, options = {}) {
      this.target = target;
      this.opts = Object.assign({}, DEFAULTS, options);
      // Negative strength inverts the displacement; WebKit renders the inverted
      // bend with heavy artifacts, so it is clamped off across all browsers.
      if (this.opts.strength < 0) this.opts.strength = 0;
      this.x = this.opts.x;
      this.y = this.opts.y;

      this._uid = "glass-lens-" + (++instanceSeq);
      this._idSeq = 0;
      this._gen = 0;
      this._raf = null;
      this._filter = null;
      this._lensNodes = [];
      this._mapURL = null;
      this._bbox = { width: 1, height: 1 };
      this._destroyed = false;

      // hidden svg housing the filter
      this._svg = el("svg", { width: 0, height: 0, "aria-hidden": "true" });
      this._svg.style.position = "absolute";
      this._defs = el("defs");
      this._svg.appendChild(this._defs);
      document.body.appendChild(this._svg);

      // specular overlay
      if (this.opts.surface) {
        const parent = target.offsetParent || target.parentElement;
        if (parent && getComputedStyle(parent).position === "static")
          parent.style.position = "relative";
        this._surface = document.createElement("div");
        Object.assign(this._surface.style, SURFACE_STYLE);
        (parent || document.body).appendChild(this._surface);
      }

      this._ro = new ResizeObserver(() => this._measure(true));
      this._ro.observe(target);
      this._measure(false);

      if (this.opts.follow) {
        this._onMove = (e) => {
          const rect = this.opts.follow.getBoundingClientRect();
          const tRect = this.target.getBoundingClientRect();
          this.moveTo(
            e.clientX - tRect.left,
            e.clientY - tRect.top,
            rect // clamp within the follow element
          );
        };
        this.opts.follow.addEventListener("pointermove", this._onMove);
      }

      this._rebuildMap();
    }

    /**
     * Move the lens center to (x, y) in px relative to the target element.
     * If clampRect (a viewport-space rect, e.g. from getBoundingClientRect) is
     * given, the center is constrained so the whole lens stays inside it.
     * rAF-throttled.
     */
    moveTo(x, y, clampRect) {
      if (clampRect) {
        const { width, height } = this.opts;
        const t = this.target.getBoundingClientRect();
        x = Math.min(Math.max(x, clampRect.left - t.left + width / 2), clampRect.right - t.left - width / 2);
        y = Math.min(Math.max(y, clampRect.top - t.top + height / 2), clampRect.bottom - t.top - height / 2);
      }
      this.x = x;
      this.y = y;
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._position();
      });
    }

    /**
     * Update lens geometry / look. Shape options (width, height, radius, depth,
     * curvature) regenerate the map; strength and chroma only rebuild the filter.
     */
    set(options) {
      const shapeKeys = ["width", "height", "radius", "depth", "curvature"];
      const needsMap = shapeKeys.some((k) => k in options && options[k] !== this.opts[k]);
      Object.assign(this.opts, options);
      if (this.opts.strength < 0) this.opts.strength = 0;
      if (needsMap) this._rebuildMap();
      else if (this._mapURL) this._buildFilter();
    }

    /**
     * Force a clean re-render of the filter without rebuilding its graph.
     * Cheap (an id swap). Call it when the TARGET's own content changed but the
     * lens did not move — e.g. content scrolling under a static lens — so a
     * browser that caches filter output by id repaints against the new pixels.
     */
    refresh() {
      if (this._filter) this._mintId();
    }

    /** Remove the filter, overlay, and listeners. */
    destroy() {
      this._destroyed = true;
      this._ro.disconnect();
      if (this._onMove) this.opts.follow.removeEventListener("pointermove", this._onMove);
      if (this._raf) cancelAnimationFrame(this._raf);
      this.target.style.filter = "";
      this._svg.remove();
      if (this._surface) this._surface.remove();
    }

    // ---- internals -------------------------------------------------------

    _measure(reposition) {
      const r = this.target.getBoundingClientRect();
      this._bbox = { width: Math.max(r.width, 1), height: Math.max(r.height, 1) };
      if (reposition && this._mapURL) this._position();
    }

    _rebuildMap() {
      const url = generateLensMap(this.opts);
      const token = ++this._gen;
      const img = new Image();
      img.src = url;
      // Never attach the filter before the PNG decodes — a browser can cache
      // an empty feImage result against the filter ID.
      const ready = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
      ready.then(() => {
        if (this._destroyed || token !== this._gen) return;
        this._mapURL = url;
        this._buildFilter();
      });
    }

    /**
     * The filter graph. Every geometric value is in objectBoundingBox
     * fractions — the one unit system every browser resolves correctly for
     * filter primitives applied to HTML elements. (userSpaceOnUse px silently
     * breaks feImage and primitive subregions in some engines.)
     *
     *   feFlood(gray) ─┐
     *   feImage(map) ──┴→ composite → feDisplacementMap (lens subregion) → lensResult
     *   lensResult [→ feGaussianBlur] IN rawMap(alpha) → lensShaped
     *   SourceGraphic OUT rawMap(alpha) → holedSG
     *   lensShaped OVER holedSG → output
     */
    _buildFilter() {
      const { strength, chroma, blur } = this.opts;
      const f = el("filter", {
        filterUnits: "objectBoundingBox",
        primitiveUnits: "objectBoundingBox",
        "color-interpolation-filters": "sRGB",
        x: 0, y: 0, width: 1, height: 1,
      });
      this._lensNodes = [];
      const lensNode = (node) => { this._lensNodes.push(node); return node; };

      f.appendChild(el("feFlood", { "flood-color": "rgb(128,128,128)", "flood-opacity": 1, result: "mapBg" }));
      const im = lensNode(el("feImage", { preserveAspectRatio: "none", result: "rawMap" }));
      im.setAttribute("href", this._mapURL);
      im.setAttributeNS(XLINK, "xlink:href", this._mapURL);
      f.appendChild(im);
      f.appendChild(el("feComposite", { in: "rawMap", in2: "mapBg", operator: "over", result: "map" }));

      if (chroma > 0) {
        const passes = [["R", strength * (1 + chroma)], ["G", strength], ["B", strength * (1 - chroma)]];
        for (const [ch, scale] of passes) {
          f.appendChild(lensNode(el("feDisplacementMap", {
            in: "SourceGraphic", in2: "map", scale,
            xChannelSelector: "R", yChannelSelector: "G", result: "disp" + ch + "Raw",
          })));
          const ct = el("feComponentTransfer", { in: "disp" + ch + "Raw", result: "disp" + ch });
          for (const c2 of ["R", "G", "B"])
            ct.appendChild(el("feFunc" + c2, { type: "linear", slope: c2 === ch ? 1 : 0, intercept: 0 }));
          f.appendChild(ct);
        }
        f.appendChild(el("feComposite", { in: "dispR", in2: "dispG", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "rg" }));
        f.appendChild(el("feComposite", { in: "rg", in2: "dispB", operator: "arithmetic", k1: 0, k2: 1, k3: 1, k4: 0, result: "lensResult" }));
      } else {
        f.appendChild(lensNode(el("feDisplacementMap", {
          in: "SourceGraphic", in2: "map", scale: strength,
          xChannelSelector: "R", yChannelSelector: "G", result: "lensResult",
        })));
      }

      let lensOut = "lensResult";
      if (blur > 0) {
        // Blur the refracted pixels. The blur carries NO primitive subregion
        // (it is not a lensNode): older WebKit mis-positions an
        // objectBoundingBox subregion on feGaussianBlur and drops the output
        // below the lens. It inherits lensResult's region instead, and the
        // rounded clip below contains the halo. stdDeviation is normalized by
        // the bbox diagonal — the way objectBoundingBox primitiveUnits
        // actually resolves it — so the blur is isotropic, not stretched.
        const gb = el("feGaussianBlur", { in: "lensResult", result: "lensBlur" });
        const diag = Math.sqrt((this._bbox.width * this._bbox.width + this._bbox.height * this._bbox.height) / 2);
        gb.setAttribute("stdDeviation", blur / diag);
        f.appendChild(gb);
        lensOut = "lensBlur";
      }

      // Clip the lens to its true rounded shape using the map's alpha channel,
      // and punch an identically-shaped hole in the original. This single path
      // serves blur and non-blur alike. (The old non-blur "rectangle mask"
      // relied on the map being a bit-exact no-op at the corners so the square
      // subregion stayed invisible — but older Chromium's feDisplacementMap
      // does not treat neutral 128 as an exact zero shift, so the square
      // corners leaked. The explicit alpha mask removes that dependency.)
      f.appendChild(el("feComposite", { in: lensOut, in2: "rawMap", operator: "in", result: "lensShaped" }));
      f.appendChild(el("feComposite", { in: "SourceGraphic", in2: "rawMap", operator: "out", result: "holedSG" }));
      f.appendChild(el("feComposite", { in: "lensShaped", in2: "holedSG", operator: "over" }));

      this._defs.appendChild(f);
      if (this._filter) this._filter.remove();
      this._filter = f;
      this._position();
    }

    _position() {
      if (!this._filter) return;
      const { width, height, radius } = this.opts;
      const lx = this.x - width / 2, ly = this.y - height / 2;
      const fx = lx / this._bbox.width, fy = ly / this._bbox.height;
      const fw = width / this._bbox.width, fh = height / this._bbox.height;
      for (const n of this._lensNodes) {
        n.setAttribute("x", fx);
        n.setAttribute("y", fy);
        n.setAttribute("width", fw);
        n.setAttribute("height", fh);
      }
      if (this._surface) {
        const tRect = this.target.getBoundingClientRect();
        const pRect = (this.target.offsetParent || document.body).getBoundingClientRect();
        this._surface.style.width = width + "px";
        this._surface.style.height = height + "px";
        this._surface.style.borderRadius = Math.min(radius, width / 2, height / 2) + "px";
        this._surface.style.backgroundColor =
          this.opts.frost > 0 ? toRGBA(this.opts.tint, this.opts.frost) : "transparent";
        this._surface.style.transform =
          `translate(${lx + tRect.left - pRect.left}px, ${ly + tRect.top - pRect.top}px)`;
      }
      // WebKit caches filter output by id and will NOT repaint when only the
      // primitive subregion attributes change — so a fresh id per reposition is
      // required for the lens to track movement. (Yes, this re-renders the graph
      // each frame; it's the price of correct movement in Safari.)
      this._mintId();
    }

    // Browsers cache filter output by ID — including stale or pre-decode
    // results. A fresh ID per update forces a clean repaint everywhere.
    _mintId() {
      const id = this._uid + "-v" + (++this._idSeq);
      this._filter.setAttribute("id", id);
      this.target.style.filter = "url(#" + id + ")";
    }
  }

  GlassLens.generateLensMap = generateLensMap;
  return GlassLens;
});
