/* Patch — state machine, Lottie, halo, motion. One script, no framework. */
(function () {
  'use strict';

  var EMOJI;
  // Node's test runner loads this file for the pure helpers below. The page
  // code only ever runs in a browser, where `module` does not exist.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { dayLabel: dayLabel, anniversaryFor: anniversaryFor };
    return;
  }
  EMOJI = window.PATCH_EMOJI.EMOJI;
  var params = new URLSearchParams(window.location.search);
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
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SPECIES_KEYS = Object.keys(EMOJI).filter(function (k) { return EMOJI[k].species; });
  var pickedSpecies = null;

  var anims = new Map();   // element -> looping animation, parked on frame 0
  var fxAnims = new Map(); // box id -> the one-shot currently playing in it
  var haloSeq = 0;
  var state = null;
  var current = 'egg';
  var feedLines = ['It counts.', 'Fed. Again.', 'nom'];
  var feedIndex = 0;
  // ?anniversary=1 forces the badge on, staging only: the server confirms
  // the flag via /api/demo (also reachable without a token, which check
  // containers are). A signed-in visitor never sees the demo state.
  var demoAnniversary = false;
  if (params.get('anniversary') === '1') {
    fetch('/api/demo').then(function (r) { return r.json(); }).then(function (v) {
      demoAnniversary = v.demo === 'anniversary';
      renderPet(current === 'home');
    }).catch(function () {});
  }
  var tryMode = 'after';
  var busy = false;

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

  // ---- rendering ---------------------------------------------------------

  function speciesLine() {
    var line = EMOJI[state.pet.species].line;
    if (state.pet.name) return line.replace(/^[^.]*\./, state.pet.name + '.');
    return line;
  }

  function capitalize(key) {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function dayLabel(n) {
    return n + (n === 1 ? ' day' : ' days');
  }

  function anniversaryFor(days) {
    return days >= 30 && days % 30 === 0 ? Math.floor(days / 30) : 0;
  }

  function petStatsText() {
    var e = EMOJI[state.pet.species];
    return e.char + ' ' + capitalize(state.pet.species) + ' · ' +
      dayLabel(state.pet.days) + ' with you';
  }

  function anniversaryText(n) {
    return '🎉 ' + dayLabel(n) + ' with you';
  }

  function renderPet(isHome) {
    $('pet-title').textContent = isHome ? (state.pet.name || 'Your pet') : 'Meet your Homeroom pet.';
    $('pet-line').textContent = speciesLine();
    var stats = $('pet-stats');
    stats.hidden = !isHome;
    var badge = document.getElementById('stat-anniversary');
    if (badge) badge.remove();
    if (isHome) {
      var days = state.pet.days;
      var anniversary = anniversaryFor(days);
      if (demoAnniversary && state.demo) anniversary = Math.max(1, anniversary);
      if (anniversary) {
        badge = document.createElement('span');
        badge.id = 'stat-anniversary';
        badge.className = 'stat-badge';
        badge.textContent = anniversaryText(anniversary * 30);
        stats.appendChild(badge);
        stats.appendChild(document.createTextNode(' '));
      }
      stats.appendChild(document.createTextNode(petStatsText()));
    } else {
      stats.textContent = '';
    }
    $('meter-food').style.width = state.pet.food + '%';
    $('meter-play').style.width = state.pet.play + '%';
    $('bridge').hidden = isHome || state.pet.plays < 2;
    $('home-foot').hidden = !isHome;
    $('btn-reset').hidden = !state.staging;
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
    return api('/api/pet', { name: $('pet-name').value, species: pickedSpecies })
      .then(function (v) {
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
    current = step;
    var beat = step === 'home' ? 'pet' : step;
    app.setAttribute('data-step', step);
    document.body.classList.toggle('home', step === 'home');
    Array.prototype.forEach.call(document.querySelectorAll('.beat'), function (s) {
      s.hidden = s.getAttribute('data-beat') !== beat;
    });
    skipBtn.hidden = step === 'home';

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

  // ---- beat 1, the egg ---------------------------------------------------

  var taps = 0;
  var eggHints = ['Tap to hatch.', 'Something is moving.', 'Once more.'];
  var eggBtn = $('egg');

  eggBtn.addEventListener('click', function () {
    if (taps >= 3) return;
    taps += 1;
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
    eggBtn.hidden = true;
    var box = $('hatch-box');
    box.hidden = false;
    burst($('egg-fx'), 'sparkles');
    var chick = window.lottie.loadAnimation({
      container: box, renderer: 'svg', loop: false, autoplay: true, path: src('hatch'),
    });
    var handOver = function () {
      api('/api/hatch', {}).then(function (v) {
        state = v;
        try { chick.destroy(); } catch (e) {}
        box.hidden = true;
        box.innerHTML = '';
        show('pet', { justHatched: true });
      }).catch(function (err) { console.error(err); });
    };
    // loop: false and hand over on complete. A looping hatch never hands over.
    chick.addEventListener('complete', handOver);
    if (reduce) setTimeout(handOver, 600);
  }

  // ---- beat 2 / home -----------------------------------------------------

  $('btn-feed').addEventListener('click', guard(function () {
    wake($('pet-sticker'), 1);
    burst($('pet-fx'), 'apple');
    say($('pet-speech'), feedLines[feedIndex % feedLines.length]);
    feedIndex += 1;
    return api('/api/feed', {}).then(function (v) { state = v; renderPet(current === 'home'); });
  }));

  $('btn-play').addEventListener('click', guard(function () {
    if (state.pet.ball) {
      ballSequence($('pet-sticker'), $('pet-ball'), $('pet-speech'), $('pet-fx'));
    } else {
      wake($('pet-sticker'), 1);
      hop($('pet-sticker'));
      say($('pet-speech'), 'hop.');
    }
    return api('/api/play', {}).then(function (v) { state = v; renderPet(current === 'home'); });
  }));

  $('bridge-link').addEventListener('click', function (e) {
    e.preventDefault();
    guard(function () { return goStep('feedback'); })();
  });

  $('btn-about').addEventListener('click', function () { $('about').showModal(); });
  $('about-close').addEventListener('click', function () { $('about').close(); });
  $('btn-change-pet').addEventListener('click', function () { openChangePet(); });
  $('pet-cancel').addEventListener('click', function () { $('change-pet').close(); });
  $('pet-save').addEventListener('click', guard(savePet));

  buildSpeciesPicker();

  $('btn-reset').addEventListener('click', guard(function () {
    return api('/api/reset', {}).then(function () { window.location.reload(); });
  }));

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

  // With no platform token (a direct visit to the app's own address) there is
  // no pet to ask for: the markup already shows the egg, so leave it there
  // rather than firing a request that can only come back 401.
  if (token) {
    api('/api/state').then(function (v) {
      state = v;
      show(state.pet.step);
    }).catch(function (err) {
      if (String(err.message).indexOf(' 401') === -1) console.error(err);
    });
  } else if (demoAnniversary || params.get('anniversary') === '1') {
    // Staging check containers have no token. Build the demo pet locally:
    // same shape the API returns, never stored, never for a signed-in user.
    state = {
      pet: {
        species: 'turtle', name: 'Staging demo pet', days: 30,
        food: 80, play: 60, plays: 5, step: 'home',
        agreed: true, vote: 'yes', ball: true,
      },
      demo: 'anniversary', staging: true,
      feedback: { author: 'Staging demo user', text: 'Demo feedback.', agrees: 1 },
      proposal: { author: 'Staging demo user', title: 'Demo proposal', yes: 1, no: 0 },
    };
    show('home');
  }
})();
