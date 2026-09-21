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

const { app, speciesFor, SPECIES, EMOJI } = require('../server.js');

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
