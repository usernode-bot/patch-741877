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
    turtle: { cp: '1f422', char: '🐢', species: true, line: 'A turtle. Slow, but always shows up.', lines: {
      new: ['A turtle. Fresh out of the shell, taking it all in.', 'A turtle. Just hatched and already committed.'],
      settled: ['A turtle. Slow, but always shows up.', 'A turtle. Warming up to you nicely.', 'A turtle. Has a favorite corner now.'],
      veteran: ['A turtle. Knows your schedule better than you do.', 'A turtle. Seen every demo. Still shows up.'],
    }, },
    frog:   { cp: '1f438', char: '🐸', species: true, line: 'A frog. Loud opinions, small body.', lines: {
      new: ['A frog. Just hatched, already croaking.', 'A frog. Tiny frog, big first day.'],
      settled: ['A frog. Loud opinions, small body.', 'A frog. Comfortable enough to be loud.', 'A frog. Learned where the snacks live.'],
      veteran: ['A frog. Has been on every call. Loudly.', 'A frog. Remembers when this place was quiet.'],
    }, },
    cat:    { cp: '1f431', char: '🐱', species: true, line: 'A cat. Will judge your code.', lines: {
      new: ['A cat. New here, already judging.', 'A cat. First day. Judging already.'],
      settled: ['A cat. Will judge your code.', 'A cat. Judging you, but affectionately.', 'A cat. Knows which chair is hers.'],
      veteran: ['A cat. Has judged your code for months. Verdict: fine.', 'A cat. Owns this place. You pay the rent.'],
    }, },
    snail:  { cp: '1f40c', char: '🐌', species: true, line: 'A snail. Ships when it ships.', lines: {
      new: ['A snail. Just hatched, in no rush.', 'A snail. Brand new, moving at full snail speed.'],
      settled: ['A snail. Ships when it ships.', 'A snail. Getting comfortable, slowly.', 'A snail. Has a favorite leaf now.'],
      veteran: ['A snail. Shipped things you forgot you asked for.', 'A snail. Slow, wise, and permanent.'],
    }, },
    octopus: { cp: '1f419', char: '🐙', species: true, line: 'An octopus. Eight tabs open.', lines: {
      new: ['An octopus. Just hatched with eight tabs open.', 'An octopus. New here, curious in eight directions.'],
      settled: ['An octopus. Eight tabs open.', 'An octopus. Settled in, still eight tabs open.', 'An octopus. Has claimed two keyboards.'],
      veteran: ['An octopus. Eight tabs, all production. All fine.', 'An octopus. Been running this place for months.'],
    }, },
    penguin: { cp: '1f427', char: '🐧', species: true, line: 'A penguin. Dressed for the demo.', lines: {
      new: ['A penguin. Just hatched, already dressed up.', 'A penguin. First day, formal attire.'],
      settled: ['A penguin. Dressed for the demo.', 'A penguin. Dressed for the demo, again.', 'A penguin. Waddles with confidence now.'],
      veteran: ['A penguin. Has seen every demo. Nods approvingly.', 'A penguin. Dressed like this since day one. Commitment.'],
    }, },
    owl:    { cp: '1f989', char: '🦉', species: true, line: 'An owl. Reads the whole thread.', lines: {
      new: ['An owl. Just hatched, already reading.', 'An owl. New here, catching up on the thread.'],
      settled: ['An owl. Reads the whole thread.', 'An owl. Reads the whole thread before breakfast.', 'An owl. Has opinions on everything.'],
      veteran: ['An owl. Remembers threads you deleted.', 'An owl. Read the whole archive. Twice.'],
    }, },
    fox:    { cp: '1f98a', char: '🦊', species: true, line: 'A fox. Already has an idea.', lines: {
      new: ['A fox. Just hatched with an idea already.', 'A fox. New here, scheming already.'],
      settled: ['A fox. Already has an idea.', 'A fox. Has three ideas, one good.', 'A fox. Knows where everything is.'],
      veteran: ['A fox. Has had a hundred ideas. Tells you about the good ones.', 'A fox. Knows this place better than the map.'],
    }, },
  };
  return { EMOJI, SPECIES: Object.keys(EMOJI).filter((k) => EMOJI[k].species) };
});
