/**
 * Turning a picture of a park into coordinates, and being honest about how well.
 *
 * A park knows things OpenStreetMap does not, and most of them are published as
 * a drawing: the illustrated map handed out at the gate, with every toilet, every
 * food stand, which end of a coaster the queue is at, and the path between two
 * things that OSM has never had a line for. That drawing is the single richest
 * source of the data this app is missing, and there has been no way to get
 * anything out of it — `--merge` takes points that are already surveyed, which
 * is precisely what a picture's are not.
 *
 * The reason it stayed out is worth stating, because it is the whole design of
 * this file. Big Kahuna's park map was georeferenced by hand against eleven
 * surveyed control points, came out at 33 m RMS with residuals up to 55 m in a
 * park 400 m across, and every pin from it was thrown away. That was the right
 * call and it was made by a person doing arithmetic in a scratch file. The
 * failure was not the map, either: it was fitting one global transform to a
 * drawing that is not a photograph of anything. An illustrated map is stretched
 * where the artist needed room — the entrance plaza gets a third of the page,
 * the car park gets a corner — and no rotation, scale and shift on Earth
 * straightens that out.
 *
 * So this offers four models, and the one that matters is the last:
 *
 *   similarity  scale, rotation, shift. A scan of a real map, square on.
 *   affine      + shear and independent axis scale. A scan, slightly off.
 *   projective  a homography. A photograph of a map board, taken at an angle.
 *   tps         a thin-plate spline: a smooth warp pinned exactly through every
 *               control point, bending as much as it has to in between. This is
 *               the one for a drawing, because it stops pretending the drawing
 *               is planar.
 *
 * And it reports the error the only way that is not self-flattery. A spline
 * passes exactly through its own control points, so its residual against them
 * is zero by construction — quote that and you have proved nothing except that
 * arithmetic works. What this quotes is **leave-one-out cross-validation**: fit
 * on every control but one, predict that one, and measure how far off it lands.
 * That is an estimate of the error at a point the fit has never seen, which is
 * the only kind of point anybody is going to use it for.
 *
 * Everything is in metres, in a local frame centred on the controls, because
 * "0.0003 degrees" is not a number anybody can judge and "18 metres" is.
 */

/** Degrees of freedom, as the smallest number of control points each model needs. */
export const MODELS = { similarity: 2, affine: 3, projective: 4, tps: 3 };

/* Matching lib/routing.js, so a metre here is the metre the router walks. */
const R = 6371000;
const RAD = Math.PI / 180;

/* ------------------------------------------------------------- linear algebra - */

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting.
 *
 * Small dense systems only — the biggest here is (controls + 3) square, and a
 * park map is georeferenced from a couple of dozen points at the outside.
 */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) {
      // Controls in a straight line, or the same point twice. Either way there
      // is no unique transform and a wrong one would look like an answer.
      throw new Error(
        'The control points do not pin down a transform — they are collinear, or two of them are '
          + 'the same point. Spread them out: corners of the venue, not a row along one path.',
      );
    }
    if (pivot !== col) {
      const t = M[pivot];
      M[pivot] = M[col];
      M[col] = t;
    }
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (!f) continue;
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  // Gauss-Jordan leaves each row with only its own diagonal term, so the answer
  // is that row's right-hand side over it.
  return M.map((row, i) => row[n] / row[i]);
}

/** Least squares for an over-determined system, through the normal equations. */
function lstsq(A, b) {
  const cols = A[0].length;
  const AtA = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const Atb = new Array(cols).fill(0);
  for (let r = 0; r < A.length; r += 1) {
    for (let i = 0; i < cols; i += 1) {
      Atb[i] += A[r][i] * b[r];
      for (let j = 0; j < cols; j += 1) AtA[i][j] += A[r][i] * A[r][j];
    }
  }
  return solve(AtA, Atb);
}

/* ------------------------------------------------------------------- frames - */

/**
 * A local metric frame centred on the controls.
 *
 * Fitting in degrees would weight a metre of longitude differently from a metre
 * of latitude by the cosine of the latitude — 13% at San Antonio — which tilts
 * every fit and makes every residual a number in the wrong unit.
 */
function frameOf(controls) {
  const lat0 = controls.reduce((s, c) => s + c.lat, 0) / controls.length;
  const lng0 = controls.reduce((s, c) => s + c.lng, 0) / controls.length;
  const kx = R * RAD * Math.cos(lat0 * RAD);
  const ky = R * RAD;
  return {
    lat0,
    lng0,
    toXY: (lat, lng) => [(lng - lng0) * kx, (lat - lat0) * ky],
    toLatLng: (x, y) => ({ lat: lat0 + y / ky, lng: lng0 + x / kx }),
  };
}

/* Pixels are centred and scaled before fitting: a coordinate of 3400 squared in
   a normal equation is 11.5 million, and next to a 1 in the same matrix that is
   how a solvable system starts returning noise. */
function pixelFrame(controls) {
  const cx = controls.reduce((s, c) => s + c.px[0], 0) / controls.length;
  const cy = controls.reduce((s, c) => s + c.px[1], 0) / controls.length;
  const spread = Math.max(
    1,
    ...controls.map((c) => Math.hypot(c.px[0] - cx, c.px[1] - cy)),
  );
  return { cx, cy, s: 1 / spread, to: (px) => [(px[0] - cx) / spread, (px[1] - cy) / spread] };
}

/* --------------------------------------------------------------------- fits - */

const U = (r) => (r <= 0 ? 0 : r * r * Math.log(r));

/**
 * Fit a transform from picture to ground.
 *
 * @param controls  `[{ px: [x, y], lat, lng, n? }]` — a pixel in the image and
 *                  the surveyed place it is. Four is thin, eight is comfortable,
 *                  and they want to be spread to the corners rather than strung
 *                  along one path.
 * @param model     one of {@link MODELS}, or 'auto' to fit every model the
 *                  controls can carry and keep whichever measures best
 * @param smoothing  tps only. 0 pins the spline exactly through every control.
 *                   Above 0 it is allowed to miss them, which is what you want
 *                   when the controls themselves are only roughly surveyed.
 */
export function fit(controls, { model = 'auto', smoothing = 0 } = {}) {
  if (!Array.isArray(controls) || controls.length < 2) {
    throw new Error('Georeferencing wants at least two control points, and really wants four.');
  }
  for (const c of controls) {
    if (!Array.isArray(c.px) || !Number.isFinite(c.px[0]) || !Number.isFinite(c.px[1])) {
      throw new Error(`Control "${c.n || '?'}" has no pixel position.`);
    }
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
      throw new Error(`Control "${c.n || '?'}" has no surveyed lat/lng.`);
    }
  }

  const chosen = model === 'auto' ? autoModel(controls) : model;
  if (!(chosen in MODELS)) {
    throw new Error(`No such model "${chosen}". One of: ${Object.keys(MODELS).join(', ')}.`);
  }
  if (controls.length < MODELS[chosen]) {
    throw new Error(
      `A ${chosen} fit needs ${MODELS[chosen]} control points and has ${controls.length}.`,
    );
  }

  const frame = frameOf(controls);
  const px = pixelFrame(controls);
  const src = controls.map((c) => px.to(c.px));
  const dst = controls.map((c) => frame.toXY(c.lat, c.lng));

  const params = chosen === 'tps'
    ? fitTps(src, dst, smoothing)
    : chosen === 'projective'
      ? fitProjective(src, dst)
      : chosen === 'affine'
        ? fitAffine(src, dst)
        : fitSimilarity(src, dst);

  return { model: chosen, n: controls.length, smoothing, frame, px, params };
}

/**
 * The model that measures best, rather than the richest one that fits.
 *
 * A ladder — "six controls or more, use a spline" — is the obvious rule and it
 * is wrong in both directions. A spline given six badly spread controls
 * cross-validates worse than a plain rotate-and-scale, because dropping one of
 * six leaves five to describe a warp; the same spline on a dozen controls in a
 * ring beats everything else by a factor of three. Which way it goes is a fact
 * about the picture and the controls, not about the count, so the count is not
 * asked. Every model the controls can carry is fitted and scored, and the one
 * with the lowest left-out error wins.
 *
 * Only when nothing can be scored — too few controls to hold one back and still
 * fit — does this fall through to the ladder, and then the accuracy is reported
 * as unknown, because it is.
 */
function autoModel(controls) {
  const ranked = compare(controls);
  if (ranked.length) return ranked[0].model;
  const n = controls.length;
  if (n >= 4) return 'projective';
  if (n >= 3) return 'affine';
  return 'similarity';
}

function fitSimilarity(src, dst) {
  // X = a·x − b·y + tx ; Y = b·x + a·y + ty, stacked into one system so the
  // rotation stays a rotation instead of the two axes drifting apart.
  const A = [];
  const b = [];
  src.forEach(([x, y], i) => {
    A.push([x, -y, 1, 0]);
    b.push(dst[i][0]);
    A.push([y, x, 0, 1]);
    b.push(dst[i][1]);
  });
  return { kind: 'similarity', p: lstsq(A, b) };
}

function fitAffine(src, dst) {
  const A = src.map(([x, y]) => [x, y, 1]);
  return {
    kind: 'affine',
    x: lstsq(A, dst.map((d) => d[0])),
    y: lstsq(A, dst.map((d) => d[1])),
  };
}

function fitProjective(src, dst) {
  /* Direct linear transform. Eight unknowns, two rows per control, h33 pinned
     to 1 — which is safe here because a control point never lands on the
     horizon of a park map. */
  const A = [];
  const b = [];
  src.forEach(([x, y], i) => {
    const [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  });
  return { kind: 'projective', h: lstsq(A, b) };
}

function fitTps(src, dst, smoothing) {
  const n = src.length;
  const size = n + 3;
  const A = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      A[i][j] = i === j ? smoothing : U(Math.hypot(src[i][0] - src[j][0], src[i][1] - src[j][1]));
    }
    A[i][n] = 1;
    A[i][n + 1] = src[i][0];
    A[i][n + 2] = src[i][1];
    A[n][i] = 1;
    A[n + 1][i] = src[i][0];
    A[n + 2][i] = src[i][1];
  }
  const rhs = (k) => {
    const v = new Array(size).fill(0);
    for (let i = 0; i < n; i += 1) v[i] = dst[i][k];
    return v;
  };
  return { kind: 'tps', src, x: solve(A, rhs(0)), y: solve(A, rhs(1)) };
}

/* ------------------------------------------------------------------ project - */

/** Where a pixel lands on the ground. */
export function project(fitted, pixel) {
  const [x, y] = fitted.px.to(pixel);
  const p = fitted.params;
  let X;
  let Y;
  if (p.kind === 'similarity') {
    const [a, b, tx, ty] = p.p;
    X = a * x - b * y + tx;
    Y = b * x + a * y + ty;
  } else if (p.kind === 'affine') {
    X = p.x[0] * x + p.x[1] * y + p.x[2];
    Y = p.y[0] * x + p.y[1] * y + p.y[2];
  } else if (p.kind === 'projective') {
    const h = p.h;
    const w = h[6] * x + h[7] * y + 1;
    X = (h[0] * x + h[1] * y + h[2]) / w;
    Y = (h[3] * x + h[4] * y + h[5]) / w;
  } else {
    const n = p.src.length;
    X = p.x[n] + p.x[n + 1] * x + p.x[n + 2] * y;
    Y = p.y[n] + p.y[n + 1] * x + p.y[n + 2] * y;
    for (let i = 0; i < n; i += 1) {
      const u = U(Math.hypot(x - p.src[i][0], y - p.src[i][1]));
      X += p.x[i] * u;
      Y += p.y[i] * u;
    }
  }
  const { lat, lng } = fitted.frame.toLatLng(X, Y);
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

/** How far each control lands from where it should, in metres. In-sample. */
export function residuals(fitted, controls) {
  return controls.map((c) => {
    const at = project(fitted, c.px);
    const [x0, y0] = fitted.frame.toXY(c.lat, c.lng);
    const [x1, y1] = fitted.frame.toXY(at.lat, at.lng);
    return { n: c.n || null, metres: Math.hypot(x1 - x0, y1 - y0) };
  });
}

/**
 * The error at a point the fit has never seen — leave one control out, fit on
 * the rest, and measure how far off that one lands.
 *
 * This is the number to quote and the only one worth acting on. A thin-plate
 * spline passes exactly through its own controls, so its in-sample residual is
 * zero however wrong it is everywhere else; a projective fit on exactly four
 * points is the same story. Both look perfect by the measure that costs nothing
 * to compute, which is why {@link residuals} is reported beside this and never
 * instead of it.
 */
export function crossValidate(controls, opts = {}) {
  const model = opts.model === 'auto' || !opts.model ? autoModel(controls) : opts.model;
  const need = MODELS[model] ?? 3;
  if (controls.length - 1 < need) {
    return {
      model,
      possible: false,
      why: `A ${model} fit needs ${need} controls, so dropping one of ${controls.length} leaves `
        + 'too few to fit at all. Add control points — until then the only honest thing to say '
        + 'about this fit\'s accuracy is nothing.',
      rms: null,
      max: null,
      residuals: [],
    };
  }

  const out = [];
  for (let i = 0; i < controls.length; i += 1) {
    const rest = controls.filter((_, j) => j !== i);
    const held = controls[i];
    const f = fit(rest, { ...opts, model });
    const at = project(f, held.px);
    const [x0, y0] = f.frame.toXY(held.lat, held.lng);
    const [x1, y1] = f.frame.toXY(at.lat, at.lng);
    out.push({ n: held.n || `#${i + 1}`, metres: Math.hypot(x1 - x0, y1 - y0) });
  }
  const sq = out.reduce((s, r) => s + r.metres * r.metres, 0) / out.length;
  const worst = out.reduce((a, b) => (b.metres > a.metres ? b : a));
  return {
    model,
    possible: true,
    rms: Math.sqrt(sq),
    max: worst.metres,
    worst: worst.n,
    residuals: out.sort((a, b) => b.metres - a.metres),
  };
}

/**
 * Every model this many controls can support, fitted and scored, worst error first.
 *
 * Which model suits a picture is not something anybody can tell by looking at
 * it — a drawing that seems hand-stretched can turn out to be a traced survey,
 * and a photograph of a map board can be worse than it looks because of the
 * angle it was taken at. So try them all and let the cross-validated number
 * choose. This is what `--model auto` reports on.
 */
export function compare(controls, { smoothing = 0 } = {}) {
  return Object.keys(MODELS)
    .filter((m) => controls.length - 1 >= MODELS[m])
    .map((model) => {
      try {
        const cv = crossValidate(controls, { model, smoothing });
        return { model, rms: cv.rms, max: cv.max, worst: cv.worst };
      } catch (err) {
        return { model, rms: null, max: null, error: err.message };
      }
    })
    .filter((r) => r.rms != null)
    .sort((a, b) => a.rms - b.rms);
}
