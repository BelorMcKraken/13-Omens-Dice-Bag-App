"use strict";
const { randomInt, randomUUID } = require("node:crypto");
const Rules = require("../js/rules.js");
const State = require("../js/state.js");
const { fail, object, text, number } = require("./validation.js");

const EVENTS = ["check:create", "check:set-rating", "check:draw", "check:roll", "check:reroll", "check:select-roll", "check:take-wound", "check:cheat-death", "check:valiant-sacrifice", "check:finish", "check:cancel", "check:takeover"];
const METHODS = { "check:roll": "rollCheck", "check:reroll": "rerollCheck", "check:select-roll": "chooseRoll", "check:take-wound": "takeWound", "check:cheat-death": "cheatDeath", "check:valiant-sacrifice": "valiantSacrifice", "check:finish": "finishCheck", "check:cancel": "cancelCheck" };
const clone = (value) => JSON.parse(JSON.stringify(value));

class CheckManager {
  constructor(rooms, rng = (min, max) => randomInt(min, max + 1)) { this.rooms = rooms; this.rng = rng; }

  configuration(input) {
    object(input, ["characterId", "aspect", "rating", "manualTn", "baseTn", "difficultyModifier", "edges", "flaws", "risky", "harmless", "forcedOmen", "allowPlayerRating"]);
    const characterId = text(input.characterId, "Character ID");
    const aspect = text(input.aspect, "Aspect");
    if (typeof input.rating !== "string" || !Object.hasOwn(Rules.ASPECTS, input.rating)) fail("INVALID_PAYLOAD", "Choose a known Rating.");
    for (const key of ["manualTn", "risky", "harmless", "forcedOmen", "allowPlayerRating"]) if (typeof input[key] !== "boolean") fail("INVALID_PAYLOAD", `Invalid ${key} setting.`);
    if (![-2, -1, 0, 1, 2].includes(input.difficultyModifier)) fail("INVALID_PAYLOAD", "Choose a known Difficulty.");
    const edges = number(input.edges, 2), flaws = number(input.flaws, 2);
    const baseTn = input.manualTn ? number(input.baseTn, 30) : Rules.ASPECTS[input.rating];
    if (baseTn < 1) fail("INVALID_PAYLOAD", "Base TN must be at least 1.");
    return { characterId, configuration: { aspect, rating: input.rating, manualTn: input.manualTn, baseTn,
      allowPlayerRating: input.allowPlayerRating && !input.manualTn, difficultyModifier: input.difficultyModifier,
      edges, flaws, risky: input.risky, harmless: input.harmless, forcedOmen: input.forcedOmen } };
  }

  create(socketId, payload) {
    const { room, player: host } = this.rooms.authorize(socketId);
    object(payload, ["configuration", "baseVersion"]);
    this.rooms.checkVersion(room, payload.baseVersion);
    if (State.hasUnresolvedCheck(room.gameState)) fail("CHECK_PENDING", "Resolve or cancel the current Check first.");
    const { characterId, configuration } = this.configuration(payload.configuration);
    const character = room.gameState.characters.find((entry) => entry.id === characterId);
    if (!character || !character.active) fail("INACTIVE_CHARACTER", "An active character is required for a Check.");
    const assigned = [...room.players.values()].find((entry) => entry.assignedCharacterId === characterId);
    const automaticFlaws = Rules.automaticFlawSources(room.gameState, configuration.aspect, { characterId });
    const composition = Rules.calculateCheckComposition({ ...configuration, automaticFlaws: automaticFlaws.wounds + automaticFlaws.strain });
    const check = { id: randomUUID(), characterId, characterName: character.name, playerId: assigned?.id || null,
      hostTakeover: !assigned || assigned.role === "HOST", act: room.gameState.act, phase: Rules.PHASE_REQUESTED,
      configuration, composition, automaticFlaws, finalTn: Rules.determineFinalTN(configuration.baseTn, configuration.difficultyModifier),
      dice: [], originalRoll: null, reroll: null, selectedRoll: null, forcedOmenCommitted: false, valiantAvailable: false, resolved: false };
    const next = clone(room.gameState); next.currentCheck = check; next.selectedCharacterId = characterId;
    const difficulty = Object.entries(Rules.DIFFICULTIES).find(([, value]) => value === configuration.difficultyModifier)[0];
    this.log(next, `${host.displayName} called for ${character.name} to make a ${difficulty} ${configuration.aspect} Check (${check.act}).`);
    this.rooms.acceptState(room, next);
    return room;
  }

  log(state, message) { state.history = [...state.history, { time: new Date().toISOString(), text: message }].slice(-250); }

  actor(socketId, payload, event) {
    const { room, player } = this.rooms.authorize(socketId, false);
    const extra = event === "check:set-rating" ? ["rating"] : event === "check:select-roll" ? ["rollName"] : [];
    object(payload, ["checkId", "baseVersion", ...extra]);
    this.rooms.checkVersion(room, payload.baseVersion);
    const check = room.gameState.currentCheck;
    if (!State.hasUnresolvedCheck(room.gameState) || check.id !== payload.checkId) fail("NO_PENDING_CHECK", "This Check is no longer pending.");
    const isHost = player.role === "HOST" && player.id === room.hostPlayerId;
    if (["check:cancel", "check:takeover"].includes(event)) {
      if (!isHost) fail("HOST_REQUIRED", "Host permission required.");
    } else if (isHost) {
      if (!check.hostTakeover) fail("TAKEOVER_REQUIRED", "Take over this Check before acting for the Player.");
    } else if (check.hostTakeover || check.playerId !== player.id || player.assignedCharacterId !== check.characterId) {
      fail("CHECK_OWNER_REQUIRED", "Only the assigned Player may control this Check.");
    }
    const character = room.gameState.characters.find((entry) => entry.id === check.characterId);
    if ((!character || !character.active) && event !== "check:cancel") fail("INACTIVE_CHARACTER", "This Check requires an active character.");
    return { room, player, check, character, isHost };
  }

  handle(socketId, event, payload) {
    if (!EVENTS.includes(event)) fail("INVALID_PAYLOAD", "Unknown Check action.");
    if (event === "check:create") return this.create(socketId, payload);
    const { room, player, check, character, isHost } = this.actor(socketId, payload, event);
    let next;
    const requirePhase = (...phases) => { if (!phases.includes(check.phase)) fail("ILLEGAL_PHASE", "That action is not available in this Check phase."); };
    if (event === "check:takeover") {
      if (check.hostTakeover) fail("ILLEGAL_ACTION", "The Host already controls this Check.");
      next = clone(room.gameState); next.currentCheck.hostTakeover = true;
      this.log(next, `${player.displayName} took over ${character.name}'s Check.`);
    } else if (event === "check:set-rating") {
      requirePhase(Rules.PHASE_REQUESTED);
      if (!check.configuration.allowPlayerRating) fail("RATING_LOCKED", "The Host has locked the Rating/TN.");
      if (typeof payload.rating !== "string" || !Object.hasOwn(Rules.ASPECTS, payload.rating)) fail("INVALID_PAYLOAD", "Choose a known Rating.");
      next = clone(room.gameState);
      next.currentCheck.configuration.rating = payload.rating;
      next.currentCheck.configuration.baseTn = Rules.ASPECTS[payload.rating];
      next.currentCheck.finalTn = Rules.determineFinalTN(Rules.ASPECTS[payload.rating], check.configuration.difficultyModifier);
      this.log(next, `${character.name} confirmed ${payload.rating} Rating (base TN ${Rules.ASPECTS[payload.rating]}).`);
    } else if (event === "check:draw") {
      requirePhase(Rules.PHASE_REQUESTED);
      // Reuse the existing transaction creation, on the requested owner and snapshotted Act.
      const drawState = clone(room.gameState);
      drawState.currentCheck = null; drawState.selectedCharacterId = check.characterId; drawState.act = check.act;
      const store = State.createStore({ storage: null, initialState: drawState });
      try { store.drawCheck(check.configuration, this.rng); } catch (error) { fail("ILLEGAL_ACTION", error.message); }
      next = store.getState(); next.act = room.gameState.act; next.selectedCharacterId = room.gameState.selectedCharacterId;
      Object.assign(next.currentCheck, { id: check.id, playerId: check.playerId, hostTakeover: check.hostTakeover,
        configuration: { ...check.configuration, ...next.currentCheck.configuration } });
    } else {
      if (event === "check:roll" || event === "check:valiant-sacrifice") requirePhase(Rules.PHASE_DRAWN);
      if (["check:reroll", "check:select-roll"].includes(event)) requirePhase(Rules.PHASE_ROLLED, Rules.PHASE_AWAITING_WOUND);
      if (event === "check:reroll" && check.reroll) fail("ILLEGAL_ACTION", "This Check has already been rerolled.");
      if (event === "check:select-roll" && (!check.reroll || !["original", "reroll"].includes(payload.rollName))) fail("ILLEGAL_ACTION", "Choose an available roll.");
      if (["check:take-wound", "check:cheat-death"].includes(event)) requirePhase(Rules.PHASE_AWAITING_WOUND);
      if (event === "check:finish") requirePhase(Rules.PHASE_ROLLED);
      const store = State.createStore({ storage: null, initialState: room.gameState });
      const args = event === "check:select-roll" ? [payload.rollName] : ["check:roll", "check:reroll"].includes(event) ? [this.rng] : [];
      try { store[METHODS[event]](...args); } catch (error) { fail("ILLEGAL_ACTION", error.message); }
      next = store.getState();
    }
    if (isHost && event !== "check:takeover") this.log(next, `${player.displayName} acted for ${character.name}: ${event.slice(6)}.`);
    this.rooms.acceptState(room, next);
    return room;
  }
}
module.exports = { CheckManager, EVENTS };
