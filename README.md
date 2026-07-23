# Village Atlas

An aerial 3D atlas of Emirati villages. Users pick a village from the cloud deck,
the clouds part, and they descend from a top-down satellite view into an angled
bird's-eye view they can pan around.

## Run it

Double-click **Start Website.command** — it starts a small local server and opens
the site. Keep its window open while you browse. (Browsers block 3D files opened
directly from a folder, which is why the server is needed. If port 8000 is busy,
edit the PORT number inside the file.)

## Add a landmark pin

1. Open the site with `?dev` at the end of the URL: `http://localhost:8000/?dev`
2. Descend into the map, then click the exact spot — the coordinates are copied
   to your clipboard and shown on screen.
3. Open `config.js`, duplicate one of the entries in `pins:`, and paste the
   coordinates in. Add the English and Arabic title and text. Height snaps to
   the terrain automatically.

## Place a 3D model on the map

Drop the `.glb` in this folder, then add an entry to `models:` in `config.js`
(an example is written there in a comment). Find the position the same way as
pins, with `?dev`.

## Add or rename villages

Edit the `villages:` list in `config.js`. Placeholder names (Manama, Wadi Al
Helo) are just examples — rename freely. When a new village's terrain model is
ready, set its `status` to `'live'`, add a `terrain:` file and a `view:` block
like Masfout's.

## Files

- `index.html`, `styles.css`, `app.js` — the site (app.js is the 3D engine)
- `config.js` — villages, pins, models, and all interface text (EN/AR)
- `masfout-terrain-web.glb` — optimized terrain (8.7 MB, from the 451 MB original)
- `terrain-viewer.html` — standalone model checker, not part of the site

Design notes: single bilingual typeface (Readex Pro) so the UI keeps one voice in
both languages; oxide-terracotta accent picked from the Hajar earth tones in the
imagery; flat, sharp-cornered "map furniture" panels.
