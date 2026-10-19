'use strict';

// No database: server.js falls back to the in-memory store when
// DATABASE_URL is unset, and PORT=0 lets the OS pick a free port (the
// platform assigns the real one).
delete process.env.DATABASE_URL;
process.env.PORT = '0';
process.env.USERNODE_APP_ID = '741877';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
process.env.USERNODE_JWT_PUBLIC_KEY = publicKey;

const { app, speciesFor, SPECIES, EMOJI, applyHappiness, applyNeeds, NEEDS_DECAY_PER_DAY } = require('../server.js');

function tokenFor(id, username) {
  return jwt.sign(
    { id, username, pur: 'iframe' },
    privateKey,
    { algorithm: 'RS256', issuer: 'usernode', audience: 'usernode:app:741877', expiresIn: '1h' },
  );
}

let server, base;
test.before(() => new Promise((resolve) => {
  server = app.listen(0, () => {
    base = 'http://127.0.0.1:' + server.address().port;
    resolve();
  });
}));
test.after(() => new Promise((resolve) => server.close(resolve)));

function call(method, p, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-usernode-token'] = token;
  return fetch(base + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('speciesFor is deterministic and spreads ids across the manifest', () => {
  assert.equal(speciesFor('abc'), speciesFor('abc'));
  assert.equal(speciesFor(42), speciesFor('42'));

  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const s = speciesFor('user-' + i);
    assert.ok(SPECIES.includes(s), s + ' is not in SPECIES');
    seen.add(s);
  }
  assert.ok(seen.size >= 6, 'expected at least 6 species over 200 ids, got ' + seen.size);
});

test('every manifest entry has a vendored Lottie file', () => {
  for (const [key, e] of Object.entries(EMOJI)) {
    const file = path.join(__dirname, '..', 'public', 'emoji', e.cp + '.json');
    assert.ok(fs.existsSync(file), 'missing vendored file for ' + key);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(json.op > 0, key + ' has no out point');
    assert.ok(json.fr > 0, key + ' has no frame rate');
  }
});

test('the loop: hatch, feed, play, agree, vote, ship', async () => {
  const token = tokenFor('loop-tester', 'lukas');

  let v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.step, 'egg');
  assert.equal(v.pet.ball, false);
  assert.equal(v.pet.play, 20);
  assert.ok(SPECIES.includes(v.pet.species));

  v = await (await call('POST', '/api/hatch', { token })).json();
  assert.equal(v.pet.step, 'pet');
  assert.equal(typeof v.pet.days, 'number');
  assert.ok(v.pet.days >= 0, 'days should be 0 or more once hatched');

  await call('POST', '/api/play', { token });
  v = await (await call('POST', '/api/play', { token })).json();
  assert.equal(v.pet.plays, 2);
  assert.equal(v.pet.play, 40);

  v = await (await call('POST', '/api/step', { token, body: { step: 'feedback' } })).json();
  assert.equal(v.pet.step, 'feedback');
  v = await (await call('POST', '/api/step', { token, body: { step: 'egg' } })).json();
  assert.equal(v.pet.step, 'feedback', 'a step only moves forward');
  const badStep = await call('POST', '/api/step', { token, body: { step: 'nowhere' } });
  assert.equal(badStep.status, 400);

  v = await (await call('POST', '/api/agree', { token })).json();
  assert.equal(v.feedback.agrees, 5);

  const badVote = await call('POST', '/api/vote', { token, body: { choice: 'maybe' } });
  assert.equal(badVote.status, 400);

  await call('POST', '/api/step', { token, body: { step: 'vote' } });
  v = await (await call('POST', '/api/vote', { token, body: { choice: 'yes', name: 'Pebble' } })).json();
  assert.equal(v.pet.vote, 'yes');
  assert.equal(v.pet.name, 'Pebble');
  assert.equal(v.proposal.yes, 12);
  assert.equal(v.proposal.no, 1);
  assert.equal(v.pet.step, 'shipped');

  v = await (await call('POST', '/api/ship', { token })).json();
  assert.equal(v.pet.ball, true);
  assert.equal(v.pet.step, 'home');

  v = await (await call('POST', '/api/play', { token })).json();
  assert.equal(v.pet.play, 65);
});

test('pet stats show days from hatched_at and the hashed species', async () => {
  const token = tokenFor('stats-tester', 'stella');
  let v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.days, 0, 'an egg has no days yet');
  v = await (await call('POST', '/api/hatch', { token })).json();
  assert.equal(v.pet.days, 0, 'hatch day is day 0');
  const pgViewShape = { species: v.pet.species, days: v.pet.days };
  assert.ok(SPECIES.includes(pgViewShape.species));
  assert.equal(pgViewShape.days, 0);
});

test('happiness gets its once-a-day visit bonus and never overfills', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const hatchDay = new Date(now.getTime() - 3600 * 1000);
  // Hatch day: elapsed < 1 day, so no bonus and no decay.
  assert.equal(applyHappiness({ happiness: 50, hatched_at: hatchDay }, now), 50);
  // One full day later, the visit bonus lands: 50 - 15 + 20 = 55.
  const nextDay = new Date(now.getTime() + 86400000);
  assert.equal(applyHappiness({ happiness: 50, hatched_at: hatchDay, happiness_at: hatchDay }, nextDay), 55);
  assert.equal(applyHappiness({ happiness: 95, hatched_at: hatchDay, happiness_at: hatchDay }, nextDay), 100);
});

test('happiness decays for every full day since the last visit', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
  // 80 - 45 decay + 20 visit bonus = 55.
  assert.equal(applyHappiness({ happiness: 80, hatched_at: threeDaysAgo, happiness_at: threeDaysAgo }, now), 55);
  // 30 - 45 decay + 20 = 5.
  assert.equal(applyHappiness({ happiness: 30, hatched_at: threeDaysAgo, happiness_at: threeDaysAgo }, now), 5);
  // Far decayed: the bonus and the clamp both keep it out of the negatives.
  const longAgo = new Date(now.getTime() - 10 * 86400000);
  assert.equal(applyHappiness({ happiness: 40, hatched_at: longAgo, happiness_at: longAgo }, now), 0);
});

test('an unhatched egg keeps its happiness untouched', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const egg = { happiness: 20, hatched_at: null, happiness_at: new Date(now.getTime() - 5 * 86400000) };
  assert.equal(applyHappiness(egg, now), 20);
});

// --- needs decay (food and play) ---

test('an unhatched egg keeps its needs untouched', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const egg = { food: 40, play: 20, hatched_at: null, food_at: null, play_at: null };
  applyNeeds(egg, now);
  assert.equal(egg.food, 40);
  assert.equal(egg.play, 20);
  assert.equal(egg.food_at, null);
  assert.equal(egg.play_at, null);
});

test('needs decay is ' + NEEDS_DECAY_PER_DAY + ' per full day, and nothing else', () => {
  assert.equal(NEEDS_DECAY_PER_DAY, 10);
  const now = new Date('2026-09-26T12:00:00Z');
  const stamp = new Date(now.getTime() - 23 * 3600 * 1000);
  // Less than a full day: nothing moves, not even the stamp.
  const fresh = { food: 60, play: 45, hatched_at: stamp, food_at: stamp, play_at: stamp };
  applyNeeds(fresh, now);
  assert.equal(fresh.food, 60);
  assert.equal(fresh.play, 45);
  assert.equal(fresh.food_at, stamp);
  // Three full days since the stamps: 60 - 30 = 30 and 45 - 30 = 15.
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
  const pet = { food: 60, play: 45, hatched_at: threeDaysAgo, food_at: threeDaysAgo, play_at: threeDaysAgo };
  applyNeeds(pet, now);
  assert.equal(pet.food, 30);
  assert.equal(pet.play, 15);
  // The stamp advances by whole days only. Here the stamp sat exactly three
  // days back, so the new stamp lands exactly on `now` with no remainder.
  assert.equal(pet.food_at.getTime(), now.getTime());
});

test('needs fall back to hatched_at when their stamps are null', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400000);
  const pet = { food: 60, play: 45, hatched_at: twoDaysAgo, food_at: null, play_at: null };
  applyNeeds(pet, now);
  assert.equal(pet.food, 40, '60 - 2 days of decay');
  assert.equal(pet.play, 25, '45 - 2 days of decay');
});

test('needs clamp at 0 and never go negative', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const tenDaysAgo = new Date(now.getTime() - 10 * 86400000);
  const pet = { food: 20, play: 90, hatched_at: tenDaysAgo, food_at: tenDaysAgo, play_at: tenDaysAgo };
  applyNeeds(pet, now);
  assert.equal(pet.food, 0);
  assert.equal(pet.play, 0);
});

test('needs carry the unfinished part of a day over', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  // 1.5 days since the stamp: one full day counts, half a day is pending.
  const stamp = new Date(now.getTime() - 1.5 * 86400000);
  const pet = { food: 60, hatched_at: stamp, food_at: stamp, play: 45, play_at: stamp };
  applyNeeds(pet, now);
  assert.equal(pet.food, 50);
  assert.equal(pet.food_at.getTime(), stamp.getTime() + 86400000, 'new stamp is baseline plus one day');
  // Applying it again at the same moment changes nothing: idempotent.
  const again = { ...pet };
  applyNeeds(again, now);
  assert.equal(again.food, 50);
  assert.equal(again.food_at.getTime(), pet.food_at.getTime());
});

test('feeding still adds on top of the decay', async () => {
  const token = tokenFor('needs-tester', 'nadia');
  // Hatch right here: the fresh pet's meters start at their defaults.
  let v = await (await call('POST', '/api/hatch', { token })).json();
  assert.equal(v.pet.food, 40);
  v = await (await call('POST', '/api/feed', { token })).json();
  assert.equal(v.pet.food, 60, 'feed still behaves as before');
});

test('the pet state carries happiness beside food and play', async () => {
  const token = tokenFor('happy-tester', 'hana');
  let v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.happiness, 50);
  v = await (await call('POST', '/api/hatch', { token })).json();
  assert.equal(typeof v.pet.happiness, 'number');
  assert.ok(v.pet.happiness >= 0 && v.pet.happiness <= 100);
  v = await (await call('POST', '/api/feed', { token })).json();
  assert.equal(v.pet.food, 60, 'food still behaves as before');
  assert.ok(v.pet.happiness >= 0 && v.pet.happiness <= 100);
});

test('POST /api/pet changes name and species after hatching', async () => {
  const token = tokenFor('change-tester', 'cleo');
  await call('POST', '/api/hatch', { token });

  let v = await (await call('POST', '/api/pet', { token, body: { species: 'frog', name: 'Beans' } })).json();
  assert.equal(v.pet.species, 'frog');
  assert.equal(v.pet.name, 'Beans');

  v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.species, 'frog', 'the choice persists across a fresh read');
  assert.equal(v.pet.name, 'Beans');

  // The original hash stays stored; the choice wins only in the view.
  v = await (await call('POST', '/api/pet', { token, body: { name: '' } })).json();
  assert.equal(v.pet.species, 'frog', 'a name-only save keeps the chosen species');
  assert.equal(v.pet.name, null, 'an empty name clears back to null');

  const bad = await call('POST', '/api/pet', { token, body: { species: 'dragon' } });
  assert.equal(bad.status, 400);

  const badName = await call('POST', '/api/pet', { token, body: { name: 7 } });
  assert.equal(badName.status, 400);
});

test('POST /api/pet refuses an unhatched egg', async () => {
  const token = tokenFor('egg-tester', 'erin');
  await (await call('GET', '/api/state', { token })).json();
  const res = await call('POST', '/api/pet', { token, body: { species: 'frog' } });
  assert.equal(res.status, 400);
});

test('the birthday is set, shown, cleared and persisted per pet', async () => {
  const token = tokenFor('birthday-tester', 'bree');
  await call('POST', '/api/hatch', { token });

  let v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.birthday, null, 'a fresh pet has no birthday');
  assert.equal(v.pet.birthday_today, false);

  v = await (await call('POST', '/api/pet', { token, body: { birthday: '2020-02-29' } })).json();
  assert.equal(v.pet.birthday, '2020-02-29');

  v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.birthday, '2020-02-29', 'the birthday persists across a fresh read');

  v = await (await call('POST', '/api/pet', { token, body: { birthday: '' } })).json();
  assert.equal(v.pet.birthday, null, 'an empty string clears the birthday');

  v = await (await call('POST', '/api/pet', { token, body: { birthday: null } })).json();
  assert.equal(v.pet.birthday, null);

  const bad = await call('POST', '/api/pet', { token, body: { birthday: 'Feb 29' } });
  assert.equal(bad.status, 400);

  const bad2 = await call('POST', '/api/pet', { token, body: { birthday: '2020-13-01' } });
  assert.equal(bad2.status, 400);
});

test('birthday_today is true only on the day, server-computed', async () => {
  const token = tokenFor('birthdayday-tester', 'dana');
  await call('POST', '/api/hatch', { token });

  // A birthday stored for a date that is not today is never "today".
  let v = await (await call('POST', '/api/pet', { token, body: { birthday: '2001-01-01' } })).json();
  assert.equal(v.pet.birthday_today, false);

  // Today's own date (UTC, the same clock the server stamps happiness with)
  // lights the flag without any client involvement.
  const today = new Date().toISOString().slice(0, 10);
  v = await (await call('POST', '/api/pet', { token, body: { birthday: today } })).json();
  assert.equal(v.pet.birthday, today);
  assert.equal(v.pet.birthday_today, true);
});

test('POST /api/pet still refuses an unhatched egg with a birthday', async () => {
  const token = tokenFor('eggbday-tester', 'elif');
  await (await call('GET', '/api/state', { token })).json();
  const res = await call('POST', '/api/pet', { token, body: { birthday: '2020-02-29' } });
  assert.equal(res.status, 400);
});

test('the trick checklist persists per pet and validates the trick name', async () => {
  const token = tokenFor('trick-tester', 'tara');
  await call('POST', '/api/hatch', { token });

  let v = await (await call('GET', '/api/state', { token })).json();
  assert.deepEqual(v.pet.tricks, [
    { trick: 'sit', done: false },
    { trick: 'stay', done: false },
    { trick: 'spin', done: false },
  ]);
  assert.equal(v.pet.tricks_complete, false);
  assert.equal(v.pet.tricks_celebrated, false);

  v = await (await call('POST', '/api/trick', { token, body: { trick: 'sit', done: true } })).json();
  assert.equal(v.pet.tricks.filter((t) => t.trick === 'sit')[0].done, true);
  assert.equal(v.pet.tricks_complete, false);

  v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.tricks.filter((t) => t.trick === 'sit')[0].done, true, 'the toggle persists');

  // Unsetting a trick works both ways.
  v = await (await call('POST', '/api/trick', { token, body: { trick: 'sit', done: false } })).json();
  assert.equal(v.pet.tricks.filter((t) => t.trick === 'sit')[0].done, false);

  const bad = await call('POST', '/api/trick', { token, body: { trick: 'backflip' } });
  assert.equal(bad.status, 400);
});

test('the celebration stamps once per pet and never replays after a reload', async () => {
  const token = tokenFor('party-tester', 'paul');
  await call('POST', '/api/hatch', { token });

  let v = await (await call('POST', '/api/trick', { token, body: { trick: 'sit', done: true } })).json();
  assert.equal(v.pet.tricks_celebrated, false, 'one of three is not the moment');
  v = await (await call('POST', '/api/trick', { token, body: { trick: 'stay', done: true } })).json();
  assert.equal(v.pet.tricks_celebrated, false, 'two of three is not the moment');

  v = await (await call('POST', '/api/trick', { token, body: { trick: 'spin', done: true } })).json();
  assert.equal(v.pet.tricks_complete, true);
  assert.equal(v.pet.tricks_celebrated, true, 'the third done flag stamps the celebration');

  // A reload re-reads the flag, never the missing overlay: the same answer
  // arrives with or without another write in between.
  v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.tricks_celebrated, true);
  v = await (await call('POST', '/api/trick', { token, body: { trick: 'sit', done: true } })).json();
  assert.equal(v.pet.tricks_celebrated, true, 'a redundant toggle does not re-stamp');
  v = await (await call('POST', '/api/trick', { token, body: { trick: 'sit', done: false } })).json();
  assert.equal(v.pet.tricks_celebrated, true, 'un-landing a trick does not clear the stamp');
  v = await (await call('POST', '/api/trick', { token, body: { trick: 'sit', done: true } })).json();
  assert.equal(v.pet.tricks_celebrated, true, 're-completing does not celebrate twice');

  // Start over clears everything, celebration included.
  const reset = process.env.USERNODE_ENV === 'staging';
  if (reset) {
    v = await (await call('POST', '/api/reset', { token })).json();
    v = await (await call('GET', '/api/state', { token })).json();
    assert.equal(v.pet.tricks_celebrated, false);
  }
});

// The shell is public so the platform's tokenless check and capture
// containers can render it; every route that carries a pet is not.
test('without a token the data is closed but the shell renders', async () => {
  assert.equal((await call('GET', '/api/state')).status, 401);
  assert.equal((await call('POST', '/api/feed')).status, 401);
  assert.equal((await call('POST', '/api/hatch')).status, 401);
  const shell = await call('GET', '/');
  assert.equal(shell.status, 200);
  const html = await shell.text();
  assert.match(html, /id="egg"/);
  assert.equal((await call('GET', '/health')).status, 200);
});

test('every stage is a framed scene and the pet screen keeps its meters', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const stages = html.match(/<div class="stage[^"]*"/g) || [];
  assert.equal(stages.length, 4, 'expected four stages');
  for (const s of stages) assert.ok(/\bscene\b/.test(s), s + ' is not a scene');
  assert.ok(html.includes('id="meter-food"'));
  assert.ok(html.includes('id="meter-play"'));
  assert.ok(html.includes('usernode-dev-console@1'), 'the dev console forwarder must stay');
});

test('tapping the pet says hi and the pet reads as tappable', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'patch.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'patch.css'), 'utf8');
  assert.match(
    js, /\$\('pet-sticker'\)\.addEventListener\('click'/,
    'the pet sticker has no click listener');
  assert.ok(js.includes("'hi.'"), 'patch.js has no hi. greeting line');
  assert.match(
    css, /#pet-sticker\s*\{[^}]*cursor:\s*pointer/,
    'the pet sticker does not show a pointer cursor');
});

test('the menu is navigation chrome: client-side, never a stored step', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'patch.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'patch.css'), 'utf8');

  // The home footer offers the menu, and the menu beat exists hidden.
  assert.match(html, /id="home-foot"[^>]*>[\s\S]*?id="btn-menu"/, 'the home footer has no Menu link');
  assert.match(html, /<section class="beat" data-beat="menu" hidden>/, 'the menu beat is missing or not hidden');
  for (const id of ['menu-pet', 'menu-tricks', 'menu-change-pet', 'menu-about', 'btn-menu-back', 'menu-reset']) {
    assert.ok(html.includes('id="' + id + '"'), 'the menu is missing #' + id);
  }

  // Wiring: show('menu') directly — a goStep('menu') would POST /api/step,
  // which the server's STEPS list rejects with a 400.
  assert.match(js, /\$\('btn-menu'\)\.addEventListener\('click'/, 'the Menu link is not wired');
  assert.ok(js.includes("show('menu')"), 'patch.js never shows the menu beat');
  assert.ok(!js.includes("goStep('menu')"), 'the menu must not be sent to /api/step');
  assert.match(js, /skipBtn\.hidden = homeLike/, 'the Skip button must hide on the menu too');

  // The staging-only Start over link mirrors the footer's, and the rows
  // carry their hint style.
  assert.match(js, /\$\('menu-reset'\)\.hidden = !state\.staging/, 'the menu reset link does not mirror staging');
  assert.match(css, /\.trick-check \.why\s*\{/, 'the menu hint has no style');
});

test('the motion choice saves per member and restores on a fresh read', async () => {
  const token = tokenFor('motion-tester', 'milo');
  let v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.motion, null, 'a fresh member follows the system setting');

  v = await (await call('POST', '/api/motion', { token, body: { motion: 'off' } })).json();
  assert.equal(v.pet.motion, 'off');

  // The reload: a fresh read returns what the member saved.
  v = await (await call('GET', '/api/state', { token })).json();
  assert.equal(v.pet.motion, 'off', 'the saved choice does not survive only in the page');

  // Per member, not per app: another account is untouched.
  const other = tokenFor('motion-other', 'mabel');
  const v2 = await (await call('GET', '/api/state', { token: other })).json();
  assert.equal(v2.pet.motion, null);

  // Switching back works, and the API validates the value like /api/step does.
  v = await (await call('POST', '/api/motion', { token, body: { motion: 'on' } })).json();
  assert.equal(v.pet.motion, 'on');
  const bad = await call('POST', '/api/motion', { token, body: { motion: 'maybe' } });
  assert.equal(bad.status, 400);
});

test('reduced motion rules exist for both the system setting and the member toggle', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'patch.css'), 'utf8');
  // The system preference keeps its media query.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/,
    'the system prefers-reduced-motion media query is gone');
  // The member toggle applies the same rules through a class.
  assert.match(css, /html\.reduced \.egg\s*\{[^}]*animation:\s*none/,
    'the reduced class does not stop the egg wobble');
  assert.match(css, /html\.reduced \.pet-box\.hop[^{]*\{[^}]*transform:\s*none/,
    'the reduced class does not stop the pet bounce');
  assert.match(css, /@keyframes un-fade/,
    'the quick fade the transitions collapse to is missing');
  assert.match(css, /html\.reduced \.speech[^{]*\{[^}]*un-fade/,
    'transitions do not collapse to quick fades under the reduced class');
});

test('the reduced-motion rules change animation only, never geometry', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'patch.css'), 'utf8');
  const rules = css.match(/html\.reduced[^{}]*\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 10, 'expected the full reduced-motion rule set, got ' + rules.length);
  const allowed = new Set(['animation', 'transition', 'transform', 'opacity']);
  for (const rule of rules) {
    const body = rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'));
    for (const decl of body.split(';')) {
      const prop = decl.split(':')[0].trim();
      if (prop) assert.ok(allowed.has(prop),
        'reduced motion sets ' + prop + ', which can shift the layout');
    }
  }
});

test('the Motion toggle is wired, saves per member and leaves sound alone', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'patch.js'), 'utf8');

  assert.ok(html.includes('id="menu-motion"'), 'the footer menu has no Motion toggle');
  assert.match(js, /\$\('menu-motion'\)\.addEventListener\('click'/,
    'the Motion toggle is not wired');
  assert.match(js, /api\('\/api\/motion'/, 'the toggle must save the choice for the member');
  assert.match(js, /pet\.motion/, 'the server answer does not drive the motion state');
  assert.match(js, /patch:motion/, 'the choice is not mirrored so a reload can restore it');
  assert.match(js, /classList\.toggle\('reduced'/, 'the reduced class is never applied');
  assert.match(js, /prefers-reduced-motion/, 'the system preference is not read');
  // The label carries the state word, so a member can read the current state.
  assert.match(js, /textContent = reduce \? 'off' : 'on'/, 'the toggle label does not reflect the state');

  // Sound is out of scope: the reduced-motion section must not touch audio.
  const motion = js.slice(js.indexOf('// ---- reduced motion'), js.indexOf('// ---- rendering'));
  assert.ok(motion.length > 0, 'the reduced motion section is missing');
  assert.ok(!/\bAudio\b|\.muted|\.volume/.test(motion), 'reduced motion must not touch audio');
});

test('every species has five age lines in its own voice', () => {
  for (const key of SPECIES) {
    const e = EMOJI[key];
    assert.ok(Array.isArray(e.ages) && e.ages.length === 5, key + ' needs five age lines');
    const opening = e.line.slice(0, e.line.indexOf('.'));
    e.ages.forEach((age, i) => {
      assert.equal(typeof age, 'string');
      assert.ok(age.trim().length > 0, key + ' age line ' + i + ' is empty');
      assert.equal(age.slice(0, age.indexOf('.')), opening,
        key + ' age line ' + i + ' must keep the species opening sentence');
    });
  }
});

test('lineFor picks the bucket by days', () => {
  const manifest = require('../public/emoji-manifest.js');
  assert.equal(typeof manifest.lineFor, 'function', 'the manifest exports lineFor');
  const lineFor = manifest.lineFor;
  const e = EMOJI.turtle;

  for (const days of [undefined, null, 0]) {
    assert.equal(lineFor('turtle', days), e.line, 'days ' + days + ' keeps the hatch-day line');
  }
  assert.equal(lineFor('turtle', 1), e.ages[0]);
  assert.equal(lineFor('turtle', 6), e.ages[0]);
  assert.equal(lineFor('turtle', 7), e.ages[1]);
  assert.equal(lineFor('turtle', 29), e.ages[1]);
  assert.equal(lineFor('turtle', 30), e.ages[2]);
  assert.equal(lineFor('turtle', 99), e.ages[2]);
  assert.equal(lineFor('turtle', 100), e.ages[3]);
  assert.equal(lineFor('turtle', 364), e.ages[3]);
  assert.equal(lineFor('turtle', 365), e.ages[4]);
  assert.equal(lineFor('turtle', 2000), e.ages[4]);
});

test('every visual dapp.json test carries id, impact and a readiness assertion', () => {
  const dapp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dapp.json'), 'utf8'));
  const visual = dapp.tests.filter((t) => t.visual);
  assert.ok(visual.length >= 1, 'expected at least one visual test');
  for (const t of visual) {
    assert.ok(t.id, t.name + ' has no id');
    assert.ok(Array.isArray(t.impact) && t.impact.length, t.name + ' has no impact');
    assert.ok(t.expectSelector || t.expectText, t.name + ' has no expectSelector or expectText');
  }
});
