const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { EMOJI, SPECIES } = require('./public/emoji-manifest.js');

const app = express();
const port = process.env.PORT || 3000;

// staging or production. Swaps data and suppresses irreversible outbound
// side effects; never gates a feature, a screen or a code path.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// ---------------------------------------------------------------------------
// Store. One interface, two implementations: Postgres when DATABASE_URL is
// set (always, on the platform), an in-memory Map when it is not (tests, and
// a bare `node server.js` with no database). Identical behaviour on both —
// this is a harness affordance, not an environment switch.
// ---------------------------------------------------------------------------

const STEPS = ['egg', 'pet', 'feedback', 'proposal', 'try', 'vote', 'shipped', 'home'];

// Species is a pure function of the member id. Same member, same pet, on
// every device, no reroll.
function speciesFor(userId) {
  let h = 2166136261;                       // FNV-1a
  const s = 'patch-2026:' + String(userId); // the salt is a constant, not a secret
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return SPECIES[h % SPECIES.length];
}

function blankPet(userId, username) {
  return {
    user_id: String(userId),
    username: String(username || 'you'),
    species: speciesFor(userId),
    name: null,
    food: 40,
    play: 20,
    plays: 0,
    step: 'egg',
    agreed: false,
    vote: null,
    ball: false,
    hatched_at: null,
  };
}

function pgStore() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return {
    pool,
    async init() {
      // The one table. Per-member state that is never shown to anyone else,
      // so it is staging:private: staging copies the schema, not the rows,
      // and every preview visitor hatches their own pet.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pets (
          user_id    TEXT PRIMARY KEY,
          username   TEXT NOT NULL,
          species    TEXT NOT NULL,
          name       TEXT,
          food       INTEGER NOT NULL DEFAULT 40,
          play       INTEGER NOT NULL DEFAULT 20,
          plays      INTEGER NOT NULL DEFAULT 0,
          step       TEXT NOT NULL DEFAULT 'egg',
          agreed     BOOLEAN NOT NULL DEFAULT FALSE,
          vote       TEXT,
          ball       BOOLEAN NOT NULL DEFAULT FALSE,
          chosen_species TEXT,
          hatched_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`ALTER TABLE pets ADD COLUMN IF NOT EXISTS chosen_species TEXT`);
      await pool.query(`COMMENT ON TABLE pets IS 'staging:private'`);
    },
    async get(userId, username) {
      const id = String(userId);
      const { rows } = await pool.query('SELECT * FROM pets WHERE user_id = $1', [id]);
      if (rows.length) return rows[0];
      const pet = blankPet(id, username);
      // The species is hashed here, server-side. The client never sends one.
      const inserted = await pool.query(`
        INSERT INTO pets (user_id, username, species)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username
        RETURNING *
      `, [pet.user_id, pet.username, pet.species]);
      return inserted.rows[0];
    },
    async save(pet) {
      const { rows } = await pool.query(`
        UPDATE pets SET username = $2, name = $3, food = $4, play = $5, plays = $6,
               step = $7, agreed = $8, vote = $9, ball = $10, chosen_species = $11,
               hatched_at = $12, updated_at = NOW()
        WHERE user_id = $1 RETURNING *
      `, [pet.user_id, pet.username, pet.name, pet.food, pet.play, pet.plays,
          pet.step, pet.agreed, pet.vote, pet.ball, pet.chosen_species === undefined ? null : pet.chosen_species,
          pet.hatched_at]);
      return rows[0];
    },
    async reset(userId) {
      await pool.query('DELETE FROM pets WHERE user_id = $1', [String(userId)]);
    },
    async close() { await pool.end(); },
  };
}

function memoryStore() {
  const rows = new Map();
  return {
    pool: null,
    async init() {},
    async get(userId, username) {
      const id = String(userId);
      if (!rows.has(id)) rows.set(id, blankPet(id, username));
      return { ...rows.get(id) };
    },
    async save(pet) {
      rows.set(pet.user_id, { ...pet, updated_at: new Date() });
      return { ...rows.get(pet.user_id) };
    },
    async reset(userId) { rows.delete(String(userId)); },
    async close() {},
  };
}

const store = process.env.DATABASE_URL ? pgStore() : memoryStore();

// ---------------------------------------------------------------------------
// The staged half of the story. In v1 the feedback and the proposal are
// constants; on the platform they become the real feedback item and the real
// proposal behind this same shape, so the frontend does not change.
// ---------------------------------------------------------------------------

const FEEDBACK = {
  id: 'fb-play-hop',
  author: 'Maya',
  text: 'Play only makes it hop. It needs something to play with ⚽',
  agrees: 4,
};

const PROPOSAL = {
  id: 'prop-play-ball',
  author: 'Noor',
  title: 'Play throws a ball',
  addresses: 'fb-play-hop',
  yes: 11,
  no: 1, // one honest no, so the ballot is not a yes-button
};

function view(pet) {
  var days = 0;
  if (pet.hatched_at) {
    days = Math.max(0, Math.floor((Date.now() - new Date(pet.hatched_at).getTime()) / 86400000));
  }
  return {
    pet: {
      species: pet.chosen_species || pet.species,
      name: pet.name === undefined ? null : pet.name,
      days: days,
      food: pet.food,
      play: pet.play,
      plays: pet.plays,
      step: pet.step,
      agreed: !!pet.agreed,
      vote: pet.vote === undefined ? null : pet.vote,
      ball: !!pet.ball,
    },
    mood: moodLine(days),
    username: pet.username,
    // Staging previews get a Start over link in the home footer, because a
    // preview is the one place replaying onboarding makes sense. It is a
    // data affordance, not a feature: /api/reset 404s in production and
    // every other screen is identical in both environments.
    staging: IS_STAGING,
    feedback: { ...FEEDBACK, agrees: FEEDBACK.agrees + (pet.agreed ? 1 : 0) },
    proposal: {
      ...PROPOSAL,
      yes: PROPOSAL.yes + (pet.vote === 'yes' ? 1 : 0),
      no: PROPOSAL.no + (pet.vote === 'no' ? 1 : 0),
    },
  };
}

// The pet's mood of the day, derived from days-with-you. The list index is
// deterministic in the day count, so the line holds steady all day and
// steps to the next one at UTC midnight. No new tables; the client can
// render its own copy when state is absent.
const MOOD_LINES = [
  'Today your pet feels brand new.',
  'Today your pet feels settled in.',
  'Today your pet feels curious.',
  'Today your pet feels bouncy.',
  'Today your pet feels cozy.',
  'Today your pet feels chatty.',
  'Today your pet feels proud of you.',
];

function moodLine(days) {
  return MOOD_LINES[Math.max(0, days || 0) % MOOD_LINES.length];
}

// Steps only ever move forward. A stale tab can never rewind a member.
function advance(pet, step) {
  if (STEPS.indexOf(step) > STEPS.indexOf(pet.step)) pet.step = step;
}

// ---------------------------------------------------------------------------
// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// Registered BEFORE the auth middleware because these files are public: the
// platform serves them anonymously from any app origin, and a login redirect
// arriving where a <script> was expected is exactly the failure a relative
// path is meant to avoid.
// ---------------------------------------------------------------------------
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }

  // Static assets (CSS/JS/the vendored Lottie files) are always served; the
  // API and the HTML shell are gated so direct hits to the staging/prod
  // subdomain don't leak app data to the public internet.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

let shuttingDown = false;

app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting down' });
  res.json({ status: 'ok' });
});

// The app ships no favicon file; index.html carries an inline SVG icon
// instead. Answer 204 here so anything that still probes /favicon.ico
// doesn't fall through to the auth-gated catch-all and surface a 401.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ---------------------------------------------------------------------------
// API. Every action is a POST: a GET on an action route would fall through to
// the page below and hand the JSON caller a lump of HTML.
// ---------------------------------------------------------------------------

function handler(fn) {
  return async (req, res) => {
    try {
      const pet = await store.get(req.user.id, req.user.username);
      const out = await fn(pet, req, res);
      if (out === false) return; // the handler already answered (a 400)
      const saved = out === 'skip-save' ? pet : await store.save(pet);
      res.json(view(saved));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };
}

// Read. Creates the row, with the hashed species, on first call.
app.get('/api/state', handler(() => 'skip-save'));

app.post('/api/hatch', handler((pet) => {
  if (!pet.hatched_at) pet.hatched_at = new Date();
  advance(pet, 'pet');
}));

app.post('/api/feed', handler((pet) => {
  pet.food = Math.min(100, pet.food + 20);
}));

app.post('/api/play', handler((pet) => {
  pet.play = Math.min(100, pet.play + (pet.ball ? 25 : 10));
  pet.plays += 1;
}));

app.post('/api/agree', handler((pet) => {
  pet.agreed = true;
}));

app.post('/api/vote', handler((pet, req, res) => {
  const choice = req.body && req.body.choice;
  if (choice !== 'yes' && choice !== 'no') {
    res.status(400).json({ error: 'choice must be yes or no' });
    return false;
  }
  const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 24) : '';
  if (name) pet.name = name;
  pet.vote = choice;
  advance(pet, 'shipped');
}));

// Change the pet after it has hatched: a new name, a new type, or both.
// The egg stays untouched so the hatch moment keeps its surprise.
app.post('/api/pet', handler((pet, req, res) => {
  if (pet.step === 'egg') {
    res.status(400).json({ error: 'the egg has not hatched yet' });
    return false;
  }
  const body = req.body || {};
  if (body.species !== undefined) {
    if (typeof body.species !== 'string' || SPECIES.indexOf(body.species) === -1) {
      res.status(400).json({ error: 'unknown species' });
      return false;
    }
    pet.chosen_species = body.species;
  }
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      res.status(400).json({ error: 'name must be a string' });
      return false;
    }
    const name = body.name.trim().slice(0, 24);
    pet.name = name ? name : null;
  }
}));

app.post('/api/ship', handler((pet) => {
  pet.ball = true;
  advance(pet, 'home');
}));

app.post('/api/step', handler((pet, req, res) => {
  const step = req.body && req.body.step;
  if (!STEPS.includes(step)) {
    res.status(400).json({ error: 'unknown step' });
    return false;
  }
  advance(pet, step);
}));

// Staging only: wipe the caller's OWN row so onboarding can be replayed in a
// preview. 404 in production, where there is nothing to replay.
app.post('/api/reset', async (req, res) => {
  if (!IS_STAGING) return res.status(404).json({ error: 'Not found' });
  try {
    await store.reset(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Static assets, including the HTML shell at GET /. The shell is public on
// purpose: the platform's checks and capture containers navigate an app's
// routes with no token, so a token-gated / makes every declared check (and
// the free "loads with no console errors" baseline) fail and blocks the
// merge. Nothing is leaked by it — the shell boots empty and every /api/*
// route below stays deny-by-default.
app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case gets the "open in Homeroom" landing page instead of a
// redirect, so the platform shell is never loaded INSIDE its own app iframe.
app.get('*', (req, res) => {
  if (!req.user) {
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/patch-741877/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#f4f2e4;color:#121a0e;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#4a4740;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/patch-741877/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#0a6ee0;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await store.init();
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    server.close(() => {});
    if (server.closeIdleConnections) server.closeIdleConnections();
    setTimeout(async () => {
      try { await store.close(); } catch {}
      process.exit(0);
    }, 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

if (require.main === module) {
  start().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { app, start, store, speciesFor, STEPS, SPECIES, EMOJI, view, FEEDBACK, PROPOSAL, moodLine };
