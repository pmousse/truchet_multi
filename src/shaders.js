/* ============================= shaders.js =============================
 * Animated WebGL fields: the ground the Truchet tiles sit on, and the paint the
 * tiles themselves can be drawn with.
 *
 * WHY A SEPARATE CANVAS. The tiles are drawn on #mainCanvas, which is 2D. A
 * field that lived on that canvas would have to be repainted into the
 * background of every tile and would then be sampled by the Fill tab's ink
 * flood - a per-tile ground, which is not a ground at all. So the field is its
 * own full-frame WebGL canvas stacked under the tiles, sized by the same
 * framePx() the 2D pass uses, and the picture's "under" colour turns into real
 * transparency (rgba(0,0,0,0), which canvas composites rather than paints) so
 * the field reads through the ink instead of replacing it.
 *
 * WHY EVERY BODY LOOPS. Each body writes its time as u_time / u_loop * TAU and
 * then uses whole harmonics of that phase - never a raw multiple of time. Two
 * reasons. A raw t is not periodic: a wrapped clock would pop when the counter
 * restarts, and a field whose noise drifts without bound slides instead of
 * breathing. And phase terms keep the float precision good however long the
 * page stays open. The rule has teeth: a hue drift is only seamless if it moves
 * by whole palette cycles per loop (cosPal has period 1), which is why the
 * slowest drift here is exactly one rotation, and why 'cells' does not drift
 * its hues at all - it moves instead. The payoff is that every ground here is
 * a seamless loop, so a recording of it tiles in time as well as on the canvas.
 *
 * WHY THE PALETTE MIX EXISTS. A field with colours of its own fights the ink:
 * Carlson's pictures get their unity from a small colour set. u_mix folds the
 * field onto the picture's own ramp (u_a is the picture's ink end, u_b its
 * ground), so the ground can be *of* the picture rather than merely behind it.
 * At 0% the field keeps its own palette; at 100% it is painted only with the
 * picture's colours. That is what makes 'wash' possible, and what stops a busy
 * field from turning a five-colour pattern into a rainbow. The fold maps the
 * field's own lightness onto the ramp, so the spread the pattern reads against
 * survives folding: a field that spans a tenth of the lightness it has spans a
 * tenth of the ramp it is folded onto. An earlier version chose the ramp
 * position from the field's red channel instead, and a whole frame of the
 * picture's two colours came out five times flatter than the field that went in
 * - the flattening this dial exists to avoid, caused by the dial itself. And the
 * ramp is walked in its own lightness order - dark end to light end, whichever
 * uniform each end happens to be - rather than from u_a to u_b, because on a
 * palette whose ink end is the dark one, walking u_a to u_b returned the field
 * with its light currents turned dark. A fold may recolour a ground; it may not
 * invert it.
 *
 * WHY THE SCRIM EXISTS. A field can still outshine the pattern laid on it. The
 * naive fix - dim toward black - only helps one polarity of ink: it quiets the
 * field under a light ink and buries a dark ink in the same field. u_scrim pulls
 * the field toward u_b instead, the frame's own background colour, which is the
 * end of the palette the ink is defined against, so it always moves the field
 * away from the ink and never into a dead grey. At 0% the field is at full
 * voice; at 100% it is the picture's own ground, still moving, only quieter.
 *
 * WHY THE SAME BODIES CAN ALSO PAINT THE INK. The ink role hands a body a mask
 * instead of a frame: the engine draws the tiles exactly as it always did, into a
 * 2D canvas, and that canvas arrives as u_mask with the ink's colour in rgb and its
 * coverage in alpha. The body then contributes hue only - chroma() throws away the
 * field's brightness and atLightness() gives the colour back the lightness the ink
 * already had. That split is the whole design. A field's *colour* is decoration and
 * can be swapped freely; its *lightness* is what a 3-pixel line is visible by, and a
 * field that paints lightness into a line of its own choosing can brighten a stroke
 * into the ground it was drawn to stand against, which is not an uglier line but no
 * line. So on the ink the shape is never drawn by the field - it is poured into -
 * and u_mix says how much of the field's colour is allowed while the ink keeps its
 * own lightness. u_relief is the one dial that lets the field touch lightness, and it
 * is measured along the gap between the ink and the ground rather than in the
 * abstract: relief 30 means this pixel of ink may move three tenths of the way it
 * already has toward the ground, no further, in either direction. A dial in absolute
 * luminance units cannot make that promise for a light ink and a dark ink at the
 * same time.
 *
 * WHY BODIES ARE FUNCTIONS AND NOT MAINS. Every body is `vec3 field(vec2 p, float t)`
 * and the module supplies main(). The body computes a colour; who gets to decide the
 * alpha is the module, because the ground is opaque and the ink is coverage - the same
 * field, two jobs, one body, no body free to write an alpha that breaks the role it is
 * being used in.
 * ===================================================================== */
(function () {
  'use strict';

  /* Shared preamble every body gets: the uniforms, and the helpers a field
   * wants (IQ cosine palettes, value noise, fBm, hashes). Bodies are GLSL ES
   * 1.00 - constant loop bounds only, no dynamic arrays. */
  const COMMON = `
precision highp float;
uniform float u_time;   /* seconds, always inside [0, u_loop) */
uniform float u_loop;   /* this body's own cycle length */
uniform vec2  u_res;
uniform float u_scale;  /* field size across the short side of the frame */
uniform float u_seed;
uniform float u_mix;      /* 0..1, how much the field borrows the palette */
uniform float u_scrim;    /* ground only: how much ground colour is laid over it */
uniform float u_relief;   /* ink only: see the ink main */
uniform vec3  u_a;      /* the picture's light ink */
uniform vec3  u_b;      /* the picture's ground */
uniform sampler2D u_mask;  /* ink only: the ink itself, rgb its colour, a its coverage */
uniform sampler2D u_shape;  /* a frame standing on a shape: r its coverage, g its distance */
uniform float u_hasShape;   /* 0 when it is not: see shapeDist */

#define TAU 6.28318530718

/* Loop phase. Bodies write motion as whole harmonics of this and nothing else,
 * which is what makes the field line up with itself when the clock wraps. */
float ph() { return u_time / u_loop * TAU; }

/* Frame coordinates centred on the frame, aspect-corrected so a blob is round
 * rather than an ellipse, then scaled by the user's field scale. The short side
 * of the frame spans 1.0 world units. */
vec2 frameUV() {
  float m = min(u_res.x, u_res.y);
  return (gl_FragCoord.xy - 0.5 * u_res) / m * u_scale;
}

/* The shape's own coordinates. The shape arrives as a canvas painted through the
 * very transform the tiles were drawn with (fitTransform in src/app.js), so it
 * lines up with them pixel for pixel and is sampled the way the ink mask is -
 * WebGL puts (0,0) at the bottom of the frame and a canvas is measured from the
 * top. Because the sampling is the frame's own, nothing here can get the aspect,
 * the crop or the fit wrong: the shape was already placed by the code that placed
 * the tiles. */
vec2 shapeUV() {
  return vec2(gl_FragCoord.x / u_res.x, 1.0 - gl_FragCoord.y / u_res.y);
}

/**
 * Distance from the shape's contour, in fractions of the shape's short side:
 * positive inside, negative outside, 0 exactly on the outline - the unit
 * src/fill.js measures it in, so a rim asked for at 7% is 7% of the shape at any
 * mask size and any fit.
 *
 * Where the frame stands on no shape - the Generator and Photo tabs - the
 * frame's own edge stands in, in the same unit, because a frame is a shape too
 * and a field should not fall over when nobody asked for one. That fallback is
 * measured on the frame's pixels rather than on frameUV so the field scale cannot
 * move it: where the edge of the picture is geometry, and the dial that sizes the
 * pattern has no business changing it.
 */
float shapeDist() {
  /* src/fill.js packs the distance as 0.5 + 0.5*d into one 8-bit channel, so the
   * reading has to be doubled back before it means anything. */
  if (u_hasShape > 0.5) return 2.0 * (texture2D(u_shape, shapeUV()).g - 0.5);
  float m = min(u_res.x, u_res.y);
  vec2 q = (gl_FragCoord.xy - 0.5 * u_res) / m;
  vec2 hw = 0.5 * vec2(u_res.x / m, 1.0);
  return min(hw.x - abs(q.x), hw.y - abs(q.y));
}

/* 1 on the contour, falling to 0 w of the short side away on either side. */
float shapeRim(float w) {
  return 1.0 - clamp(abs(shapeDist()) / max(w, 1e-4), 0.0, 1.0);
}

/* How much of a point is inside the shape, ramping across the outline the way the
 * tiling's own coverage does. A frame with no shape is all of it, since there is
 * nothing there to be outside of. */
float shapeCov() {
  if (u_hasShape > 0.5) return clamp(texture2D(u_shape, shapeUV()).r, 0.0, 1.0);
  return 1.0;
}

/* How far in you are, measured inward from the contour: 0 at the outline, rising
 * toward the middle of the shape. Outside a contour it is 0, which is the point. */
float shapeDepth() { return clamp(shapeDist(), 0.0, 1.0); }

vec3 cosPal(float t) {
  return 0.5 + 0.5 * cos(TAU * (vec3(1.0) * t + vec3(0.0, 0.33, 0.67)));
}

/* Saturate without clipping to blocks: muddy mid-tones where two colours meet
 * are the usual failure of a weighted colour blend. */
vec3 boost(vec3 c, float k) { return clamp((c - 0.5) * k + 0.5, 0.0, 1.0); }

float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  /* A smoothstep edge rather than fwidth: constant at every resolution, so the
   * preview and a 6000 px export agree field for field. */
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.02 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float lum(vec3 c) { return dot(clamp(c, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722)); }

/* A colour's hue and saturation with its brightness thrown away: dividing by the
 * brightest channel leaves the ratios, and the ratios are what hue is. */
vec3 chroma(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return c / max(max(c.r, max(c.g, c.b)), 1e-4);
}

/* Give a colour a requested lightness by scaling its channels, which leaves the
 * ratios - the hue - alone. This is how a field contributes colour to ink without
 * contributing its brightness: the ink keeps the lightness the pattern was designed
 * with, which is the half of the colour the shape is actually read from. A field
 * colour with no ratios to scale (pure black) has no hue to offer either, so it
 * falls back to a flat lightness rather than dividing by zero. */
vec3 atLightness(vec3 c, float L) {
  float l = lum(c);
  if (l < 1e-4) return vec3(clamp(L, 0.0, 1.0));
  vec3 s = clamp(c * (clamp(L, 0.0, 1.0) / l), 0.0, 1.0);
  /* Scaling cannot always reach the lightness it was asked for. A saturated colour
   * hits the ceiling on one channel long before its average brightness gets there -
   * a pure red can be scaled to a luminance of about 0.21 and no further - so the
   * remainder is added flat. That costs a little saturation at the extremes, which
   * is the honest trade: the promise the ink's lightness dial makes is about
   * lightness, and without this the promise is quietly broken by as much as a
   * fifth of the frame's range. */
  return clamp(s + (clamp(L, 0.0, 1.0) - lum(s)), 0.0, 1.0);
}

/* The tail every body runs through.
 *   u_scrim the frame's own ground colour, blended back over the whole field.
 *   u_mix   the field's colours folded onto the picture's ramp. The fold maps
 *           the field's own lightness onto the ramp, which is what keeps the
 *           spread the pattern reads against: a field whose lightness spans a
 *           tenth of the frame keeps a tenth of the ramp. An earlier version
 *           picked the ramp position from a hash of the field's red channel, so
 *           the same field came out of the fold five times flatter than it went
 *           in - the flattening this dial was supposed to avoid, not cause.
 *           Mapping by lightness also makes the fold independent of how a body
 *           happens to name its channels, which a per-body colour map is not. */
vec3 finish(vec3 c) {
  c = mix(clamp(c, 0.0, 1.0), clamp(u_b, 0.0, 1.0), clamp(u_scrim, 0.0, 1.0));
  if (u_mix > 0.0) {
    float L = clamp(dot(clamp(c, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    /* The ramp is walked in its own lightness order, whichever end of the
     * picture's palette happens to be the light one, so the fold can never turn
     * a field inside out. Mapping straight from u_a to u_b did exactly that on a
     * palette whose ink end is the dark end: the field's light currents came back
     * as its dark ones, which is a broken ground however well coloured it is. */
    float la = dot(clamp(u_a, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
    float lb = dot(clamp(u_b, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
    vec3 darkEnd = la < lb ? u_a : u_b;
    vec3 litEnd = la < lb ? u_b : u_a;
    return mix(c, mix(darkEnd, litEnd, L), u_mix);
  }
  return c;
}
`;

  /* A field is one function over the whole frame, never a function of a tile:
   * that is the request, and the reason this is a shader on a canvas of its own
   * rather than a pattern drawn inside each cell. */
  const SHADERS = [
    {
      key: 'mesh',
      label: 'mesh gradient — soft airbrushed colour field',
      loop: 90,
      src: `
/* Six colour sources on circular paths, each contributing a Gaussian weight,
 * blended by weight rather than by boundary - which is what makes it read as
 * one field with no seams. The weights are deliberately wide and each source is
 * spread far around the palette cycle: narrow weights or nearby hues blend to
 * grey, which was this shader's first failure. */
vec3 field(vec2 p, float t) {
  vec3 sum = vec3(0.0);
  float tot = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    /* A source rides a circle in frame space, so it is exactly back where it
     * started when the loop closes. */
    vec2 c = vec2(
      1.2 * cos(t + fi * 1.7 + hash1(fi + u_seed * 7.0) * TAU),
      0.95 * sin(t + fi * 2.3 + hash1(fi * 3.0 + u_seed * 11.0) * TAU));
    float d = length(p - c);
    float w = exp(-d * d * (0.9 + 0.6 * hash1(fi * 5.0)));
    sum += w * boost(cosPal(fi * 0.19 + t / TAU
             + hash1(fi + u_seed * 13.0) * 0.3), 1.5);
    tot += w;
  }
  /* t/TAU runs 0..1 over the loop: one full palette rotation, the slowest
   * drift that is still seamless. */
  vec3 col = boost(sum / max(tot, 1e-4), 1.5);
  col = clamp((col - 0.5) * 1.2 + 0.5, 0.0, 1.0);
  col += 0.05 * (fbm(p * 3.0 + 0.6 * vec2(cos(t), sin(t))) - 0.5);  /* airbrush grain */
  col = pow(clamp(col, 0.0, 1.0), vec3(0.9));
  return col;
}`
    },
    {
      key: 'plasma',
      label: 'plasma — warped sine field, cycling colours',
      loop: 30,
      src: `
vec3 field(vec2 p, float t) {
  float v = sin(p.x * 2.0 + t * 3.0)
          + sin(p.y * 3.0 - t * 2.0)
          + sin((p.x + p.y) * 2.4 + t * 2.0)
          + sin(length(p) * 3.5 - t * 3.0);
  vec3 col = boost(cosPal(v * 0.13 + t / TAU + u_seed), 1.15);
  col *= 0.88 + 0.24 * sin(v * 0.9 + t * 2.0);
  return col;
}`
    },
    {
      key: 'aurora',
      label: 'aurora — dark field with flowing luminous curtains',
      loop: 60,
      src: `
vec3 field(vec2 p, float t) {
  /* The noise space rides a circle rather than sliding, so the curtains fold
   * back on themselves instead of scrolling off the frame. */
  vec2 flow = 0.6 * vec2(cos(t), sin(t));
  float fold = fbm(p * 0.8 + vec2(flow.x, flow.y * 0.5));
  float band = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float curtain = fbm(p * vec2(0.9, 1.6)
                      + vec2(fi * 1.9 + flow.x, fi * 0.4 - flow.y));
    /* cubed, not squared: the curtains have to stay thin against the dark or
     * the whole frame fills with glow and the field stops reading as night. */
    curtain = pow(clamp(curtain, 0.0, 1.0), 3.0);
    band += curtain * (0.45 + 0.4 * sin(t * 2.0 + u_seed * 6.0 + fi * 1.7));
  }
  vec3 sky = boost(cosPal(0.55 + u_seed + fold * 0.12), 1.1) * 0.12;
  vec3 glow = boost(cosPal(0.05 * fold + t / TAU + 0.35 + u_seed), 1.4);
  vec3 col = sky + glow * band * 1.25;
  return col;
}`
    },
    {
      key: 'marble',
      label: 'marble — slow turbulent veins, folded colours',
      loop: 90,
      src: `
vec3 field(vec2 p, float t) {
  /* Two fbm layers, the outer one only bending the space the inner one reads:
   * enough to make the veins wander without shredding them into noise. */
  vec2 drift = 0.7 * vec2(cos(t), sin(t));
  float warp = fbm(p * 0.7 + drift);
  float n = fbm(p * 1.1 + warp * 1.2 + drift.y);
  float v = sin(dot(p, vec2(1.3, 0.9)) * 2.4 + n * 5.5 + t);
  float vein = smoothstep(-0.35, 0.85, v);
  vec3 a = boost(cosPal(u_seed + 0.15), 1.2);
  vec3 b = boost(cosPal(u_seed + 0.62 + n * 0.2), 1.2);
  vec3 col = mix(a, b, vein) * (0.70 + 0.5 * vein);
  return col;
}`
    },
    {
      key: 'lava',
      label: 'lava — big soft blobs, glowing edges',
      loop: 45,
      src: `
vec3 field(vec2 p, float t) {
  float tot = 0.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = 0.85 * vec2(
      sin(t * 2.0 + fi * 2.1 + hash1(fi + u_seed * 9.0) * TAU),
      cos(t + fi * 1.4 + hash1(fi * 2.0 + u_seed * 5.0) * TAU));
    float r = 0.55 + 0.3 * hash1(fi * 4.0 + u_seed);
    /* A metaball weight r^2/d^2 reaches across the whole frame, so two blobs
     * are enough to tint everything and the field turns to mud - that was this
     * shader's first failure. This weight has a support instead: a blob colours
     * its own neighbourhood and lets the deep base read between them, which is
     * the lamp-lava look wanted here. */
    float w = clamp(1.0 - length(p - c) / r, 0.0, 1.0);
    w *= w;
    tot += w;
    acc += w * boost(cosPal(fi * 0.21 + u_seed + t / TAU), 1.5);
  }
  vec3 col = acc / max(tot, 1e-4);
  vec3 base = boost(cosPal(0.55 + u_seed), 1.1) * 0.32;
  col = mix(base, boost(col, 1.35), smoothstep(0.02, 0.30, tot));
  return col;
}`
    },
    {
      key: 'cells',
      label: 'cells — drifting soft voronoi, colour per cell',
      loop: 24,
      src: `
vec3 field(vec2 p, float t) {
  vec2 ip = floor(p);
  /* Nearest AND next-nearest, not just nearest: a hard hue change exactly where
   * two cells trade places is what makes a voronoi read as a cracked surface -
   * this shader's first failure. Blending across the distance gap softens that
   * seam into a fold. */
  float d1 = 1e9, d2 = 1e9, id1 = 0.0, id2 = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = ip + vec2(float(i), float(j));
      vec2 r = vec2(hash21(cell), hash21(cell + 7.31));
      /* Cells jitter inside their own unit square so the lattice never shows as
       * a grid, and each rides its own circle so the swap points keep moving and
       * everything is back where it started at the end of the loop. */
      vec2 pos = cell + 0.5 + 0.38 * sin(t * 2.0 + r * TAU);
      float d = length(pos - p);
      if (d < d1) { d2 = d1; id2 = id1; d1 = d; id1 = r.x; }
      else if (d < d2) { d2 = d; id2 = r.x; }
    }
  }
  /* id is a hash of the cell, so multiplying it past half a palette cycle
   * spreads neighbouring cells across distinct hues instead of landing them all
   * in the same green - the other thing this shader got wrong at first. No hue
   * drift: an integer number of palette rotations per 24 s would be a disco. */
  vec3 c1 = boost(cosPal(id1 * 0.62 + u_seed), 1.35);
  vec3 c2 = boost(cosPal(id2 * 0.62 + u_seed), 1.35);
  float seam = smoothstep(0.0, 0.55, d2 - d1);   /* 1 away from a cell boundary */
  vec3 col = mix(c2, c1, seam) * (0.72 + 0.4 * seam)
           * (0.85 + 0.3 * hash1(id1 * 17.0));   /* cells of their own lightness */
  return col;
}`
    },
    {
      key: 'ripple',
      label: 'ripple — interference rings from moving sources',
      loop: 30,
      src: `
vec3 field(vec2 p, float t) {
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = 0.9 * vec2(
      cos(t + fi * 1.9 + hash1(fi * 3.0 + u_seed * 3.0) * TAU),
      sin(t * 2.0 + fi * 1.1 + hash1(fi * 5.0 + u_seed * 7.0) * TAU));
    s += cos(length(p - c) * 9.0 - t * 6.0);
  }
  s /= 4.0;
  vec3 col = cosPal(s * 0.45 + u_seed + t / TAU);
  /* Narrow lightness swing: an interference field is already loud, and a wide
   * brightness term on top of it turns it into a thermal map. */
  col = boost(col, 1.15) * (0.86 + 0.22 * s);
  return col;
}`
    },
    {
      key: 'silk',
      label: 'silk — fine flowing bands',
      loop: 30,
      src: `
vec3 field(vec2 p, float t) {
  vec2 drift = 0.5 * vec2(cos(t), sin(t));
  float w = fbm(p * 1.1 + drift);
  float bands = sin(p.y * 3.0 + p.x * 0.8 + w * 3.2 + t * 2.0);
  float fine = sin(bands * 3.0 + w * 2.0 - t * 2.0);
  vec3 col = boost(cosPal(bands * 0.14 + w * 0.2 + t / TAU + u_seed), 1.3);
  col *= 0.80 + 0.25 * fine;
  return col;
}`
    },
    {
      key: 'veil',
      label: 'veil — soft travelling gradient, very low contrast',
      loop: 90,
      src: `
vec3 field(vec2 p, float t) {
  /* Two octaves on circular paths of different radius and harmonic: the second
   * one does not march in lockstep with the first, which is what makes a soft
   * field read as weather rather than as one swinging gradient. */
  float n1 = fbm(p * 0.8 + 0.9 * vec2(cos(t), sin(t)));
  float n2 = fbm(p * 1.9 + 0.5 * vec2(cos(t * 2.0 + 1.3), sin(t * 2.0)));
  float v = n1 * 0.65 + n2 * 0.35 + 0.18 * sin(p.x * 0.35 + p.y * 0.4 + t);
  vec3 col = cosPal(v * 0.55 + t / TAU + u_seed);
  col = mix(vec3(0.5), col, 0.78);   /* deliberately low contrast */
  return col;
}`
    },
    {
      key: 'wash',
      label: 'wash — the picture’s own two colours, alive',
      loop: 60,
      src: `
vec3 field(vec2 p, float t) {
  /* Meant to be read with palette % at 100: this one paints no colours of its
   * own, only a lightness field, and finish() maps that onto the picture's
   * ramp. The two octaves ride circles of different radius and phase for the
   * same reason veil's do. */
  float n1 = fbm(p * 0.9 + 0.8 * vec2(cos(t), sin(t)));
  float n2 = fbm(p * 2.1 + 0.6 * vec2(cos(t * 2.0 + 2.1), sin(t * 2.0 + 0.7)));
  float v = smoothstep(0.28, 0.78, n1 * 0.7 + n2 * 0.3);
  return vec3(v);
}`
    },
    {
      key: 'contour',
      label: 'contour — rings that follow the shape, gathering at its edge',
      loop: 45,
      src: `
/* The one field that is told about the geometry it is painted over: the shape's
 * coverage and its signed distance to the contour arrive as data, measured once
 * from the mask (see ensureEdges in src/fill.js), so the rings here are lines of
 * equal distance from the outline. They run parallel to whatever the shape is - a
 * heart, a uploaded scan, a ring - and travel inward as the clock runs. Finding
 * the contour is not this field's job and costs it no derivatives: on a Fill
 * frame the geometry is sampled, on any other frame it is the frame's own edge.
 *
 * On the ground the whole thing reads: the shape sits slightly proud of what is
 * outside it, the contour is the brightest line in the frame and the rings carry
 * that brightness inward. On the ink the brightness half is thrown away by design
 * (chroma keeps the ratios, atLightness hands the ink its own lightness back) and
 * what survives is the hue, which gathers at the contour and settles toward the
 * middle - which is the only thing an ink field is ever allowed to do to a
 * stroke. */
vec3 field(vec2 p, float t) {
  float d = shapeDist();
  float cov = shapeCov();
  float rim = shapeRim(0.07);
  /* Even rings read as an outline drawn over the pattern rather than as a field,
   * so the distance is perturbed by a slow noise before it is ringed. The noise
   * drifts round a circle of its own - at the loop's rate, not half its rate, or
   * the field would not come back to itself when the clock wraps. */
  float n = fbm(p * 2.2 + 0.4 * vec2(cos(t), sin(t)));
  float dn = d + 0.05 * (n - 0.5);
  float rings = 0.5 + 0.5 * sin(dn * 42.0 - ph() * 3.0);

  /* Hue: a slow drift of its own, with the field's most saturated colour spent on
   * the contour. Both drifts ride the loop as whole palette rotations - cosPal has
   * period 1 in its argument, so a shift of t / TAU over a loop is a shift of 1, and
   * the field is where it started when the clock wraps. */
  float f = p.x * 0.13 + p.y * 0.11;
  vec3 base = boost(cosPal(f - t / TAU + u_seed * 0.6), 1.35);
  vec3 edge = boost(cosPal(dn * 1.8 + t / TAU + u_seed * 0.8 + 0.2), 1.6);
  vec3 c = mix(base, edge, clamp(0.30 + 0.60 * rim, 0.0, 1.0));

  /* The contour is the brightest line in the frame and the shape sits proud of
   * what is outside it, by weights big enough to read as geometry rather than as
   * a gradient someone happened to leave in. */
  float lit = 0.46 + 0.12 * cov + 0.34 * rim * (0.35 + 0.65 * rings)
            + 0.05 * (n - 0.5);
  lit += 0.045 * rings * cov * (1.0 - rim);
  /* atLightness, the same pair of helpers the ink program runs the field through:
   * the ratios here are the hue and the number is the brightness, and on the ink
   * only the ratios survive - which is the point of the split. */
  /* atLightness, the same helper the ink program runs the field through: the
   * ratios here are the hue and the number is the brightness, and on the ink only
   * the ratios survive - which is the point of the split. */
  return atLightness(c, clamp(lit, 0.06, 0.94));
}`
    }
  ];

  function hexToRGB(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return [0.95, 0.94, 0.90];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* One triangle covering the frame - no attributes to feed, no buffers to keep
   * in step with the 2D pass, nothing to re-upload when the frame changes. */
  const VERT = `attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;
  const TRI = new Float32Array([-1, -1, 3, -1, -1, 3]);

  /* Two ways to put the same field to work.
   *
   * On the ground the field is the surface: it paints every pixel of the frame
   * and finishes opaque, and the tiles sit over it.
   *
   * On the ink the field is paint poured into a shape that was drawn somewhere
   * else. u_mask carries the ink the engine already drew - its colour in rgb, its
   * coverage in a - and nothing in this program draws a line, an arc or a wing,
   * so nothing in it can move one. The field supplies hue; the ink keeps the
   * lightness the pattern was designed with, because lightness is the half the
   * shape is read from.
   *
   * u_a is unused in the ink program on purpose: the ink's colour arrives through
   * the mask, per pixel, including the way it drifts across subdivision depths,
   * which no uniform could carry. */
  const GROUND_MAIN = `
void main() {
  gl_FragColor = vec4(finish(field(frameUV(), ph())), 1.0);
}`;

  const INK_MAIN = `
void main() {
  /* A 2D canvas uploads with its first row at v = 0 and gl_FragCoord counts rows
   * from the bottom of the frame, so the mask has to be sampled with y turned
   * around. Without this the field lands on its own picture upside down - the ink
   * is there, the coverage is right, and every stroke is in the wrong place. */
  vec4 ink = texture2D(u_mask, vec2(gl_FragCoord.x / u_res.x, 1.0 - gl_FragCoord.y / u_res.y));
  if (ink.a <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec3 f = field(frameUV(), ph());
  /* u_relief is measured along the way from this pixel of ink to the ground it has
   * to be read against, so the most relief can spend is a share of a distance that
   * already keeps the ink legible - and it may only spend it going the right way.
   * A field deepens the ink where the field is bright, always further from the
   * ground, never toward it: an earlier version swung lightness toward the ground
   * on bright parts of the field, which is exactly the camouflage the whole ground
   * argument was about avoiding, and it showed - 10% of the ink vanished into an
   * aurora ground. At relief 0 the ink's lightness is exactly the designed one and
   * the field can only change hue. */
  float L = lum(ink.rgb);
  float side = lum(u_b) > L ? -1.0 : 1.0;          // the ink's own side of the ground
  float span = abs(L - lum(u_b));                  // the distance relief may draw on
  float L2 = clamp(L + side * u_relief * span * lum(f), 0.0, 1.0);
  vec3 col = mix(ink.rgb, atLightness(chroma(f), L2), clamp(u_mix, 0.0, 1.0));
  /* The canvas is composited premultiplied, and coverage is partial along every
   * antialiased edge: not premultiplying here is how a field-ink outline grows a
   * halo the solid ink never had. */
  gl_FragColor = vec4(col * ink.a, ink.a);
}`;


  const byKey = new Map(SHADERS.map(d => [d.key, d]));

  /* A stored preference can name a field that no longer exists - a share link
   * from a build that had a body this one dropped. Fall back to the first field
   * rather than drawing nothing. */
  function keyFor(want) { return byKey.has(want) ? want : SHADERS[0].key; }

  const DEFAULTS = { shSpeed: 1, shScale: 1, shMix: 45, scrim: 45,
    inkSpeed: 1, inkScale: 1, inkPig: 45, inkRelief: 25 };

  /**
   * A field is a live GL binding on one canvas, in one role: 'ground' paints the
   * surface behind the tiles, 'ink' paints the tiles themselves through a mask.
   * The app keeps two of each - the preview pair and an export-sized pair for the
   * PNG - each with its own GL context, and all of them have to show the same
   * field at the same phase. So parameters are pushed once and every render
   * applies them.
   */
  function createGround(canvasEl, role) {
    const inkRole = role === 'ink';
    const gl = canvasEl.getContext('webgl', {
      /* The ground is opaque and covers the frame; the ink is a partial-coverage
       * layer over it, so the two need opposite alpha setups. Both are declared
       * premultiplied, because the ink program writes col * coverage on purpose -
       * declaring the buffer as straight alpha instead makes the browser divide the
       * colour by its own coverage when compositing, which brightens every
       * antialiased edge into a halo the solid ink never had. */
      alpha: inkRole,
      antialias: false,             // a full frame: there is no edge to smooth
      depth: false, stencil: false,
      preserveDrawingBuffer: true,  // the export has to read the buffer back
      premultipliedAlpha: true,
      powerPreference: 'low-power'
    });
    if (!gl) return { ok: false, reason: 'WebGL is not available in this browser.' };

    const cache = new Map();        // one program per field per role, compiled on first use
    let entry = null, key = null;
    let mask = null, maskTex = null;
    let shape = null, shapeTex = null, blankTex = null;
    const params = {
      scale: 1, seed: 0.31, mix: 0.45, scrim: 0.45, relief: 0,
      a: [0.10, 0.10, 0.12], b: [0.95, 0.94, 0.90]
    };

    function programFor(def) {
      const ck = def.key + (inkRole ? '#ink' : '#ground');
      if (cache.has(ck)) return { entry: cache.get(ck) };
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, VERT); gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, COMMON + def.src + (inkRole ? INK_MAIN : GROUND_MAIN));
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        gl.deleteShader(vs); gl.deleteShader(fs);
        return { error: gl.getShaderInfoLog(fs) };
      }
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        return { error: gl.getProgramInfoLog(prog) };
      }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, TRI, gl.STATIC_DRAW);
      const e = {
        def, prog, buf,
        pos: gl.getAttribLocation(prog, 'a_pos'),
        u: {
          time: gl.getUniformLocation(prog, 'u_time'),
          loop: gl.getUniformLocation(prog, 'u_loop'),
          res: gl.getUniformLocation(prog, 'u_res'),
          scale: gl.getUniformLocation(prog, 'u_scale'),
          seed: gl.getUniformLocation(prog, 'u_seed'),
          mix: gl.getUniformLocation(prog, 'u_mix'),
          scrim: inkRole ? null : gl.getUniformLocation(prog, 'u_scrim'),
          relief: inkRole ? gl.getUniformLocation(prog, 'u_relief') : null,
          mask: inkRole ? gl.getUniformLocation(prog, 'u_mask') : null,
          /* Null for a body that never asks about the shape: the compiler throws
           * away a sampler nothing called, and asking GL for a location it dropped
           * is how a gate's probe ends up writing to a null uniform. */
          shape: gl.getUniformLocation(prog, 'u_shape'),
          hasShape: gl.getUniformLocation(prog, 'u_hasShape'),
          a: gl.getUniformLocation(prog, 'u_a'),
          b: gl.getUniformLocation(prog, 'u_b')
        }
      };
      cache.set(ck, e);
      return { entry: e };
    }

    /* Returns true, or { error } for the panel to report: a body that fails on
     * somebody's GPU has to say so, not leave a black frame with no reason. */
    function setShader(want) {
      const def = byKey.get(keyFor(want));
      const r = programFor(def);
      if (r.error) return { error: def.key + ': ' + r.error };
      entry = r.entry;
      key = def.key;
      return true;
    }

    function setParams(p) { Object.assign(params, p); }

    function resize(w, h) {
      if (canvasEl.width !== w) { canvasEl.width = w; mask = null; shape = null; }
      if (canvasEl.height !== h) { canvasEl.height = h; mask = null; shape = null; }
      gl.viewport(0, 0, canvasEl.width, canvasEl.height);
    }

    /**
     * The ink, as the engine drew it: a 2D canvas whose rgb is the ink colour the
     * app chose and whose alpha is where that ink lands. Uploaded once per redraw,
     * not once per animation frame - a full frame of RGBA at 60 Hz is a megabytes
     * per second cost for data that only changes when the picture does.
     *
     * The mask has to be the same size as this canvas or the coverage lands on the
     * wrong pixels, which is not a subtle failure: it is the pattern drawn in the
     * wrong place. Refusing and saying so is cheaper than discovering it as a blur.
     */
    function setMask(src) {
      if (!inkRole) return { error: 'setMask belongs to the ink role.' };
      if (!src || !src.width || !src.height) return { error: 'the ink mask is empty.' };
      if (src.width !== canvasEl.width || src.height !== canvasEl.height) {
        return { error: `the ink mask is ${src.width}x${src.height} but the ink canvas is `
          + `${canvasEl.width}x${canvasEl.height}.` };
      }
      if (!maskTex) {
        maskTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        /* CLAMP, not REPEAT: the mask covers exactly the frame. A wrapped mask would
         * paste the other edge of the picture into the antialiased border. */
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      mask = { w: src.width, h: src.height };
      return true;
    }

    /* A body that asks where the contour is has to be answered even when there is
     * no contour in the frame, so an unbound sampler is not an option: GL will
     * bind *something* and the field will read it. A 1x1 of opaque black stands
     * in, and u_hasShape tells the helpers not to read it at all. */
    function blankTexture() {
      if (!blankTex) {
        blankTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, blankTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
          new Uint8Array([0, 0, 0, 255]));
      }
      return blankTex;
    }

    /**
     * The shape the frame stands on, as the app painted it: a 2D canvas the same
     * size as this one, whose red channel is how covered each point is and whose
     * green is the signed distance to the contour with 128 exactly on it. Pass
     * null - or a tab with no shape at all - and the field falls back to the
     * frame's own edge rather than keeping a shape from a frame it no longer has.
     *
     * Sized to match or refused, for the same reason the ink mask is: a shape a
     * quarter the size of the frame is the shape painted in the wrong place, and
     * that looks like a stylistic choice until someone compares two frames.
     */
    function setShape(src) {
      if (!src || !src.width || !src.height) { shape = null; return true; }
      if (src.width !== canvasEl.width || src.height !== canvasEl.height) {
        return { error: `the shape image is ${src.width}x${src.height} but the ${role} canvas is `
          + `${canvasEl.width}x${canvasEl.height}.` };
      }
      if (!shapeTex) {
        shapeTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, shapeTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        /* CLAMP again: the shape covers exactly the frame, and a wrapped shape
         * would paste the other side of the picture into the rim. */
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.bindTexture(gl.TEXTURE_2D, shapeTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      shape = { w: src.width, h: src.height };
      return true;
    }

    /* phase is the app's clock in seconds and may be any size: it is folded
     * into the field's loop here, which is safe exactly because every body is
     * written as harmonics of u_time / u_loop. */
    function render(phase) {
      if (!entry) return false;
      const loop = entry.def.loop || 60;
      let t = (isFinite(phase) ? phase : 0) % loop;
      if (t < 0) t += loop;
      const u = entry.u;
      gl.useProgram(entry.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buf);
      gl.enableVertexAttribArray(entry.pos);
      gl.vertexAttribPointer(entry.pos, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1f(u.time, t);
      gl.uniform1f(u.loop, loop);
      gl.uniform2f(u.res, canvasEl.width, canvasEl.height);
      gl.uniform1f(u.scale, params.scale);
      gl.uniform1f(u.seed, params.seed);
      gl.uniform1f(u.mix, params.mix);
      if (u.scrim) gl.uniform1f(u.scrim, params.scrim);
      if (u.relief) gl.uniform1f(u.relief, params.relief);
      gl.uniform3fv(u.a, params.a);
      gl.uniform3fv(u.b, params.b);
      if (inkRole) {
        if (!mask) return false;      /* an ink field with nothing to paint into */
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.uniform1i(u.mask, 0);
      }
      /* A separate unit from the ink mask: a Fill frame with field ink over a
       * shader ground uses both in the same draw, and they are different data. */
      if (u.shape) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, shape ? shapeTex : blankTexture());
        gl.uniform1i(u.shape, 1);
      }
      if (u.hasShape) gl.uniform1f(u.hasShape, shape ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    }

    return {
      ok: true,
      role,
      get key() { return key; },
      setShader, setParams, resize, render,
      /* Reported so a gate can ask what the field was told, the way it already can
       * ask which body is current: a mask that never arrived and a mask that arrived
       * at the wrong size look identical on screen. */
      get maskSize() { return mask ? [mask.w, mask.h] : null; },
      setMask,
      /* Likewise for the shape: "the field stopped following the contour" is what
       * a shape that never arrived looks like, and what a shape that arrived at the
       * wrong size looks like, and both are invisible on the stage. */
      get shapeSize() { return shape ? [shape.w, shape.h] : null; },
      setShape
    };
  }

  window.TruchetShaders = {
    createGround,
    keyFor,
    hexToRGB,
    DEFAULTS,
    list: SHADERS.map(d => ({ key: d.key, label: d.label, loop: d.loop }))
  };
})();
