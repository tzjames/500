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

Guidelines: landscape, at least 1600px wide, and dark enough that white UI
reads over it. The tint layer sits on top and does some of that work, but it
can't rescue a bright sky behind white text. Keep them compressed — they load
on every hand.

A missing file degrades quietly: nothing paints, and the wash shows through as
though `photo` were null.
