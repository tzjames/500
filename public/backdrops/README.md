# Backdrop photography

One wide landscape shot per location, layered under the theme's gradient wash
and tint (see `LOCATIONS` in `src/theme.js`). A location with `photo: null`
renders its wash alone.

Filenames match the location's `photo` path:

| Location         | File            | Shot                                     |
| ---------------- | --------------- | ---------------------------------------- |
| Victoria Falls   | `falls.jpg`     | Dawn mist, from the eastern cataract     |
| Zanzibar Beach   | `zanzibar.jpg`  | Low tide at Nungwi, late afternoon       |
| Samaná           | `samana.jpg`    | Sunrise over the bay, from Playa Rincón  |
| Grand Canyon Rim | `canyon.jpg`    | South rim, twenty minutes before sunset  |
| Sierra Nevada    | `sierras.jpg`   | Granite and still water at dusk          |
| Serengeti        | `serengeti.jpg` | Acacia and giraffe, late afternoon haze  |

All six are supplied and wired in `src/theme.js`.

## Mzumbe

Private backdrops: offered only when James or Graham is at the table, gated by
`locationAllowed` in `src/theme.js` and enforced by the mirror of it in
`server/tableTheme.js`. They have no plain-colour twin — the photograph is the
point of them — and they carry heavier tints than the set above, because all but
the last are midday shots with a blown-out sky at the top of the frame.

| Location        | File              | Shot                                     |
| --------------- | ----------------- | ---------------------------------------- |
| Mzumbe Road     | `mzumbe1.jpg`     | The red road in, late morning            |
| Uluguru Ridge   | `mzumbe2.jpg`     | Haze along the ridge from the valley     |
| Morogoro Valley | `mzumbe3.jpg`     | Mango trees and cloud over the escarpment|
| Highland Peaks  | `mzumbe4.jpg`     | Forest ridges in the morning haze        |
| Mzumbe Quad     | `mzumbe5.jpg`     | Tin roofs and the flagpole at midday     |
| Common Room     | `fakemzumbe.jpg`  | The common room, bottles out             |

`mzumbe2`, `mzumbe4` and `mzumbe5` are below the 1600px guideline at the foot of
this file (1024, 1024 and 800 wide). They read acceptably under the tint but are the softest in
the set.

Guidelines: landscape, at least 1600px wide, and dark enough that white UI
reads over it. The tint layer sits on top and does some of that work, but it
can't rescue a bright sky behind white text. Keep them compressed — they load
on every hand.

A missing file degrades quietly: nothing paints, and the wash shows through as
though `photo` were null.
