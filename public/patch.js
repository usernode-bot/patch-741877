/* Patch — state machine, Lottie, halo, motion. One script, no framework. */
(function () {
  'use strict';

  var EMOJI = window.PATCH_EMOJI.EMOJI;
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
  var tryMode = 'after';
  var busy = false;
  var weightEntries = [];
  var editingDay = null;

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

  function petStatsText() {
    var e = EMOJI[state.pet.species];
    return e.char + ' ' + capitalize(state.pet.species) + ' · ' +
      state.pet.days + (state.pet.days === 1 ? ' day' : ' days') + ' with you';
  }

  // ---- weight log ---------------------------------------------------------
  // One entry per day (UTC), editable. The card lives on the home screen
  // only, below the meters, so onboarding stays untouched.

  function dayKey(offset) {
    return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  }

  function shortDay(day) {
    var d = new Date(day + 'T00:00:00Z');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function sortedEntries() {
    return weightEntries.slice().sort(function (a, b) {
      return a.day < b.day ? 1 : a.day > b.day ? -1 : 0;
    });
  }

  function fetchWeights() {
    return api('/api/weights').then(function (res) {
      weightEntries = res.weights || [];
      renderWeight();
    });
  }

  function showWeightError(text) {
    var el = $('weight-error');
    el.textContent = text;
    el.hidden = false;
  }

  function saveWeight() {
    $('weight-error').hidden = true;
    var grams = Number($('weight-input').value);
    if (!Number.isFinite(grams) || grams <= 0 || grams > 20000) {
      showWeightError('Enter a weight in grams, then Save.');
      return Promise.resolve();
    }
    var body = { grams: Math.round(grams) };
    if (editingDay) body.day = editingDay;
    return api('/api/weights', body).then(function (res) {
      weightEntries = res.weights || [];
      editingDay = null;
      renderWeight();
    }).catch(function () {
      showWeightError('Saving failed. Try again.');
    });
  }

  function renderWeight() {
    var card = $('weight-card');
    var isHome = current === 'home';
    card.hidden = !isHome;
    if (!isHome) return;

    var entries = sortedEntries();
    var todayKey = dayKey(0);
    var todays = null;
    entries.forEach(function (e) { if (e.day === todayKey) todays = e; });

    $('weight-empty').hidden = entries.length > 0;

    var input = $('weight-input');
    var label = $('weight-label');
    if (editingDay) {
      label.textContent = 'Editing ' + shortDay(editingDay);
    } else {
      label.textContent = 'Today';
      if (document.activeElement !== input) {
        input.value = todays ? todays.grams : '';
      }
    }

    // The demo route has no platform token, so saving is off there; the
    // card still shows exactly what a signed-in member sees.
    if (DEMO) {
      input.value = todays ? todays.grams : '';
      label.textContent = 'Today';
    }
    $('weight-today-row').hidden = DEMO;

    var list = $('weight-list');
    list.innerHTML = '';
    entries.forEach(function (e) {
      var li = document.createElement('li');
      var day = document.createElement('span');
      day.className = 'weight-day';
      day.textContent = e.day === todayKey ? 'Today' : shortDay(e.day);
      var grams = document.createElement('span');
      grams.className = 'weight-grams';
      grams.textContent = e.grams + ' g';
      // The demo route has no platform token, so its entries are read-only.
      if (!DEMO && e.day !== todayKey) {
        var edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'link weight-edit';
        edit.textContent = 'Edit';
        edit.addEventListener('click', function () {
          editingDay = e.day;
          input.value = e.grams;
          renderWeight();
          input.focus();
        });
        grams.appendChild(edit);
      }
      li.appendChild(day);
      li.appendChild(grams);
      list.appendChild(li);
    });

    drawWeightChart(entries.slice().reverse());
  }

  function drawWeightChart(entriesAsc) {
    var svg = $('weight-chart');
    var caption = $('weight-chart-caption');
    svg.innerHTML = '';
    var pts = entriesAsc.slice(-14);
    if (!pts.length) {
      // SVGElement has no `hidden` property (that lives on HTMLElement), so
      // the attribute is toggled directly or the chart never comes back.
      svg.setAttribute('hidden', '');
      caption.hidden = true;
      return;
    }
    svg.removeAttribute('hidden');
    var W = 200, H = 56, padX = 6, padTop = 8, padBottom = 10;
    var xs = pts.map(function (_, i) {
      return pts.length === 1 ? W / 2 : padX + i * (W - 2 * padX) / (pts.length - 1);
    });
    var min = Infinity, max = -Infinity;
    pts.forEach(function (e) {
      if (e.grams < min) min = e.grams;
      if (e.grams > max) max = e.grams;
    });
    if (max === min) max = min + 1;
    var ys = pts.map(function (e) {
      return padTop + (1 - (e.grams - min) / (max - min)) * (H - padTop - padBottom);
    });
    var poly = document.createElementNS(SVGNS, 'polyline');
    poly.setAttribute('points', pts.map(function (_, i) {
      return xs[i].toFixed(1) + ',' + ys[i].toFixed(1);
    }).join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', 'var(--ink)');
    poly.setAttribute('stroke-width', '2.5');
    poly.setAttribute('vector-effect', 'non-scaling-stroke');
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
    var last = document.createElementNS(SVGNS, 'circle');
    last.setAttribute('cx', xs[xs.length - 1].toFixed(1));
    last.setAttribute('cy', ys[ys.length - 1].toFixed(1));
    last.setAttribute('r', '3.5');
    last.setAttribute('style', 'fill: var(--pill)');
    svg.appendChild(last);
    svg.setAttribute('aria-label', 'Weight chart, latest ' + pts[pts.length - 1].grams + ' grams');
    caption.hidden = pts.length < 2;
    if (pts.length > 1) {
      caption.textContent = 'Last ' + pts.length + ' days · ' + min + '–' + max + ' g';
    }
  }

  function renderPet(isHome) {
    $('pet-title').textContent = isHome ? (state.pet.name || 'Your pet') : 'Meet your Homeroom pet.';
    $('pet-line').textContent = speciesLine();
    $('pet-stats').hidden = !isHome;
    $('pet-stats').textContent = petStatsText();
    $('meter-food').style.width = state.pet.food + '%';
    $('meter-play').style.width = state.pet.play + '%';
    $('meter-happy').style.width = state.pet.happiness + '%';
    $('bridge').hidden = isHome || state.pet.plays < 2;
    $('home-foot').hidden = !isHome;
    $('btn-reset').hidden = !state.staging;
    renderWeight();
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
      if (step === 'home') ensureWeights();
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

  // The card is home-only; load its entries the first time the member
  // actually lands on home, however they got there.
  var weightsLoaded = false;
  function ensureWeights() {
    if (weightsLoaded || DEMO) return;
    weightsLoaded = true;
    fetchWeights().catch(function (err) { console.error(err); });
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

  // ---- weight log wiring ---------------------------------------------------
  // Saving is a POST like every other action, so it goes through the same
  // busy guard. Editing a past day sends its day key; today's save omits it.
  $('btn-weight-save').addEventListener('click', guard(saveWeight));
  $('weight-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      guard(saveWeight)();
    }
  });

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

  // Staging-only demo: the screenshot and check route carries no platform
  // token, so with ?demo=1 the pet beat renders from a fixed demo pet. It
  // never calls the API; a real visitor without the flag is unaffected.
  if (DEMO) {
    state = {
      pet: {
        species: 'turtle', name: 'Demo', days: 3, food: 60, play: 45,
        plays: 2, step: 'home', agreed: false, vote: null, ball: true,
        happiness: 72,
      },
      staging: true, feedback: null, proposal: null,
    };
    weightEntries = [
      { day: dayKey(4), grams: 802 },
      { day: dayKey(3), grams: 806 },
      { day: dayKey(2), grams: 803 },
      { day: dayKey(1), grams: 808 },
    ];
    show('home');
  } else if (token) {

  // With no platform token (a direct visit to the app's own address) there is
  // no pet to ask for: the markup already shows the egg, so leave it there
  // rather than firing a request that can only come back 401.
    api('/api/state').then(function (v) {
      state = v;
      show(state.pet.step);
    }).catch(function (err) {
      if (String(err.message).indexOf(' 401') === -1) console.error(err);
    });
  }
})();
