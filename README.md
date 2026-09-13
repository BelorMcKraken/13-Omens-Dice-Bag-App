# 13 Omens - Virtual Dice Bag

A complete local-browser utility for running the tabletop horror RPG **13 Omens**. This is a Host/GM-facing persistent virtual dice bag, not a character builder and not a multiplayer app.

Open `index.html` in a modern browser and use it immediately. No build step, Node project, database, or backend is required.

## Project Structure

- `index.html` - semantic application shell
- `css/styles.css` - responsive horror-themed interface styling
- `js/rules.js` - reusable rules engine
- `js/state.js` - single source of truth, validation, localStorage persistence
- `js/app.js` - DOM rendering and UI event handling
- `tests/rules.test.js` - Node-compatible programmatic rule tests
- `tests.html` - small browser smoke-test page

## Persistent Game State

The app stores game state in `localStorage`, including the current Act, bag composition, Host Omens, character Wounds, character status, Cheat Death use, Strain, current pending Check, and the history log. Refreshing the browser should not erase the game, even if dice have been drawn but not rolled or a Wound is awaiting resolution.

The current state schema is version `3`. The existing localStorage key is retained. Valid older single-character saves and JSON imports migrate to `characters: [...]` and `selectedCharacterId`; the original character keeps their Wounds, Strain, status, and Cheat Death use and receives a persistent unique ID. Older phased Checks receive the migrated character ID and saved story Act when those snapshots are missing. Version 1 one-step Check data without phase information is discarded while persistent game state is retained. Migration is saved immediately on successful load so IDs survive refresh.

Malformed imports are rejected before replacing the game, including invalid counts, IDs, selection, Wounds, status, Strain, pending Checks, and Omen totals. Invalid stored saves fall back to a fresh game and emit a console warning; the original stored value is not overwritten during that failed load.

Use **New Game** to intentionally reset the saved state. The button asks for confirmation. It restores 8 Safe Dice, 13 Host Omens, 0 Bag Omens, Prologue, one active default character with no Wounds or Strain and unused Cheat Death, and no Check. Both Host preference toggles are preserved.

## Characters and Host Preferences

The compact Characters section supports **1–6 characters**, each with a stable unique ID and a trimmed, nonblank editable name. Duplicate names are allowed. Select a roster entry to choose who makes the next Check; **CHECKING FOR** names that character. Each entry shows Wounds and active/inactive status; the selected character also shows Strain and Cheat Death availability. Adding a seventh character and removing the final character are blocked.

Wounds, the automatic three-Wound Flaw, Cheat Death (once per story), Strain by Aspect, death/despair, and Valiant Sacrifice are independent for every character. Inactive characters cannot draw; the Host can reactivate them. Removing a character returns only their Wound Omens to the bag. A pending Check's owner cannot be removed, and character selection is locked until resolution or cancellation.

Host Tools has its own character selector for correcting Wounds, status, Cheat Death use, and Strain. Strain corrections accept an object such as `{"Courage": 1, "Fight": 0}`. Persistent corrections are blocked during pending Checks, and corrections must preserve the 13-Omen total.

**Auto-apply Strain Flaw** defaults **OFF**. Strain is always tracked and displayed. When ON, a matching Aspect with any Strain contributes exactly +1 Flaw. The optional Aspect name field supports names such as Courage or Fight; leaving it blank preserves the existing rating-based Aspect names. The existing rating and manual TN controls still determine the target number. Declared Flaws, Wound Flaws, matching Strain Flaws, Forced Omen Flaws, and their total are displayed separately.

**Lock Act during pending Check** defaults **ON**. Every Check always snapshots both `characterId` and `act` at **Reach Into The Bag**; the project retains its existing `currentCheck` transaction field. All subsequent rolls, rerolls, and resolution use that Check's Act. The lock disables Act changes until resolution or cancellation. Turning it OFF permits changing the story Act, but never changes the pending Check's snapshot. The result panel displays both Acts explicitly. Both preferences and pending snapshots survive export, import, and refresh.

## Dice Bag Model

The bag tracks counts of individual d6 types:

- Safe Dice
- Omen Dice

A Check randomly draws actual dice from the current bag without replacement. The app does not roll independent percentages, so impossible combinations cannot be produced. Drawn dice are temporary: they normally return after the Check, unless a rule removes one.

## Check Lifecycle

Checks now use an explicit transaction:

1. **Reach Into The Bag** draws die identities and sources only.
2. **Roll Dice** assigns d6 results and calculates the selected roll.
3. Optional **Reroll Same Dice** preserves the exact same die types and sources, rolls new d6 faces, recalculates kept dice, success level, Risky failure, and Omen Wound eligibility.
4. The Host may use **Use Original** or **Use Reroll**. Higher total is automatically selected as better; tied or table-specific cases can be selected manually.
5. **Finish Check**, **Take Wound**, **Cheat Death**, **Harmless** resolution, or **Valiant Sacrifice** settles the transaction.

Persistent bag and Wound state are not permanently changed until the Check is finalized or resolved. **Cancel Check** is a Host correction tool that aborts an unresolved Check; bag dice return conceptually, and a pending Forced Omen returns to the Host pool.

## Target Numbers

The Host may select an Aspect or enable manual TN entry.

- Great: TN 4
- Good: TN 5
- Average: TN 7
- Bad: TN 9
- Terrible: TN 10

Difficulty modifies the base TN from Very Easy `-2` through Very Hard `+2`. The result is:

- Roll total greater than TN: Full Success
- Roll total equal to TN: Success With Complication
- Roll total below TN: Failure

## Edges And Flaws

Edges and Flaws cancel one-for-one before drawing.

- Net Edge: draw extra dice and use the two highest results
- Net Flaw: draw extra dice and use the two lowest results
- No net modifier: draw two dice and use both

At three Omen Wounds, the app automatically adds one Flaw to that character's Checks. A Forced Omen also acts as one Flaw, even if an Edge cancels that Flaw for total calculation.

Effective Flaws have **no rules cap**. Declared Flaws retain the existing 0–2 controls, but all automatic sources are added without clamping. For example, 2 declared + 1 Wound + 1 Strain + 1 Forced Omen = 5 Flaws: with no Edges, draw 6 bag dice plus the Forced Omen and keep the lowest two. Insufficient physical bag dice still block a Check.

## Wounds

Every Omen Die rolled is checked for Wounds, even if it was discarded by an Edge or Flaw and did not contribute to the Check total.

- Act 1: Omen result `1`
- Act 2: Omen result `1-2`
- Act 3: Omen result `1-3`
- Prologue: no automatic Omen Wound threshold

Only one Wound can be received from a single Check. When **Take Wound** is selected, one qualifying Omen is removed from the bag/game draw cycle and placed in front of the character. At four Wounds, only that character succumbs to death/despair, the Wound Omens return to the bag, Wounds reset to `0`, and the character is marked inactive.

## Cheat Death

If a Check would cause an Omen Wound and at least one Safe Die from the bag participated in the Check, **Cheat Death** may be selected if it has not already been used. The app enforces both stated limits by treating Cheat Death as once per story, which is stricter than once per Act.

Cheat Death removes one Safe Die from the bag, does not add an Omen Wound, and marks Cheat Death as used.

## Harmless And Risky

For a **Harmless** Check, a qualifying Omen causes Strain rather than a Wound. The app records Strain by the selected Aspect and returns the Omen to the appropriate pool.

For a **Risky** Check, the dice and success result are unchanged. If the Check fails, the app shows a Host reminder to adjudicate a consequence such as Strain, lost Gear, or an appropriate Perk being spent or broken.

## Forced Omen / Facing Evil

A Forced Omen comes directly from the Host Omen pool and is added to the Check as a required Omen Die. It also contributes one Flaw before Edge/Flaw cancellation.

Important draw math: a Forced Omen is already one of the physical dice in the Check. For example, Forced Omen with no Edges or ordinary Flaws draws `2` bag dice plus `1` Forced Omen, then keeps the lowest two. If one Edge cancels the Forced Omen's Flaw, the Check draws `1` bag die plus the Forced Omen and resolves normally. The Forced Omen is still rolled.

Implementation choice: the Forced Omen is moved out of the Host pool when the Check is drawn. If it does not become the selected Wound, it enters the bag after the Check resolves. If it becomes the Wound, it is placed with the character and does not also enter the bag. If several Omens qualify, a bag Omen is selected as the Wound before a Forced Omen for deterministic bookkeeping; all other Omens return to or enter the bag as appropriate.

The invariant is:

```text
Host Omens + Bag Omens + sum of ALL character Wounds + pending Forced Omen = 13
```

Automated tests assert this across normal resolution, Wounds, Cheat Death, Harmless Checks, Valiant Sacrifice, cancellation, and stress simulations.

## Valiant Sacrifice

When the character has three Omen Wounds and the drawn/included dice contain at least one Omen Die, **Valiant Sacrifice** becomes available before rolling. Selecting it generates no die results, marks the Check as an automatic success, returns current Wound Omens to the bag, returns any Forced Omen to the bag, resets Wounds to `0`, and marks the character inactive/dead.

## Reroll Same Dice

Rerolling preserves the exact die types and sources from the current Check. It generates new d6 results, recalculates the kept dice, Check total, success level, Risky failure, and Omen Wound eligibility. The selected roll controls final Wound resolution, so a reroll can introduce a qualifying Omen or remove one from the active result.

## Export And Import

Use **Export Game State** to place formatted JSON in the text area. Use **Import Game State** to restore a saved JSON state. Imported state is normalized and validated before replacing the current game.

## Tests

If Node is available, run:

```bash
node tests/rules.test.js
node tests/state.test.js
node tests/ui.test.js
```

The Node suite includes the original core rules plus Forced Omen, Valiant Sacrifice, reroll, cancellation, Omen-economy, and randomized stress regression coverage. You can also open `tests.html` in a browser for a small browser smoke test.

The expanded suite includes 44 existing rule tests, 28 state/migration tests, and 8 DOM interaction tests. The DOM suite executes the real UI handlers with a minimal DOM adapter; it does not verify browser layout.

### Manual verification status

Browser verification was attempted during this pass, but the browser security policy blocked the local file URL. No manual browser scenarios or mobile/desktop visual checks are claimed as passed. Automated coverage exercises the requested A–K behaviors, including six-character limits, independent Wounds/Strain/Cheat Death/death, Flaw sources, Act locks and snapshots, and pending state reload. Open `index.html` to finish the visual/manual pass, especially at narrow mobile widths. Host Strain correction currently uses JSON; the normal Record Strain action requires no JSON entry.

## Static Deployment

This is a static site. To deploy through GitHub Pages:

1. Commit the folder to a GitHub repository.
2. In repository settings, enable Pages.
3. Select the branch containing `index.html`.
4. Use the published Pages URL.

Any static host such as Cloudflare Pages, Netlify, or a plain web server can serve the same files.
