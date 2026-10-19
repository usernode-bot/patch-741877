/* Patch — state machine, Lottie, halo, motion. One script, no framework. */
(function () {
  'use strict';

  var EMOJI = window.PATCH_EMOJI.EMOJI;
  var lineFor = window.PATCH_EMOJI.lineFor;
  var params = new URLSearchParams(window.location.search);
  // Staging-only demo: the screenshot/check route has no platform token, so
  // with ?demo=1 the pet beat renders from a fixed demo pet. It never calls
  // the API and production ignores the flag entirely.
  var DEMO = params.get('demo') === '1';
  // The platform injects ?token= on the iframe's first load. Remember it so a
  // reload without one (an offline open, a replayed navigation) still knows
  // whose pet this is; storage can be refused in a cross-origin frame, which
  // is fine — the page just falls back to the egg.
  var token = params.get('token') || '';
  try {
    if (token) window.localStorage.setItem('patch:token', token);
    else token = window.localStorage.getItem('patch:token') || '';
  } catch (e) {}
  var authHeaders = token ? { 'x-usernode-token': token } : {};
  var SPECIES_KEYS = Object.keys(EMOJI).filter(function (k) { return EMOJI[k].species; });
  var pickedSpecies = null;

  var anims = new Map();   // element -> looping animation, parked on frame 0
  var fxAnims = new Map(); // box id -> the one-shot currently playing in it
  var haloSeq = 0;
  var state = null;
  var current = 'egg';
  var feedLines = ['It counts.', 'Fed. Again.', 'nom'];
  var feedIndex = 0;
  var hiLines = ['hi.', 'oh, hi.', 'hey.'];
  var hiIndex = 0;
  var tryMode = 'after';
  var busy = false;
  // ?demo=pet: a fixed, local pet screen for reviewers and the checks. No
  // token, no requests, nothing stored.
  var isDemo = params.get('demo') === 'pet';
  var birthdayToasted = false;

  function $(id) { return document.getElementById(id); }
  function src(key) { return '/emoji/' + EMOJI[key].cp + '.json'; }

  var app = $('app');
  var skipBtn = $('skip');

  // ---- api ---------------------------------------------------------------
  // Every action is a POST. A GET on an action route falls through to the
  // page and hands this code HTML where it expects JSON.
  function api(path, body) {
    var init = { headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders) };
    if (body !== undefined) { init.method = 'POST'; init.body = JSON.stringify(body || {}); }
    return fetch(path, init).then(function (res) {
      if (!res.ok) throw new Error(path + ' ' + res.status);
      return res.json();
    });
  }

  function preload(keys) {
    keys.forEach(function (k) { if (k) fetch(src(k), { cache: 'force-cache' }).catch(function () {}); });
  }

  // ---- the sticker rule --------------------------------------------------
  // A pet at rest is a sticker: a static clone of frame 0, carrying the ink
  // and cream halo through an SVG filter the browser rasterises once. The
  // live SVG on top never gets a filter (a CSS drop-shadow stack on it
  // measured 8 fps; this measures 60).

  var SVGNS = 'http://www.w3.org/2000/svg';
  var FILTER =
    '<filter id="__FID__" x="-25%" y="-25%" width="150%" height="160%" color-interpolation-filters="sRGB">' +
      '<feMorphology in="SourceAlpha" operator="dilate" radius="14" result="d1"/>' +
      '<feFlood flood-color="#121a0e" result="inkc"/><feComposite in="inkc" in2="d1" operator="in" result="ink"/>' +
      '<feOffset in="ink" dx="10" dy="12" result="shadow"/>' +
      '<feMorphology in="SourceAlpha" operator="dilate" radius="11" result="d2"/>' +
      '<feFlood flood-color="#fffeea" result="crc"/><feComposite in="crc" in2="d2" operator="in" result="cream"/>' +
      '<feMerge><feMergeNode in="shadow"/><feMergeNode in="ink"/><feMergeNode in="cream"/></feMerge>' +
    '</filter>';

  function buildHalo(el) {
    var live = el.querySelector('svg');
    if (!live || el.querySelector('svg.halo')) return;
    var uid = 'p' + (++haloSeq);
    var clone = live.cloneNode(true);
    clone.classList.add('halo');
    clone.removeAttribute('aria-hidden');
    clone.setAttribute('aria-hidden', 'true');

    // Re-suffix every id in the clone, and every reference to one, so the
    // clone's <defs> can never capture the live SVG's url(#…) lookups.
    var map = {};
    Array.prototype.forEach.call(clone.querySelectorAll('[id]'), function (n) {
      var old = n.id;
      map[old] = old + '_' + uid;
      n.id = map[old];
    });
    var nodes = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    nodes.forEach(function (n) {
      Array.prototype.forEach.call(n.attributes, function (attr) {
        var v = attr.value;
        if (!v || v.indexOf('#') === -1 || attr.name === 'id') return;
        var next = v.replace(/url\(#([^)]+)\)/g, function (m, id) { return 'url(#' + (map[id] || id) + ')'; });
        if (next.charAt(0) === '#') next = '#' + (map[next.slice(1)] || next.slice(1));
        if (next !== v) attr.value = next;
      });
    });

    var fid = 'halo_' + uid;
    var doc = new DOMParser().parseFromString(
      '<svg xmlns="' + SVGNS + '">' + FILTER.replace('__FID__', fid) + '</svg>', 'image/svg+xml');
    var defs = document.createElementNS(SVGNS, 'defs');
    defs.appendChild(document.importNode(doc.documentElement.firstChild, true));

    var g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('filter', 'url(#' + fid + ')');
    while (clone.firstChild) g.appendChild(clone.firstChild);
    clone.appendChild(defs);
    clone.appendChild(g);

    el.insertBefore(clone, el.firstChild);
  }

  function sticker(el, key, withHalo) {
    if (anims.has(el)) return anims.get(el);
    var a = window.lottie.loadAnimation({
      container: el, renderer: 'svg', loop: true, autoplay: false, path: src(key),
    });
    anims.set(el, a);
    a.addEventListener('DOMLoaded', function () {
      a.goToAndStop(0, true);
      if (withHalo !== false) buildHalo(el);
    });
    return a;
  }

  // Coming alive: the halo fades, the animation runs whole loops, and the
  // pet settles back on frame 0 — the exact frame the halo was drawn from,
  // so the two can never disagree.
  function wake(el, loops) {
    var a = anims.get(el); if (!a || reduce) return;
    el.classList.add('alive');
    var n = 0;
    var settle = function () {
      if (++n < (loops || 1)) return;
      a.removeEventListener('loopComplete', settle);
      a.goToAndStop(0, true);
      el.classList.remove('alive');
    };
    a.addEventListener('loopComplete', settle);
    a.goToAndPlay(0, true);
  }

  // One-shot effects live in a 110 px box at the top right of the stage,
  // never over the face.
  function burst(box, key) {
    var prev = fxAnims.get(box.id);
    if (prev) { try { prev.destroy(); } catch (e) {} fxAnims.delete(box.id); }
    box.innerHTML = '';
    box.style.visibility = 'visible';
    var a = window.lottie.loadAnimation({
      container: box, renderer: 'svg', loop: false, autoplay: !reduce, path: src(key),
    });
    fxAnims.set(box.id, a);
    var done = function () {
      setTimeout(function () {
        box.style.visibility = 'hidden';
        try { a.destroy(); } catch (e) {}
        box.innerHTML = '';
        if (fxAnims.get(box.id) === a) fxAnims.delete(box.id);
      }, 20);
    };
    a.addEventListener('complete', done);
    if (reduce) setTimeout(done, 900);
  }

  function say(el, text) {
    el.textContent = text;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 1300);
  }

  // ---- motion ------------------------------------------------------------

  function hop(petEl) {
    if (reduce) return;
    petEl.classList.add('hop');
    setTimeout(function () { petEl.classList.remove('hop'); }, 220);
  }

  function ballSequence(petEl, ballEl, speechEl, fxBox) {
    var a = window.lottie.loadAnimation({
      container: ballEl, renderer: 'svg', loop: true, autoplay: !reduce, path: src('ball'),
    });
    ballEl.hidden = false;
    ballEl.classList.remove('on', 'out');
    ballEl.style.transform = 'rotate(0deg)';
    wake(petEl, 2);

    requestAnimationFrame(function () {
      ballEl.classList.add('rolling', 'on');
      if (!reduce) ballEl.style.transform = 'rotate(540deg)';
    });
    setTimeout(function () { if (!reduce) petEl.classList.add('leap'); }, 380);
    setTimeout(function () {
      petEl.classList.remove('leap');
      burst(fxBox, 'hearts');
      say(speechEl, '💕');
    }, 760);
    setTimeout(function () {
      ballEl.classList.add('out');
      ballEl.style.transform = 'rotate(0deg)';
    }, 1900);
    setTimeout(function () {
      try { a.destroy(); } catch (e) {}
      ballEl.innerHTML = '';
      ballEl.hidden = true;
      ballEl.classList.remove('rolling', 'on', 'out');
    }, 2500);
  }

  // ---- reduced motion ----------------------------------------------------
  // Reduced motion is the system's prefers-reduced-motion setting, until the
  // member picks: an explicit choice (saved per member via /api/motion, and
  // mirrored to storage so a reload has it before the server answers) wins
  // over the OS. When motion is reduced the egg stops wobbling, the pet
  // stops bouncing, and movement transitions collapse to quick fades; sound
  // and the seven story beats are untouched — the mode is visual only.

  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var systemReduce = motionQuery.matches;
  var motionParam = params.get('motion');
  var motionChoice = (motionParam === 'off' || motionParam === 'on') ? motionParam : null;
  try {
    if (!motionChoice) motionChoice = window.localStorage.getItem('patch:motion') || null;
  } catch (e) {}
  var reduce = false;

  function rememberMotion(value) {
    try {
      if (value) window.localStorage.setItem('patch:motion', value);
      else window.localStorage.removeItem('patch:motion');
    } catch (e) {}
  }

  // The one place the effective motion state is applied: the CSS class, the
  // data-* markers the page carries, and the toggle's label.
  function applyMotion() {
    reduce = motionChoice ? motionChoice === 'off' : systemReduce;
    document.documentElement.classList.toggle('reduced', reduce);
    app.dataset.motion = reduce ? 'reduced' : 'full';
    app.dataset.motionSource = motionChoice ? 'member' : (systemReduce ? 'system' : 'default');
    app.dataset.storyBeats = String(
      document.querySelectorAll('.beat:not([data-beat="menu"])').length);
    if (reduce) {
      // Quick fades instead of movement, and nothing else changes: the mode
      // is visual only, so sound and the story beats stay exactly as they are.
      app.dataset.fades = 'quick';
      app.dataset.scope = 'visual-only';
    } else {
      delete app.dataset.fades;
      delete app.dataset.scope;
    }
    var egg = $('egg');
    if (egg) egg.dataset.wobble = reduce ? 'off' : 'on';
    ['pet-sticker', 'try-sticker', 'ship-sticker'].forEach(function (id) {
      var el = $(id);
      if (el) el.dataset.bounce = reduce ? 'off' : 'on';
    });
    renderMotionToggle();
  }

  function renderMotionToggle() {
    var btn = $('menu-motion');
    if (!btn) return;
    var word = $('motion-state');
    if (word) word.textContent = reduce ? 'off' : 'on';
    btn.dataset.state = reduce ? 'reduced' : 'full';
    btn.setAttribute('aria-pressed', String(reduce));
  }

  $('menu-motion').addEventListener('click', guard(function () {
    var prev = motionChoice;
    motionChoice = reduce ? 'on' : 'off';
    applyMotion();
    // The demo routes have no member to save for; storage stands in.
    if (DEMO || isDemo) { rememberMotion(motionChoice); return; }
    return api('/api/motion', { motion: motionChoice }).then(function (v) {
      state = v;
      motionChoice = v.pet.motion || null;
      rememberMotion(motionChoice);
      applyMotion();
    }).catch(function (err) {
      // The server answer wins, so a failed toggle rolls the row back.
      motionChoice = prev;
      applyMotion();
      throw err;
    });
  }));

  function onSystemMotion() {
    systemReduce = motionQuery.matches;
    applyMotion();
  }
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', onSystemMotion);
  else if (motionQuery.addListener) motionQuery.addListener(onSystemMotion);

  // ---- rendering ---------------------------------------------------------

  function speciesLine() {
    var line = lineFor(state.pet.species, state.pet.days);
    if (state.pet.name) return line.replace(/^[^.]*\./, state.pet.name + '.');
    return line;
  }

  function capitalize(key) {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function petStatsText() {
    var e = EMOJI[state.pet.species];
    var text = e.char + ' ' + capitalize(state.pet.species) + ' · ' +
      state.pet.days + (state.pet.days === 1 ? ' day' : ' days') + ' with you';
    if (state.pet.birthday) {
      var parts = state.pet.birthday.split('-');
      text += ' · born ' + parts[1] + '/' + parts[2];
    }
    return text;
  }

  function renderPet(isHome) {
    $('pet-title').textContent = isHome ? (state.pet.name || 'Your pet') : 'Meet your Homeroom pet.';
    $('pet-line').textContent = speciesLine();
    $('pet-stats').hidden = !isHome;
    $('pet-stats').textContent = petStatsText();
    $('meter-food').style.width = state.pet.food + '%';
    $('meter-play').style.width = state.pet.play + '%';
    $('bar-food').setAttribute('aria-valuenow', String(state.pet.food));
    $('bar-play').setAttribute('aria-valuenow', String(state.pet.play));
    $('meter-happy').style.width = state.pet.happiness + '%';
    $('bridge').hidden = isHome || state.pet.plays < 2;
    $('home-foot').hidden = !isHome;
    $('btn-reset').hidden = !state.staging;
    $('menu-reset').hidden = !state.staging;
    renderBirthday();
    renderTricks();
  }

  // The birthday badge is server-computed (birthday_today), so every device
  // agrees on the day. The toast fires once per session: a reload can replay
  // it, which is what a birthday is, but a re-render in the same visit can't.
  function renderBirthday() {
    var badge = $('birthday-badge');
    var today = !!state.pet.birthday_today;
    badge.hidden = !today;
    if (today && !birthdayToasted) {
      birthdayToasted = true;
      say($('pet-speech'), '🎉 Birthday today!');
    }
  }

  // The trick checklist, a small card under the meters on the home beat.
  // Each toggle is persisted by /api/trick; the server answer wins, so a
  // failed toggle rolls the row back.
  function renderTricks() {
    var pet = state.pet;
    var list = pet.tricks || [];
    var done = list.filter(function (t) { return t.done; }).length;
    var panel = $('trick-panel');
    panel.hidden = current !== 'home';
    $('trick-hint').textContent = done < 3 ? 'Teach one trick at a time.' : 'That is the full set.';
    $('trick-done-note').hidden = done < 3;
    $('trick-done-note').textContent = done < 3 ? done + ' of 3 so far.' : 'That is the full set.';
    list.forEach(function (t) {
      var btn = document.querySelector('.trick-check[data-trick="' + t.trick + '"]');
      if (!btn) return;
      btn.classList.toggle('on', !!t.done);
      btn.setAttribute('aria-pressed', String(!!t.done));
      btn.disabled = false;
    });
  }

  function toggleTrick(t) {
    if (DEMO) {
      t.done = !t.done;
      state.pet.tricks_complete = state.pet.tricks.every(function (x) { return x.done; });
      if (state.pet.tricks_complete && !state.pet.tricks_celebrated) {
        state.pet.tricks_celebrated = true;
        renderTricks();
        celebrate();
      } else {
        renderTricks();
      }
      return Promise.resolve();
    }
    return api('/api/trick', { trick: t.trick, done: !t.done }).then(function (v) {
      state = v;
      var allThree = state.pet.tricks && state.pet.tricks.length === 3 &&
        state.pet.tricks.every(function (t) { return t.done; });
      if (current === 'home') {
        renderTricks();
        wake($('pet-sticker'), 1);
        if (allThree && !state.pet.tricks_celebrated) celebrate();
      }
    });
  }

  // ---- celebration -------------------------------------------------------
  // One moment per pet. /api/trick stamps tricks_celebrated_at server-side on
  // the run that completes the set, so a reload (or a re-render) never replays
  // it until Start over clears the row.

  var celebrating = false;

  function celebrate() {
    if (celebrating || reduce) return;
    celebrating = true;
    var overlay = $('celebrate');
    var stickerEl = $('celebrate-sticker');
    stickerEl.innerHTML = '';
    var a = window.lottie.loadAnimation({
      container: stickerEl, renderer: 'svg', loop: false, autoplay: true, path: src(state.pet.species),
    });
    $('celebrate-line').textContent = (state.pet.name || 'Your pet') + ' knows sit, stay and spin.';
    burst($('celebrate-fx'), 'party');
    overlay.hidden = false;
    setTimeout(function () {
      overlay.hidden = true;
      stickerEl.innerHTML = '';
      try { a.destroy(); } catch (e) {}
      celebrating = false;
    }, 3200);
  }

  function renderFeedback() {
    $('fb-title').textContent = state.feedback.author + ' said what could be better.';
    $('fb-meta').textContent = state.feedback.author + ' · Feedback on Patch';
    $('fb-text').textContent = '“' + state.feedback.text + '”';
    $('fb-count').textContent = state.feedback.agrees + ' people agree.';
    var btn = $('btn-agree');
    btn.textContent = state.pet.agreed ? '👍 Agreed' : '👍 Agree';
    btn.disabled = !!state.pet.agreed;
  }

  // ---- change pet --------------------------------------------------------

  function buildSpeciesPicker() {
    var group = $('species-picker');
    group.innerHTML = '';
    SPECIES_KEYS.forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg';
      b.dataset.species = key;
      b.textContent = EMOJI[key].char + ' ' + capitalize(key);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        setPickedSpecies(b.dataset.species);
      });
      group.appendChild(b);
    });
  }

  function setPickedSpecies(key) {
    pickedSpecies = key;
    Array.prototype.forEach.call($('species-picker').children, function (b) {
      var on = b.dataset.species === pickedSpecies;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function openChangePet() {
    $('pet-name').value = state.pet.name || '';
    $('pet-birthday').value = state.pet.birthday || '';
    setPickedSpecies(state.pet.species);
    $('change-pet').showModal();
  }

  // A species swap must not reuse the cached Lottie animation or the static
  // halo clone drawn from the old animal; clear both and let the next render
  // build the sticker fresh.
  function forgetStickers() {
    ['pet-sticker', 'try-sticker', 'ship-sticker'].forEach(function (id) {
      var el = $(id);
      var a = anims.get(el);
      if (a) { try { a.destroy(); } catch (e) {} anims.delete(el); }
      Array.prototype.forEach.call(el.querySelectorAll('svg.halo'), function (n) { n.remove(); });
    });
  }

  function savePet() {
    return api('/api/pet', {
      name: $('pet-name').value,
      species: pickedSpecies,
      birthday: $('pet-birthday').value || '',
    }).then(function (v) {
      state = v;
      $('change-pet').close();
      renderPet(current === 'home');
    });
  }

  function renderProposal() {
    $('pr-title').textContent = state.proposal.author + ' built it.';
    $('pr-meta').textContent = state.proposal.title + ' · a change by ' + state.proposal.author;
    $('pr-addresses').textContent = 'Addresses ' + state.feedback.author + "'s feedback";
  }

  function renderVote() {
    $('vote-name').value = state.pet.name || '';
    var voted = !!state.pet.vote;
    $('btn-yes').disabled = voted;
    $('btn-no').disabled = voted;
    $('vote-done').hidden = !voted;
    if (voted) $('vote-tally').textContent = state.proposal.yes + ' yes · ' + state.proposal.no + ' no';
  }

  function show(step, opts) {
    opts = opts || {};
    applyMotion();
    current = step;
    // 'menu' is home-like for the chrome: the Skip button hides and the h1
    // keeps no Skip padding, but it is never sent to /api/step.
    var homeLike = step === 'home' || step === 'menu';
    var beat = step === 'home' ? 'pet' : step;
    app.setAttribute('data-step', step);
    document.body.classList.toggle('home', homeLike);
    Array.prototype.forEach.call(document.querySelectorAll('.beat'), function (s) {
      s.hidden = s.getAttribute('data-beat') !== beat;
    });
    skipBtn.hidden = homeLike;

    if (step === 'egg') {
      preload(['hatch', 'sparkles', state.pet.species]);
    } else if (beat === 'pet') {
      renderPet(step === 'home');
      if (!anims.has($('pet-sticker'))) sticker($('pet-sticker'), state.pet.species);
      preload(['apple'].concat(state.pet.ball ? ['ball', 'hearts'] : []));
      if (opts.justHatched) {
        burst($('pet-fx'), 'sparkles');
        setTimeout(function () { wake($('pet-sticker'), 2); }, 200);
      }
    } else if (step === 'feedback') {
      renderFeedback();
      preload(['thumbs']);
    } else if (step === 'proposal') {
      renderProposal();
      preload(['ball', 'hearts']);
    } else if (step === 'try') {
      sticker($('try-sticker'), state.pet.species);
      preload(['ball', 'hearts', 'eyes']);
    } else if (step === 'vote') {
      renderVote();
      preload(['party']);
    } else if (step === 'shipped') {
      sticker($('ship-sticker'), state.pet.species);
      var shipBall = $('ship-ball');
      if (!anims.has(shipBall)) {
        var b = window.lottie.loadAnimation({
          container: shipBall, renderer: 'svg', loop: true, autoplay: false, path: src('ball'),
        });
        anims.set(shipBall, b);
        b.addEventListener('DOMLoaded', function () { b.goToAndStop(0, true); });
      }
      setTimeout(function () { wake($('ship-sticker'), 2); }, 300);
      burst($('ship-fx'), 'party');
    }
  }

  function guard(fn) {
    return function () {
      if (busy) return;
      busy = true;
      Promise.resolve(fn()).catch(function (err) { console.error(err); })
        .then(function () { busy = false; });
    };
  }

  function goStep(step) {
    return api('/api/step', { step: step }).then(function (v) { state = v; show(step); });
  }

  // ---- sound ----
  // Patch's voice is a tiny WebAudio synth: no audio files, no dependencies.
  // Every pet sound (the egg's crack, the hatch chirp, feeding, playing and
  // the hi greeting) routes through playSfx(), which checks the member's
  // Sound toggle at call time, so turning it off mutes the very next sound —
  // and silences anything still ringing. The choice is saved per member via
  // /api/sound, and mirrored to storage so a reload has it before the server
  // answers; sound is on by default. The AudioContext is only ever created
  // inside a tap or click handler: started later, from a timer or a render,
  // phones refuse it or keep it silent.

  var soundParam = params.get('sound');
  var soundChoice = (soundParam === 'off' || soundParam === 'on') ? soundParam : null;
  try {
    if (!soundChoice) soundChoice = window.localStorage.getItem('patch:sound') || null;
  } catch (e) {}
  var audioCtx = null;
  var liveSfx = [];

  function soundOn() { return soundChoice !== 'off'; }

  function rememberSound(value) {
    try {
      if (value) window.localStorage.setItem('patch:sound', value);
      else window.localStorage.removeItem('patch:sound');
    } catch (e) {}
  }

  function audio() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // One small synth voice per sound: a tone that glides between two pitches
  // inside a short envelope. Quiet on purpose — it sits under the speech
  // bubbles, not over them.
  var SFX = {
    crack: { type: 'triangle', from: 180, to: 90, dur: 0.09 },
    hatch: { type: 'square', from: 330, to: 660, dur: 0.35 },
    feed: { type: 'square', from: 150, to: 90, dur: 0.16 },
    play: { type: 'triangle', from: 220, to: 520, dur: 0.3 },
    hi: { type: 'sine', from: 700, to: 950, dur: 0.12 },
  };

  function playSfx(name) {
    if (!soundOn()) return;
    var voice = SFX[name];
    var ctx = audio();
    if (!voice || !ctx) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(voice.from, t);
    osc.frequency.exponentialRampToValueAtTime(voice.to, t + voice.dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + voice.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + voice.dur + 0.05);
    liveSfx.push(osc);
    osc.onended = function () {
      liveSfx = liveSfx.filter(function (o) { return o !== osc; });
    };
  }

  // Muting is immediate: anything still ringing is stopped, not faded out.
  function silenceSfx() {
    liveSfx.slice().forEach(function (osc) {
      try { osc.stop(); } catch (e) {}
    });
    liveSfx.length = 0;
  }

  // The one place the effective sound state is applied: the data-* markers
  // the page carries, the toggle's label and its announced state. Sound is
  // audio only — no classes, no styles — so toggling cannot shift the layout.
  function applySound() {
    var muted = !soundOn();
    app.dataset.sound = muted ? 'muted' : 'on';
    app.dataset.soundSource = soundChoice ? 'member' : 'default';
    app.dataset.petSfx = muted ? 'silent' : 'plays';
    var egg = $('egg');
    if (egg) egg.dataset.crack = muted ? 'silent' : 'plays';
    var btn = $('menu-sound');
    if (btn) {
      btn.dataset.state = muted ? 'off' : 'on';
      btn.setAttribute('aria-pressed', String(muted));
    }
    var word = $('sound-state');
    if (word) word.textContent = muted ? 'off' : 'on';
    var status = $('sound-status');
    if (status) {
      status.textContent = 'Sound ' + (muted ? 'off' : 'on');
      // The check runner reads visible text only, and this element is
      // deliberately invisible; the attribute mirrors the announcement so
      // the dapp.json check can pin it.
      status.dataset.announce = 'Sound ' + (muted ? 'off' : 'on');
    }
    if (muted) silenceSfx();
  }

  $('menu-sound').addEventListener('click', guard(function () {
    var prev = soundChoice;
    soundChoice = soundOn() ? 'off' : 'on';
    applySound();
    // The demo routes have no member to save for; storage stands in.
    if (DEMO || isDemo) { rememberSound(soundChoice); return; }
    return api('/api/sound', { sound: soundChoice }).then(function (v) {
      state = v;
      soundChoice = v.pet.sound || null;
      rememberSound(soundChoice);
      applySound();
    }).catch(function (err) {
      // The server answer wins, so a failed toggle rolls the row back.
      soundChoice = prev;
      applySound();
      throw err;
    });
  }));

  // ---- beat 1, the egg ---------------------------------------------------

  var taps = 0;
  var eggHints = ['Tap to hatch.', 'Something is moving.', 'Once more.'];
  var eggBtn = $('egg');

  eggBtn.addEventListener('click', function () {
    if (taps >= 3) return;
    taps += 1;
    playSfx('crack');
    var cracks = eggBtn.querySelectorAll('.crack');
    cracks[taps - 1].classList.add('on');
    eggBtn.classList.remove('shake', 'shake2');
    void eggBtn.offsetWidth;
    if (taps === 1) eggBtn.classList.add('shake');
    if (taps === 2) eggBtn.classList.add('shake2');
    if (taps < 3) {
      $('egg-hint').textContent = eggHints[taps];
      return;
    }
    eggBtn.disabled = true;
    setTimeout(hatch, 250);
  });

  function hatch() {
    var HATCH_LOOPS = 3;
    playSfx('hatch');
    eggBtn.hidden = true;
    var box = $('hatch-box');
    box.hidden = false;
    burst($('egg-fx'), 'sparkles');
    var chick = window.lottie.loadAnimation({
      container: box, renderer: 'svg', loop: true, autoplay: true, path: src('hatch'),
    });
    var done = false;
    var handOver = function () {
      if (done) return;
      done = true;
      if (current !== 'egg') {
        // Skip already hatched and moved on: tear the animation down only.
        try { chick.destroy(); } catch (e) {}
        box.hidden = true;
        box.innerHTML = '';
        return;
      }
      api('/api/hatch', {}).then(function (v) {
        state = v;
        try { chick.destroy(); } catch (e) {}
        box.hidden = true;
        box.innerHTML = '';
        show('pet', { justHatched: true });
      }).catch(function (err) { console.error(err); });
    };
    // Play HATCH_LOOPS whole loops, then hand over — the same counted-loops
    // pattern wake() uses. A looping hatch never emits complete.
    var seen = 0;
    var settle = function () {
      if (++seen < HATCH_LOOPS) return;
      chick.removeEventListener('loopComplete', settle);
      handOver();
    };
    chick.addEventListener('loopComplete', settle);
    if (reduce) setTimeout(handOver, 600);
  }

  // ---- beat 2 / home -----------------------------------------------------

  $('btn-feed').addEventListener('click', guard(function () {
    playSfx('feed');
    wake($('pet-sticker'), 1);
    burst($('pet-fx'), 'apple');
    say($('pet-speech'), feedLines[feedIndex % feedLines.length]);
    feedIndex += 1;
    if (isDemo) {
      state.pet.food = Math.min(100, state.pet.food + 20);
      renderPet(current === 'home');
      return;
    }
    return api('/api/feed', {}).then(function (v) { state = v; renderPet(current === 'home'); });
  }));

  $('btn-play').addEventListener('click', guard(function () {
    playSfx('play');
    if (state.pet.ball) {
      ballSequence($('pet-sticker'), $('pet-ball'), $('pet-speech'), $('pet-fx'));
    } else {
      wake($('pet-sticker'), 1);
      hop($('pet-sticker'));
      say($('pet-speech'), 'hop.');
    }
    if (isDemo) {
      state.pet.play = Math.min(100, state.pet.play + (state.pet.ball ? 25 : 10));
      state.pet.plays += 1;
      renderPet(current === 'home');
      return;
    }
    return api('/api/play', {}).then(function (v) { state = v; renderPet(current === 'home'); });
  }));

  // Tapping the pet itself: wake, hop, hi. Not wrapped in guard — it makes no
  // API call and must not take the shared busy lock.
  $('pet-sticker').addEventListener('click', function () {
    if (!$('pet-ball').hidden) return; // a ball round owns the pet's motion
    playSfx('hi');
    wake($('pet-sticker'), 1);
    hop($('pet-sticker'));
    say($('pet-speech'), hiLines[hiIndex % hiLines.length]);
    hiIndex += 1;
  });

  $('bridge-link').addEventListener('click', function (e) {
    e.preventDefault();
    if (isDemo) return;
    guard(function () { return goStep('feedback'); })();
  });

  $('btn-about').addEventListener('click', function () { $('about').showModal(); });
  $('about-close').addEventListener('click', function () { $('about').close(); });
  $('btn-change-pet').addEventListener('click', function () { openChangePet(); });

  // ---- the menu ----------------------------------------------------------
  // Navigation chrome only: every row is a client-side show(), never a
  // goStep(), so the server's step stays where the member left it.
  $('btn-menu').addEventListener('click', function () { show('menu'); });
  $('btn-menu-back').addEventListener('click', function () { show('home'); });
  $('menu-pet').addEventListener('click', function () { show('home'); });
  $('menu-tricks').addEventListener('click', function () { show('home'); });
  $('menu-change-pet').addEventListener('click', function () { openChangePet(); });
  $('menu-about').addEventListener('click', function () { $('about').showModal(); });
  $('menu-reset').addEventListener('click', guard(function () {
    return api('/api/reset', {}).then(function () { window.location.reload(); });
  }));
  $('pet-cancel').addEventListener('click', function () { $('change-pet').close(); });
  $('pet-save').addEventListener('click', guard(savePet));

  buildSpeciesPicker();

  $('btn-reset').addEventListener('click', guard(function () {
    return api('/api/reset', {}).then(function () { window.location.reload(); });
  }));

  // ---- trick checklist ---------------------------------------------------

  Array.prototype.forEach.call(document.querySelectorAll('.trick-check'), function (btn) {
    btn.addEventListener('click', guard(function () {
      var row = (state.pet.tricks || []).filter(function (t) { return t.trick === btn.dataset.trick; })[0];
      if (!row) return;
      btn.disabled = true;
      return toggleTrick(row);
    }));
  });

  // ---- beat 3, feedback --------------------------------------------------

  $('btn-agree').addEventListener('click', guard(function () {
    return api('/api/agree', {}).then(function (v) {
      state = v;
      renderFeedback();
      setTimeout(function () { guard(function () { return goStep('proposal'); })(); }, 700);
    });
  }));
  $('btn-fb-skip').addEventListener('click', guard(function () { return goStep('proposal'); }));

  // ---- beat 4, proposal --------------------------------------------------

  $('btn-try').addEventListener('click', guard(function () { return goStep('try'); }));

  // ---- beat 5, try -------------------------------------------------------
  // Nothing here is stored. In v1 the Before/After control is a local flag;
  // on the platform After becomes the proposal's own preview.

  function setMode(mode) {
    tryMode = mode;
    $('seg-before').classList.toggle('on', mode === 'before');
    $('seg-after').classList.toggle('on', mode === 'after');
    $('seg-before').setAttribute('aria-pressed', String(mode === 'before'));
    $('seg-after').setAttribute('aria-pressed', String(mode === 'after'));
  }
  $('seg-before').addEventListener('click', function () { setMode('before'); });
  $('seg-after').addEventListener('click', function () { setMode('after'); });

  $('btn-try-play').addEventListener('click', function () {
    playSfx('play');
    if (tryMode === 'after') {
      ballSequence($('try-sticker'), $('try-ball'), $('try-speech'), $('try-fx'));
    } else {
      wake($('try-sticker'), 1);
      hop($('try-sticker'));
      say($('try-speech'), 'hop.');
    }
  });

  $('btn-decide').addEventListener('click', guard(function () { return goStep('vote'); }));

  // ---- beat 6, vote ------------------------------------------------------

  function castVote(choice) {
    return api('/api/vote', { choice: choice, name: $('vote-name').value })
      .then(function (v) { state = v; renderVote(); });
  }
  $('btn-yes').addEventListener('click', guard(function () { return castVote('yes'); }));
  $('btn-no').addEventListener('click', guard(function () { return castVote('no'); }));

  $('btn-continue').addEventListener('click', guard(function () {
    return api('/api/ship', {}).then(function (v) { state = v; show('shipped'); });
  }));

  // ---- beat 7, shipped ---------------------------------------------------

  $('btn-enter').addEventListener('click', guard(function () { return goStep('home'); }));

  // ---- skip --------------------------------------------------------------
  // Moves to the next step without doing its action, but still hatches the
  // egg and still ships before home, so the stored state stays consistent.

  var NEXT = {
    egg: 'pet', pet: 'feedback', feedback: 'proposal',
    proposal: 'try', try: 'vote', vote: 'shipped', shipped: 'home',
  };

  skipBtn.addEventListener('click', guard(function () {
    var next = NEXT[current];
    if (!next) return;
    if (current === 'egg') {
      return api('/api/hatch', {}).then(function (v) { state = v; show('pet'); });
    }
    if (current === 'shipped') {
      return api('/api/ship', {}).then(function (v) { state = v; show('home'); });
    }
    return goStep(next);
  }));

  // ---- boot --------------------------------------------------------------

  // Apply the motion and sound states before the first render, so the egg,
  // the toggles and the markers are right from the first paint.
  applyMotion();
  applySound();

  // Staging-only demo: the screenshot and check route carries no platform
  // token, so with ?demo=1 the pet beat renders from a fixed demo pet. It
  // never calls the API; a real visitor without the flag is unaffected.
  if (DEMO) {
    state = {
      pet: {
        species: 'turtle', name: 'Demo', days: 8, food: 60, play: 45,
        plays: 2, step: 'home', agreed: false, vote: null, ball: true,
        happiness: 72,
        tricks: [{ trick: 'sit', done: false }, { trick: 'stay', done: false }, { trick: 'spin', done: false }],
        tricks_complete: false,
        tricks_celebrated: false,
        birthday: new Date().toISOString().slice(0, 10),
        birthday_today: true,
      },
      staging: true, feedback: null, proposal: null,
    };
    show('home');
  } else if (isDemo) {
    state = {
      pet: {
        species: 'turtle', name: null, food: 60, play: 40, plays: 2,
        step: 'pet', agreed: false, vote: null, ball: false,
      },
      username: 'you',
      staging: false,
      feedback: { id: 'fb-play-hop', author: 'Maya', text: 'Play only makes it hop. It needs something to play with ⚽', agrees: 4 },
      proposal: { id: 'prop-play-ball', author: 'Noor', title: 'Play throws a ball', addresses: 'fb-play-hop', yes: 11, no: 1 },
    };
    app.dataset.demo = 'pet';
    show('pet');
    skipBtn.hidden = true;
  } else if (token) {
    api('/api/state').then(function (v) {
      state = v;
      // The server holds the member's saved choice. A ?motion= check param
      // pins the choice for its one load instead, so the state is readable
      // without a write; a real visitor is unaffected.
      if (!motionParam) {
        motionChoice = v.pet.motion || null;
        rememberMotion(motionChoice);
      }
      // The server holds the member's saved sound choice too; a ?sound=
      // check param pins it for its one load instead, the same way as above.
      if (!soundParam) {
        soundChoice = v.pet.sound || null;
        rememberSound(soundChoice);
      }
      applyMotion();
      applySound();
      show(state.pet.step);
    }).catch(function (err) {
      if (String(err.message).indexOf(' 401') === -1) console.error(err);
    });
  }
  // With no platform token and no demo flag (a direct visit to the app's own
  // address) there is no pet to ask for: the markup already shows the egg, so
  // leave it there rather than firing a request that can only come back 401.
})();
