// public/emoji-manifest.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PATCH_EMOJI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const EMOJI = {
    hatch:     { cp: '1f423', char: '🐣' },
    apple:     { cp: '1f34e', char: '🍎' },
    ball:      { cp: '26bd',  char: '⚽' },   // 🎾 in Noto is mostly racket; ⚽ reads as a ball at 64 px
    hearts:    { cp: '1f495', char: '💕' },
    sparkles:  { cp: '2728',  char: '✨' },
    party:     { cp: '1f389', char: '🎉' },
    thumbs:    { cp: '1f44d', char: '👍' },
    eyes:      { cp: '1f440', char: '👀' },
    // Each species keeps its one hatch-day `line` and gains five `ages`
    // lines (days 1–6, 7–29, 30–99, 100–364, 365+). Every line opens with
    // the same first sentence as `line`, so the name swap in speciesLine()
    // (which replaces only that first sentence) keeps working.
    turtle:    {
      cp: '1f422', char: '🐢', species: true, line: 'A turtle. Slow, but always shows up.',
      ages: [
        'A turtle. Still learning where the snacks are.',
        'A turtle. A whole week together, at its own pace.',
        'A turtle. A month in and still showing up.',
        'A turtle. 100 days. Slow and steady got here.',
        'A turtle. A whole year. Told you it would make it.',
      ],
    },
    frog:      {
      cp: '1f438', char: '🐸', species: true, line: 'A frog. Loud opinions, small body.',
      ages: [
        'A frog. Already has opinions about this place.',
        'A frog. One week in and louder than ever.',
        'A frog. A month of ribbits, all of them important.',
        'A frog. 100 days. Still the loudest one here.',
        'A frog. A whole year of opinions, none taken back.',
      ],
    },
    cat:       {
      cp: '1f431', char: '🐱', species: true, line: 'A cat. Will judge your code.',
      ages: [
        'A cat. Still deciding if you pass review.',
        'A cat. A week in. You are approved, for now.',
        'A cat. A month together. Sits on your keyboard now.',
        'A cat. 100 days. Has reviewed every line twice.',
        'A cat. A whole year. Pretends not to care. Does.',
      ],
    },
    snail:     {
      cp: '1f40c', char: '🐌', species: true, line: 'A snail. Ships when it ships.',
      ages: [
        'A snail. Just getting started. No rush.',
        'A snail. One week in. Pacing itself.',
        'A snail. A month in. Has shipped one small thing.',
        'A snail. 100 days. The slow ones last.',
        'A snail. A whole year. Shipped, eventually.',
      ],
    },
    octopus:   {
      cp: '1f419', char: '🐙', species: true, line: 'An octopus. Eight tabs open.',
      ages: [
        'An octopus. Already opened a tab for you.',
        'An octopus. A week in. Eight tabs became nine.',
        'An octopus. A month in. Knows where every tab is.',
        'An octopus. 100 days. Still closes zero tabs.',
        'An octopus. A whole year. Eight arms, one big hug.',
      ],
    },
    penguin:   {
      cp: '1f427', char: '🐧', species: true, line: 'A penguin. Dressed for the demo.',
      ages: [
        'A penguin. Still unpacking the tuxedo.',
        'A penguin. A week in. Rehearsing the demo.',
        'A penguin. A month in. Nailed the demo twice.',
        'A penguin. 100 days. Still dressed for it.',
        'A penguin. A whole year. Formal wear, every day.',
      ],
    },
    owl:       {
      cp: '1f989', char: '🦉', species: true, line: 'An owl. Reads the whole thread.',
      ages: [
        'An owl. Catching up on the thread.',
        'An owl. A week in. Has read every reply.',
        'An owl. A month in. Remembers what you said.',
        'An owl. 100 days. Wise about your habits.',
        'An owl. A whole year. Read it all, still curious.',
      ],
    },
    fox:       {
      cp: '1f98a', char: '🦊', species: true, line: 'A fox. Already has an idea.',
      ages: [
        'A fox. Already has an idea about you.',
        'A fox. A week in. Has three new ideas.',
        'A fox. A month in. Some of the ideas worked.',
        'A fox. 100 days. Still full of plans.',
        'A fox. A whole year. Best idea yet: staying.',
      ],
    },
  };
  // The line that fits the pet's age: the hatch-day `line` until day 1,
  // then the bucket for how many full days it has been hatched.
  function lineFor(key, days) {
    const e = EMOJI[key];
    if (!e) return '';
    if (!e.ages || typeof days !== 'number' || !Number.isFinite(days) || days < 1) return e.line;
    let i = 0;
    if (days >= 365) i = 4;
    else if (days >= 100) i = 3;
    else if (days >= 30) i = 2;
    else if (days >= 7) i = 1;
    return e.ages[i];
  }
  return { EMOJI, SPECIES: Object.keys(EMOJI).filter((k) => EMOJI[k].species), lineFor };
});
