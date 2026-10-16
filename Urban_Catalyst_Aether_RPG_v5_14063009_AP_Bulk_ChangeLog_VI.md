# Urban Catalyst Aether RPG — AP Bulk Allocation Update

## Changes
- Added numeric input `apSpendAmount` in the character AP allocation panel.
- Added quick amount presets: 1 AP, 10 AP, 100 AP and MAX.
- Added an allocation button to STR, AGI, INT, VIT and SPR rows, which spends the requested amount (capped at the AP currently available).
- AP allocation validates positive integer input and never spends more AP than the character has.
- Maintains existing weapon passive: when the exclusive ULR weapon is equipped, each AP spent adds +2 points to the chosen stat; otherwise each AP adds +1.
- Preserves Chí Tôn stat synchronization and existing save/persist flow.

## Validation
- JavaScript syntax check (`node --check`) passed.
- 175 HTML ids scanned, no duplicate ids found.
- Five bulk-allocation buttons are present.

Replace the existing `public/index.html` on GitHub with this file, commit, then deploy the latest commit on Render. The full browser/live-server gameplay flow has not been tested in this session.
