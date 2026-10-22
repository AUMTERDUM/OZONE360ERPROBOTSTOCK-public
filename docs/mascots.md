# Cartoon robot mascots

The app shows small cartoon robots in empty states, the login page, the 404 page and the public
repair-tracking page (`src/components/RobotMascot.tsx`, scenes in `src/utils/mascots.ts`).
Images are optional: a missing file just hides the mascot.

## Files

Put images in `public/mascots/`:

- `<robot>.webp` — the default pose (required for each robot that is used)
- `<robot>-<pose>.webp` — a scene-specific pose; falls back to `<robot>.webp` when missing

Format: **512×512 WebP, transparent background**, the robot centered, feet/base touching the bottom
~8% margin (motion pivots from the bottom center), nothing cropped. Keep each file under ~80 KB.

Reference photos are in `docs/mascot-refs/`.

| robot      | reference                    | real product            |
|------------|------------------------------|-------------------------|
| `kettybot` | `mascot-refs/kettybot.jpg`   | PUDU KettyBot           |
| `bellabot` | `mascot-refs/bellabot.png`   | PUDU BellaBot (cat)     |
| `pudubot2` | `mascot-refs/pudubot2.jpg`   | PUDU PuduBot 2 (trays)  |
| `flashbot` | `mascot-refs/flashbot.jpg`   | PUDU FlashBot           |
| `mt1`      | `mascot-refs/mt1.jpg`        | PUDU MT1 sweeper        |
| `cc1`      | `mascot-refs/cc1.png`        | PUDU CC1 scrubber       |
| `sh1`      | `mascot-refs/sh1.png`        | PUDU SH1 walk-behind scrubber |
| `t150`     | `mascot-refs/t150.png`       | PUDU T150 with shelf    |
| `t300`     | `mascot-refs/t300.png`       | PUDU T300 / column unit |
| `humanoid` | `mascot-refs/humanoid.png`   | PUDU humanoid           |

## Images to make (used by the app today)

| file                         | where it shows                        | pose / expression |
|------------------------------|---------------------------------------|-------------------|
| `kettybot-wave.webp`         | login page                            | waving hello, big smile on its face screen |
| `bellabot-celebrate.webp`    | "all clear" (no open tickets)         | arms raised, happy closed cat eyes, sparkles |
| `t150-lost.webp`             | 404 page                              | confused, looking around, a "?" above its head, small map in hand |
| `bellabot-empty.webp`        | empty lists                           | holding an empty tray, curious cat face |
| `humanoid-search.webp`       | search with no results                | holding a magnifying glass |
| `humanoid-celebrate.webp`    | repair tracking: completed            | thumbs-up / arms raised |
| `t300-repair.webp`           | load error, repair tracking: pending  | holding a wrench, small bandage, determined |
| `flashbot-deliver.webp`      | repair tracking: ready to ship        | carrying a parcel, motion lines |
| `mt1-sweep.webp`             | cleaning-related empty states         | brushes spinning, small dust puffs |
| `mt1-sleep.webp`             | quiet / nothing to do                 | eyes closed, "Zzz" |
| `cc1-clean.webp`             | cleaning-related empty states         | scrubbing, soap bubbles and water drops |

Plus one neutral default per robot (`<robot>.webp`).

## Style prompt (use the same for every image)

> Cute 2D cartoon mascot of the robot in the reference photo. Keep its real silhouette, colors and
> recognizable parts (screen face, trays, brushes, lidar, shelf) but simplify into a friendly
> chibi style: slightly bigger head/top, rounded edges, soft cel shading, thick clean dark outline,
> big expressive eyes on the robot's screen/face area. Flat pastel accent color #3b82f6 (blue) for
> highlights. Single character, full body, centered, transparent background, no text, no logo
> lettering, no shadow on the ground except a tiny soft ellipse. Consistent style across the set.
