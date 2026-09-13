# 13 Omens - Virtual Dice Bag

A virtual dice bag for the tabletop horror RPG **13 Omens**, with independent **Solo** saves and **server-authoritative multiplayer**. The existing horror interface and shared rules engine serve both modes.

Open `index.html` directly for Solo, or run the Node server below for Solo and multiplayer. No frontend build step or database is required.

## Run locally

Use Node.js 22 or later (verified with Node 24.14). From the project directory:

```sh
npm ci
npm start
```

Open **http://localhost:3000**. Use `npm install` when deliberately updating dependencies, `npm run dev` for server watch mode, and `npm test` for the complete suite. The committed lockfile supports `npm ci`.

The server listens on `0.0.0.0`, using `process.env.PORT` or port 3000. To choose a port in PowerShell:

```powershell
$env:PORT = '3001'
npm start
```

For a LAN game, connect devices to the same network, find the server computer's IPv4 address with `ipconfig`, and open `http://<that-address>:3000` on each device. Use the same address consistently: browser storage is origin-specific. The server computer must remain running and its firewall must permit the connection. No router, firewall, tunnel, or hosting settings are changed by this project.

## Project files

| Files | Purpose |
| --- | --- |
| `index.html`, `css/styles.css` | Existing application shell and responsive horror UI, extended with room and Check screens |
| `js/rules.js` | Shared pure rules, usable in the browser and Node |
| `js/state.js` | Shared validated state transitions; Solo persistence and isolated server stores |
| `js/app.js` | Existing game controls and reusable Check result rendering |
| `js/socket.js`, `js/multiplayer.js` | Network intent transport, reconnect identity, lobby and multiplayer controls |
| `server/server.js` | Express/Socket.IO entry point, static assets and health route |
| `server/room-manager.js`, `server/validation.js` | Canonical rooms, identities, permissions and input/state validation |
| `server/check-manager.js`, `server/socket-handlers.js` | Authoritative Check transitions and Socket.IO routing |
| `tests/*.test.js`, `tests.html` | Automated regressions and browser smoke tests |
| `package.json`, `package-lock.json`, `.gitignore` | Runtime dependencies, scripts and generated-file exclusions |

## Multiplayer Pass 3 (complete)

Host and Players share character sheets with five fixed Core Aspects and five stable Story slots. Host edits names, Ratings, Archetype, Description, Notes, Gear and Perks; Players read the same data. Story renames preserve IDs and Strain. Normal Checks send characterId and aspectId; the server snapshots name, Rating, base TN, difficulty and final TN. Players no longer confirm Ratings. Manual TN remains a Host option.

Strain buttons act directly on Aspect IDs. Auto-apply Strain Flaw is optional. Fixed story size determines death at 6/5/4/4/3/2 Wounds for 1–6 characters. Six-character stories change to threshold 3 after two distinct characters perish. Three-character stories grant each character one Strain removal per story. Set story size before play; adding/removing roster entries does not silently change it.

The assigned Player draws, rolls and resolves; other Players observe. Host can take over or cancel. Check data, character sheets and assignments survive reconnect. The inline SVG skull favicon requires no image asset.

### State authority and permissions

Multiplayer clients send intents, never authoritative dice or outcomes. Production draws and d6 faces use Node `crypto.randomInt` on the server. A constructor-injected RNG supports deterministic tests; it is not exposed over the socket. Shared `js/rules.js` and `js/state.js` perform composition, retained dice, totals, Wound eligibility, resolution and Omen bookkeeping, avoiding a second implementation of the rules.

The server validates authenticated room identity, role, current assignment, Check ownership, active character, phase, allowed payload fields, version, eligibility and the 13-Omen invariant. Only the Host calls Checks or changes management settings. Players can control only their assigned pending Check. The pending owner/character assignment is locked. Manual corrections, imports and reset are blocked while a Check is unresolved; multiplayer imports cannot inject Check records/results. The Host remains a trusted game administrator with validated correction tools outside a pending Check.

The current schema is version `4`; multiplayer adds the `AWAITING_PLAYER` phase and Check ownership/configuration metadata to `currentCheck`. The Check snapshots the Act **when the Host calls it**. Solo continues to snapshot on drawing. Changing the story Act with locking disabled never changes the pending Check's Act.

### Reconnect and duplicate actions

Rooms hold stable player IDs and private cryptographic reconnect tokens. Only token hashes are kept in server identity records; tokens are never broadcast or logged. Browser refresh or temporary network loss restores the same identity, assignment, phase, dice and result from the server without drawing or rolling again. A disconnected owner leaves the Check pending and the Host sees a waiting/takeover message.

A browser profile stores one resumable identity for this app origin. Reusing it in another tab replaces the old live connection; use separate browser profiles/devices for different Players. Leaving for Solo retains the resumable identity, while the saved mode prevents Solo refresh from unexpectedly rejoining. Multiplayer snapshots never overwrite the Solo save.

Each mutation carries a `baseVersion`; existing-Check intents also carry `checkId`. The server handles each validated transition synchronously, advances the version, and rejects stale or wrong-phase requests. Repeated Draw, Roll, Reroll or resolution requests cannot apply twice. Clients disable controls while busy/offline, refresh stale snapshots, and never blindly retry an uncertain mutation after an acknowledgement timeout.

### Socket contract

Successful acknowledgements use `{ ok: true, room?, session? }`; errors use `{ ok: false, error: { code, message } }`. `room:state` broadcasts canonical snapshots only within the affected room. Presence revisions are separate from game versions so presence updates do not silently change a pending game transaction.

| Events | Access and payload |
| --- | --- |
| `room:create`, `room:join`, `room:reconnect` | Create/join a session or authenticate a saved reconnect identity |
| `room:sync`, `room:leave` | Current session sync/leave |
| `player:assign-character` | Host assignment management |
| `game:action` | Host-only allowlisted game management with validated action arguments and version |
| `check:create` | Host; `{ configuration, baseVersion }` |
| `check:set-rating` | Retired compatibility endpoint; normal Ratings are locked |
| `check:draw`, `check:roll`, `check:reroll` | Check controller; `{ checkId, baseVersion }` |
| `check:select-roll` | Check controller; `{ checkId, baseVersion, rollName }` |
| `check:take-wound`, `check:cheat-death`, `check:valiant-sacrifice`, `check:finish` | Eligible Check controller; `{ checkId, baseVersion }` |
| `check:cancel`, `check:takeover` | Host; `{ checkId, baseVersion }` |

`configuration` contains `characterId`, `aspectId`, `manualTn`, `difficultyModifier`, `edges`, `flaws`, `risky`, `harmless`, `forcedOmen`. Only manual Checks accept `aspect` and `baseTn`. Normal Checks reject client Rating/TN fields.

The Pass-1 `game:check-state` endpoint is retired and rejects snapshots, including Host snapshots. `check:set-dice`, `check:set-result`, `check:set-total`, `check:set-wounds` and `check:replace-pending-check` explicitly reject outcomes. Extra payload fields such as supplied dice, totals or eligibility are rejected.

### Hosting and limitations

The existing Node/Express/Socket.IO setup remains compatible with `npm ci`, `npm start`, `process.env.PORT` and `0.0.0.0`. To update an existing Render deployment, push the changed project files to the same linked GitHub branch if auto-deploy is enabled; see [Render's deployment documentation](https://render.com/docs/deploys). No Render configuration or deployment was performed in this pass.

Rooms exist only in one server process's memory. Server restart/redeploy loses rooms and reconnect targets; this is not permanent persistence or a multi-worker deployment. No accounts, database, chat, matchmaking, external integrations or infrastructure were added. Disconnected seats remain reserved; Host eviction and lost-token recovery are not implemented. Character sheets store all ten Aspects. Static-only hosting supports Solo, not multiplayer.

A sensible next phase is durable room recovery across server restarts, followed by explicit seat/token recovery and usability improvements. Those are recommendations, outside this pass.

## Persistent Game State

In Solo mode, the app stores game state in `localStorage`, including the current Act, bag composition, Host Omens, character Wounds, character status, Cheat Death use, Strain, current pending Check, and the history log. Refreshing the browser should not erase the game, even if dice have been drawn but not rolled or a Wound is awaiting resolution.

The current state schema is version `4`. The existing localStorage key is retained. Valid older single-character saves and JSON imports migrate to `characters: [...]` and `selectedCharacterId`; the original character keeps their Wounds, Strain, status, and Cheat Death use and receives a persistent unique ID. Older phased Checks receive the migrated character ID and saved story Act when those snapshots are missing. Version 1 one-step Check data without phase information is discarded while persistent game state is retained. Migration is saved immediately on successful load so IDs survive refresh.

Malformed imports are rejected before replacing the game, including invalid counts, IDs, selection, Wounds, status, Strain, pending Checks, and Omen totals. Invalid stored saves fall back to a fresh game and emit a console warning; the original stored value is not overwritten during that failed load.

Use **New Game** to intentionally reset the saved state. The button asks for confirmation. It restores 8 Safe Dice, 13 Host Omens, 0 Bag Omens, Prologue, one active default character with no Wounds or Strain and unused Cheat Death, and no Check. Both Host preference toggles are preserved.

## Characters and Host Preferences

The compact Characters section supports **1–6 characters**, each with a stable unique ID and a trimmed, nonblank editable name. Duplicate names are allowed. Select a roster entry to choose who makes the next Check; **CHECKING FOR** names that character. Each entry shows Wounds and active/inactive status; the selected character also shows Strain and Cheat Death availability. Adding a seventh character and removing the final character are blocked.

Wounds, the automatic three-Wound Flaw, Cheat Death (once per story), Strain by Aspect, death/despair, and Valiant Sacrifice are independent for every character. Inactive characters cannot draw; the Host can reactivate them. Removing a character returns only their Wound Omens to the bag. A pending Check's owner cannot be removed, and character selection is locked until resolution or cancellation.

Host Tools has its own character selector for correcting Wounds, status, Cheat Death use, and Strain. Strain corrections accept an object such as `{"Courage": 1, "Fight": 0}`. Persistent corrections are blocked during pending Checks, and corrections must preserve the 13-Omen total.

**Auto-apply Strain Flaw** defaults **OFF**. Strain is always tracked and displayed. When ON, a matching Aspect with any Strain contributes exactly +1 Flaw. The optional Aspect name field supports names such as Courage or Fight; leaving it blank preserves the existing rating-based Aspect names. The existing rating and manual TN controls still determine the target number. Declared Flaws, Wound Flaws, matching Strain Flaws, Forced Omen Flaws, and their total are displayed separately.

**Lock Act during pending Check** defaults **ON**. Every Check snapshots both `characterId` and `act` at **Reach Into The Bag** in Solo or **Call for Check** in multiplayer; the project retains its existing `currentCheck` transaction field. All subsequent rolls, rerolls, and resolution use that Check's Act. The lock disables Act changes until resolution or cancellation. Turning it OFF permits changing the story Act, but never changes the pending Check's snapshot. The result panel displays both Acts explicitly. Both preferences and pending snapshots survive export, import, and refresh.

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
4. The controller may use **Use Original** or **Use Reroll**. Higher total is automatically selected as better; tied or table-specific cases can be selected manually.
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

Only one Wound can be received from a single Check. When **Take Wound** is selected, one qualifying Omen is removed from the bag/game draw cycle and placed in front of the character. At the story-size death threshold described above, only that character succumbs to death/despair, the Wound Omens return to the bag, Wounds reset to `0`, and the character is marked inactive.

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

Use **Export Game State** to place formatted JSON in the text area. Use **Import Game State** to restore a saved JSON state. Imported state is normalized and validated before replacing the current game. Solo supports pending Check restoration. Multiplayer import is Host-only, requires no unresolved Check, and rejects any imported `currentCheck`; it cannot submit client-generated Check outcomes.

## Verification

Run the complete suite with `npm test`. **193 tests pass**:

| Suite | Passing tests |
| --- | ---: |
| Existing rules | 44 |
| Existing state/migration | 28 |
| Existing DOM interaction | 8 |
| Pass-1 room/server regressions | 48 |
| Pass-1 network client regressions | 11 |
| New Pass-2 authoritative Checks | 54 |
| Total | 193 |

All 139 carried-forward tests pass. Transitional Pass-1 tests were updated to assert retirement of client Check snapshots and use the authoritative flow; no prior tests were removed. The 54 Pass-2 tests cover deterministic draw composition, fake outcomes, ownership, all Omen resolution paths, rerolls, Act snapshots/locks, assignment locks, reconnect before/after drawing and rolling, isolated rooms and duplicate/racing actions. Real Socket.IO integration tests exercise Host and Player clients. The original DOM suite uses a minimal adapter, while the following checks used actual browsers.

Manual local verification used a Host and two independent Player browser sessions, with separate loopback origins for separate storage:

- Room creation/join, character assignment and observer-only controls worked.
- The assigned Player confirmed Rating, drew and rolled; Host and observer displayed identical dice types, numbers and results.
- Player refresh preserved DRAWN dice, then preserved a rolled Check awaiting Wound resolution. Host refresh also reconnected during the pending Check.
- Cheat Death and pre-roll Valiant Sacrifice resolved on the server and preserved the Omen total of 13.
- Player disconnect showed the waiting state; Host takeover and cancellation worked.
- Returning to Solo and refreshing retained independent Solo mode/state.
- Host and both Player browser consoles had no warnings or errors. Server console inspection showed no obvious exceptions or secret logging.

Earlier Pass-1 manual testing also covered a Host plus three Players, shared Act/Bag updates, assignment persistence and synchronized resolution. These were local HTTP tests, not physical LAN-device or production Render tests. Desktop UI was visually inspected; narrow mobile layout was not reverified in this pass. `tests.html` remains available for a small browser rules smoke test.

## Change inventory

Across the requested multiplayer work, added files are `package.json`, `package-lock.json`, `.gitignore`, `js/socket.js`, `js/multiplayer.js`, all five files under `server/`, and `tests/multiplayer.test.js`, `tests/network-client.test.js`, `tests/checks.test.js`.

Changed existing files are `index.html`, `css/styles.css`, `js/rules.js`, `js/state.js`, `js/app.js` and this README. Pass 2 adds `server/check-manager.js` and `tests/checks.test.js` to the Pass-1 foundation and updates its server, transport, UI and transition tests. The original rules/state/DOM test files remain intact.

### Pass 3 verification (2026-09-13)

All 200 tests pass, including seven dedicated sheet/migration/group-size/TN/favicon tests. Updated obsolete Check and state tests; fixed legacy named-Strain lookup when using Aspect IDs. Browser verification covered Host edits, matching read-only Player sheets, Good Courage + Hard = TN 6, Player draw/roll and reconnect with unchanged drawn dice. Broader Pass 4 verification follows below.
