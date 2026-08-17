# Third-party notices

## Ten Lines and PokéFinder

- Project: https://github.com/Lincoln-LM/ten-lines
- License: GNU General Public License v3.0
- Used for: the Nintendo Switch and retail FireRed/LeafGreen seed-data formats and bundled generated seed databases; reference behavior for Gen III Method 1 static generation, IV/stat filtering, and console timing conversion.
- Ten Lines includes and adapts PokéFinder, copyright Admiral_Fish and contributors, under GPL-3.0.

The files under `public/generated/` originate from the corresponding Ten Lines generated assets.

## PokéFinder

- Project: https://github.com/Admiral-Fish/PokeFinder
- License: GNU General Public License v3.0
- Used for: reference behavior for Ruby/Sapphire TID/SID generation ordering (`IDGenerator3::generateRS` reads the Secret ID before the Trainer ID), the Berry Glitch day-count compensation in seed-to-time conversion, and the `Test/Gen3/id3.json` vectors used to check this project's Gen 3 ID generation.

## pret decompilations

- Projects: https://github.com/pret/pokeruby and https://github.com/pret/pokeemerald
- Used for: reference behavior for RTC seeding (`SeedRngWithRtc`, `RtcGetMinuteCount`, `ConvertDateToDayCount`, the `sRtcDummy` dead-battery fallback) and TID/SID generation (`InitPlayerTrainerId`, `SeedRngAndSetTrainerId`). No code is copied; the Hoenn seeding and ID model in `src/engine/rse.ts` and `src/engine/rseSid.ts` is derived from reading these decompilations.

## Lincoln's JS Finder

- Project: https://github.com/Lincoln-LM/JS-Finder
- License: GNU General Public License v3.0
- Used for: reference behavior for the Gen III TID/SID LCRNG sequence.

## EonTimer

- Project: https://github.com/DasAmpharos/EonTimer
- License: MIT
- Used for: reference behavior for custom-timer target-minus-hit calibration, the GBA frame rate, and the precision worker/action scheduling architecture.
