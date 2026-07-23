# Village Atlas

An aerial 3D atlas of Emirati villages. Users pick a village from the cloud deck,
the clouds part, and they descend from a top-down satellite view into an angled
bird's-eye view they can pan around.

## Run it

Browsers block 3D files opened directly from a folder, so the site needs a small
local server. From this folder, run:

```
python3 -m http.server 8000
```

then open <http://localhost:8000>. (Any static server works; if port 8000 is
busy, pick another.)

## Add a landmark pin

1. Open the site with `?dev` at the end of the URL: `http://localhost:8000/?dev`
2. Descend into the map, then click the exact spot — the coordinates are copied
   to your clipboard and shown on screen.
3. Open `src/config.js`, duplicate one of the entries in `pins:`, and paste the
   coordinates in. Add the English and Arabic title and text. Height snaps to
   the terrain automatically.

## Place a 3D model on the map

Drop the `.glb` in `assets/models/`, then add an entry to `models:` in
`src/config.js` (an example is written there in a comment), pointing `url:` at
`assets/models/your-file.glb`. Find the position the same way as pins, with `?dev`.

## Add or rename villages

Edit the `villages:` list in `src/config.js`. Placeholder names (Qidfa, Al Rams,
Al Silaa) are just examples — rename freely. When a new village's terrain model is
ready, set its `status` to `'live'`, add a `terrain:` file (in `assets/models/`)
and a `view:` block like Masfout's.

## Layout

```
index.html            entry point
src/
  app.js              the 3D engine
  config.js           villages, pins, models, and all interface text (EN/AR)
  styles.css          interface styling
assets/
  models/             terrain and placed .glb models
  images/             cloud PNGs (and landmark photos)
  audio/              woosh and ambient bird loops
```

`assets/models/masfout-terrain-web.glb` is the optimized terrain (8.7 MB, from
the 451 MB original).

Design notes: single bilingual typeface (Readex Pro) so the UI keeps one voice in
both languages; oxide-terracotta accent picked from the Hajar earth tones in the
imagery; flat, sharp-cornered "map furniture" panels.
