# Patch

Patch is the Homeroom class pet: a tiny app that hatches a pet, lets you
feed and play with it, and then shows, in one sitting, how feedback becomes
a change that everyone tries, votes on, and ships. It is the first thing a
new member uses, so it is small, fast and finished.

## The seven beats

One page, one visible beat at a time, state kept server-side so a reload
lands on the same beat on any device.

1. **egg** — an egg that wobbles; three taps crack it and it hatches.
2. **pet** — your species appears. Feed it, play with it, watch the meters.
3. **feedback** — someone already said Play is thin. Agree with them.
4. **proposal** — someone built the fix.
5. **try** — play with the change, Before and After.
6. **vote** — Yes or No, signed with your pet's name.
7. **shipped** — the ball is in, for everyone. Then the home screen.

## How it is built

- **Express + Postgres.** Identity is the platform's RS256 iframe token and
  nothing else. Every `/api/*` route needs it; the HTML shell and `/health`
  are open, because the platform's checks and capture containers navigate an
  app's routes with no token. A tokenless load boots to the egg and asks the
  server for nothing.
- **One table, `pets`**, commented `staging:private`: it holds per-member
  state that is never shown to anyone else, so staging copies the schema
  and no rows, and every preview visitor hatches their own pet.
- **Species is a hash of the member id** (`speciesFor` in `server.js`,
  indexing into the species keys of `public/emoji-manifest.js` in order).
  Same member, same pet, every device, no reroll. That key order is part of
  the contract: reordering it reassigns everyone's pet.
- **Steps only move forward.** A stale tab can never rewind a member.
- **Every action is a POST.** A GET on an action route would fall through to
  the page and hand the JSON caller HTML.
- **No framework, no Tailwind, no CDN.** `public/patch.css` and
  `public/patch.js` are the whole frontend.

## Animation

All animation is [Noto Animated Emoji](https://googlefonts.github.io/noto-emoji-animation/)
by Google, CC BY 4.0, as Lottie JSON, vendored into `public/emoji/` and
served from this app's own origin. Nothing loads from Google at runtime.
The egg is the app's own SVG.

`npm run vendor:emoji` refetches the files listed in
`public/emoji-manifest.js`; run it by hand and commit the output. The image
build never reaches the network.

The sticker rule: a pet at rest is a static clone of frame 0 carrying the
halo through an SVG filter the browser rasterises once; the live Lottie SVG
on top never gets a filter. A CSS drop-shadow stack on the live SVG measured
8 fps, the clone measures 60. Idle pets do not animate at all.

## Scripts

```
npm start          node server.js
npm run build      copies the lottie-web player into public/vendor/
npm run vendor:emoji   refetches the Noto Lottie files (by hand, committed)
npm test           node:test, no database, PORT=0
```
