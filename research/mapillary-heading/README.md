# Which way does a 360° photo face?

The site aims Mapillary panoramas at signs with `compass_angle + lens offset`
(`js/aim.js`). For NTHP's June 2026 drive this assumes the lens faces left of
travel. Some photos come out 180° wrong (e.g. way 1579704563, Azusa).

## Two independent checks

1. **Is `compass_angle` the direction of travel?** The coverage tiles carry
   `sequence_id` and `captured_at`, so the photos before and after a target
   give the real GPS travel bearing. Works with any tile token.
   Suspicious in the stored data: Azusa (2026-06-07, overall drive heading
   east) has compass 272.7° (west). Several views have exactly 0° or 90°,
   which look like placeholders rather than headings.
2. **Where does the image centre face, from the pixels?** `flow.py`: driving
   forward, scenery streams away from the forward column and toward the rear.
   Fitting `u(θ) = k·sin(θ − θ_f) + c` to horizontal motion between
   consecutive frames gives the forward column θ_f, so the centre heading is
   `travel − θ_f`. Needs numpy + Pillow and thumbnails (Graph API).

## Validation so far (Panoramax, no token needed)

`test_panoramax.py` runs flow on public 360° sequences with their own heading.

- Rotating the frames by 0/90/180/270° gives answers within 6°.
- Paris, 36 windows of 5 pairs (imajbox, X3 and GoPro Max sequences): with a
  vote needing at least 3 passing pairs that agree, 22 correct, 14 abstained,
  0 wrong. The car-mounted imajbox was correct on every window. The
  abstentions are mostly GoPro Max sequences that look handheld.
- A roof camera doesn't move during a drive, so production can vote across a
  whole sequence, not just 5 pairs.

## Results with the tiles-only token (2026-11-17)

- `compass_angle` matches the GPS direction of travel (within 30°) for 130 of
  131 panoramas, the Azusa photo included (really driven westbound). The
  compass isn't the problem, so the 180° errors come from which side the lens
  faced, and that changed within NTHP's June 2026 drive.
- The 129 NTHP panoramas the site uses come from 52 sequences over 22 days.
- The Graph API refuses this token (400, error 100/33 on every image), so no
  thumbnails and no `computed_compass_angle`. The flow check needs a token
  with Graph read access.

## Results with a Read-access token (2026-11-17)

- `computed_compass_angle` came back for all 131 panoramas. Relative to
  `compass_angle` it is always about −90° or +90° (−135…−70, +80…+110).
- The lens side is constant within a sequence (0 of 54 sequences mixed), but
  NTHP's June 2026 drive has both sides, even on the same day: 100 photos
  left-facing, 14 right-facing.
- Image motion (`flow_mapillary.py`) agreed with `computed_compass_angle` on
  the side for all 123 photos it could call (median 2.8° apart, worst 34°).
  It abstained on 8 (too little motion or texture).
- The site's old guess put 15 photos the wrong way (16 sign views), Azusa
  among them.

Fix: the pipeline stores `computedCompass` (scripts/lib/mapillary.mjs
`lookupComputedCompass`), which `js/aim.js` already preferred. The flow check
stays here as an audit tool. It isn't needed in CI while Mapillary keeps
aligning these photos.

## Run against Mapillary (needs a token)

```sh
node research/mapillary-heading/probe.mjs <scratch>/probe.json
python -E -P research/mapillary-heading/flow_mapillary.py <scratch>/probe.json <scratch>/mly <scratch>/flow.json
```

`probe.mjs` also pulls `computed_compass_angle` (Mapillary's SfM alignment)
when the Graph API accepts the token. That is a third opinion to compare
against the flow result.
