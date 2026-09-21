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
    turtle:    { cp: '1f422', char: '🐢', species: true, line: 'A turtle. Slow, but always shows up.' },
    frog:      { cp: '1f438', char: '🐸', species: true, line: 'A frog. Loud opinions, small body.' },
    cat:       { cp: '1f431', char: '🐱', species: true, line: 'A cat. Will judge your code.' },
    snail:     { cp: '1f40c', char: '🐌', species: true, line: 'A snail. Ships when it ships.' },
    octopus:   { cp: '1f419', char: '🐙', species: true, line: 'An octopus. Eight tabs open.' },
    penguin:   { cp: '1f427', char: '🐧', species: true, line: 'A penguin. Dressed for the demo.' },
    owl:       { cp: '1f989', char: '🦉', species: true, line: 'An owl. Reads the whole thread.' },
    fox:       { cp: '1f98a', char: '🦊', species: true, line: 'A fox. Already has an idea.' },
  };
  return { EMOJI, SPECIES: Object.keys(EMOJI).filter((k) => EMOJI[k].species) };
});
