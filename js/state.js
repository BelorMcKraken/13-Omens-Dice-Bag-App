(function (root, factory) {
  const Rules = typeof module === "object" && module.exports ? require("./rules.js") : root.ThirteenOmensRules;
  const createStore = (options) => {
    const store = factory(Rules, options);
    store.createStore = createStore;
    return store;
  };
  const api = createStore();
  api.createStore = createStore;
  root.ThirteenOmensState = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function (Rules, options) {
  "use strict";
  options = options || {};

  const STORAGE_KEY = "thirteen-omens-dice-bag-state-v1";
  const SCHEMA_VERSION = 3;

  function newCharacter(name = "Character 1") {
    return { id: globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `char-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name, wounds: 0, active: true, cheatDeathUsed: false, safeDiceLost: 0, strain: {}, statusMessage: "" };
  }

  function defaultState() {
    const character = newCharacter();
    return { schemaVersion: SCHEMA_VERSION, version: SCHEMA_VERSION, act: "Prologue",
      bag: { safe: 8, omen: 0 }, hostOmens: 13, characters: [character], selectedCharacterId: character.id,
      settings: { autoApplyStrainFlaw: false, lockActDuringPendingCheck: true }, currentCheck: null,
      history: [{ time: new Date().toISOString(), text: "Game Started" }] };
  }

  const storage = Object.hasOwn(options, "storage") ? options.storage : typeof localStorage !== "undefined" ? localStorage : null;
  let transport = null;
  let mode = "solo";
  let state = options.initialState ? normalizeState(options.initialState) : loadState();
  const sanitizeInteger = Rules.clampInteger;

  function normalizeState(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid game state.");
    const next = JSON.parse(JSON.stringify(input));
    const legacy = !Object.hasOwn(next, "characters");
    if (legacy) {
      if (!next.character || typeof next.character !== "object") throw new Error("Missing character state.");
      const character = { ...newCharacter(), ...next.character };
      character.id = character.id || newCharacter().id;
      character.name = character.name || "Character 1";
      next.characters = [character];
      next.selectedCharacterId = character.id;
      delete next.character;
    }
    next.settings = { autoApplyStrainFlaw: false, lockActDuringPendingCheck: true, ...next.settings };
    next.history = Array.isArray(next.history) ? next.history.slice(-250) : [];
    if (Array.isArray(next.characters)) next.characters = next.characters.map((character) => ({
      safeDiceLost: 0, statusMessage: "", ...character,
      name: typeof character.name === "string" ? character.name.trim() : character.name,
    }));
    if (next.currentCheck && !next.currentCheck.phase && (input.schemaVersion || input.version || 1) < 2) next.currentCheck = null;
    if (next.currentCheck && (input.schemaVersion || input.version || 1) < 3) {
      next.currentCheck.characterId ??= next.selectedCharacterId;
      next.currentCheck.act ??= next.act;
      next.currentCheck.characterName ??= next.characters[0].name;
    }
    next.currentCheck ??= null;
    next.schemaVersion = next.version = SCHEMA_VERSION;
    const errors = validateState(next);
    if (errors.length) throw new Error(errors.join(" "));
    return next;
  }

  function hasUnresolvedCheck(candidate) {
    return Boolean(candidate.currentCheck && candidate.currentCheck.phase !== Rules.PHASE_RESOLVED);
  }

  function validateState(candidate) {
    const errors = [];
    const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
    if (!Rules.ACTS.includes(candidate.act)) errors.push("Invalid act.");
    if (!candidate.bag || !integer(candidate.bag.safe, 99) || !integer(candidate.bag.omen, 13) || !integer(candidate.hostOmens, 13)) errors.push("Invalid dice counts.");
    const characters = candidate.characters;
    if (!Array.isArray(characters) || characters.length < 1 || characters.length > 6) return [...errors, "Must have 1–6 characters."];
    const ids = new Set();
    for (const character of characters) {
      if (!character || typeof character.id !== "string" || !character.id.trim() || ids.has(character.id)) { errors.push("Invalid or duplicate character ID."); continue; }
      ids.add(character.id);
      if (typeof character.name !== "string" || !character.name.trim()) errors.push("Character names cannot be blank.");
      if (!integer(character.wounds, 4) || typeof character.active !== "boolean" || typeof character.cheatDeathUsed !== "boolean" || !integer(character.safeDiceLost, 99)) errors.push("Invalid character Wounds or status.");
      if (!character.strain || typeof character.strain !== "object" || Array.isArray(character.strain) || Object.entries(character.strain).some(([key, value]) => !key.trim() || !(typeof value === "boolean" || integer(value, Number.MAX_SAFE_INTEGER)))) errors.push("Invalid character Strain.");
    }
    if (!ids.has(candidate.selectedCharacterId)) errors.push("Invalid selected character ID.");
    if (!candidate.settings || typeof candidate.settings.autoApplyStrainFlaw !== "boolean" || typeof candidate.settings.lockActDuringPendingCheck !== "boolean") errors.push("Invalid Host settings.");
    if (!Array.isArray(candidate.history) || candidate.history.some((entry) => !entry || typeof entry.text !== "string" || typeof entry.time !== "string" || !Number.isFinite(Date.parse(entry.time)))) errors.push("Invalid session history.");
    const check = candidate.currentCheck;
    if (check) {
      if (!Rules.ACTS.includes(check.act) || !ids.has(check.characterId)) errors.push("Invalid Check character or Act snapshot.");
      if (![Rules.PHASE_REQUESTED, Rules.PHASE_DRAWN, Rules.PHASE_ROLLED, Rules.PHASE_AWAITING_WOUND, Rules.PHASE_RESOLVED].includes(check.phase) || !Array.isArray(check.dice) || (check.phase === Rules.PHASE_REQUESTED ? check.dice.length !== 0 : check.dice.length < 2) || !check.configuration || !check.composition) errors.push("Invalid pending Check.");
      else {
        if (typeof check.forcedOmenCommitted !== "boolean" || check.dice.filter((die) => die && die.source === "forced").length !== Number(check.forcedOmenCommitted)) errors.push("Invalid Forced Omen commitment.");
        if (!Number.isFinite(check.finalTn) || !["NORMAL", "EDGE", "FLAW"].includes(check.composition.resolutionMode)) errors.push("Invalid Check configuration.");
        for (const roll of [check.originalRoll, check.reroll].filter(Boolean)) {
          if (!Array.isArray(roll.dice) || roll.dice.length !== check.dice.length || roll.dice.some((die, i) => !die || !integer(die.result, 6) || die.result < 1 || die.type !== check.dice[i].type || die.source !== check.dice[i].source) || !Number.isFinite(roll.total) || typeof roll.result !== "string" || !roll.wound || typeof roll.wound.triggered !== "boolean" || !Array.isArray(roll.wound.qualifyingDice) || (roll.wound.triggered && !roll.wound.selectedWoundDie)) errors.push("Invalid Check roll.");
        }
        if (check.dice.some((die) => !die || ![Rules.DIE_SAFE, Rules.DIE_OMEN].includes(die.type) || !["bag", "forced"].includes(die.source))) errors.push("Invalid Check dice.");
        if (check.phase !== Rules.PHASE_REQUESTED && check.phase !== Rules.PHASE_DRAWN && !check.valiantResolved && (!check.originalRoll || !Rules.getSelectedRoll(check))) errors.push("Missing Check roll.");
      }
    }
    if (!errors.length && !Rules.validateOmenEconomy(candidate)) errors.push("Omen economy must total 13 across Host, bag, all characters' Wounds, and pending Forced Omen.");
    return errors;
  }

  function saveState() {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const loaded = normalizeState(JSON.parse(raw));
      storage?.setItem(STORAGE_KEY, JSON.stringify(loaded));
      return loaded;
    } catch (error) {
      console.warn("Could not load saved 13 Omens state.", error);
      return defaultState();
    }
  }

  function getState() {
    return JSON.parse(JSON.stringify(state));
  }

  function addHistory(text) {
    state.history.push({ time: new Date().toISOString(), text });
    state.history = state.history.slice(-250);
  }

  function commit(mutator, logMessage) {
    const draft = getState();
    mutator(draft);
    const next = normalizeState(draft);
    const message = typeof logMessage === "function" ? logMessage(next) : logMessage;
    if (message) next.history = [...next.history, { time: new Date().toISOString(), text: message }].slice(-250);
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    state = next;
    return getState();
  }

  function resetGame() {
    state = { ...defaultState(), settings: { ...state.settings } };
    saveState();
    return getState();
  }

  function importState(candidate) {
    const next = normalizeState(candidate);
    const errors = validateState(next);
    if (errors.length) throw new Error(errors.join(" "));
    next.history.push({ time: new Date().toISOString(), text: "Imported game state" });
    next.history = next.history.slice(-250);
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    state = next;
    return getState();
  }

  function clearLog() {
    return commit((draft) => {
      draft.history = [];
    }, "Log cleared");
  }

  function blockIfPending(draft) {
    if (hasUnresolvedCheck(draft)) throw new Error("Cancel or resolve the pending Check before changing persistent state.");
  }

  function setAct(act) {
    return commit((draft) => {
      if (draft.settings.lockActDuringPendingCheck) blockIfPending(draft);
      draft.act = act;
    }, `Act changed to ${act}`);
  }

  function addOmenToBag() {
    return commit((draft) => {
      blockIfPending(draft);
      if (draft.hostOmens < 1) throw new Error("No Host Omens remain.");
      draft.hostOmens -= 1;
      draft.bag.omen += 1;
    }, "Omen added to bag");
  }

  function removeOmenFromBag() {
    return commit((draft) => {
      blockIfPending(draft);
      if (draft.bag.omen < 1) throw new Error("No Omen Dice are in the bag.");
      draft.bag.omen -= 1;
      draft.hostOmens += 1;
    }, "Omen removed from bag");
  }

  function applyManual(values) {
    return commit((draft) => {
      blockIfPending(draft);
      draft.bag.safe = sanitizeInteger(values.safe, 0, 99);
      draft.bag.omen = sanitizeInteger(values.omen, 0, 13);
      draft.hostOmens = sanitizeInteger(values.host, 0, 13);
      const character = draft.characters.find((entry) => entry.id === (values.characterId || draft.selectedCharacterId));
      if (!character) throw new Error("Unknown character.");
      character.wounds = sanitizeInteger(values.wounds, 0, 4);
      character.active = values.active === "true" || values.active === true;
      draft.act = Rules.ACTS.includes(values.act) ? values.act : draft.act;
      if (values.strain !== undefined) character.strain = values.strain;
      if (values.cheatDeathUsed !== undefined) character.cheatDeathUsed = values.cheatDeathUsed;
    }, (draft) => `${draft.characters.find((entry) => entry.id === (values.characterId || draft.selectedCharacterId)).name} — Host tools adjusted game state`);
  }

  function drawCheck(options, rng) {
    return commit((draft) => {
      if (hasUnresolvedCheck(draft)) throw new Error("Resolve or cancel the pending Check before drawing another.");
      const check = Rules.drawCheckDice(draft, options, rng);
      if (check.forcedOmenCommitted) draft.hostOmens -= 1;
      draft.currentCheck = check;
    }, (draft) => `${Rules.getCharacter(draft, draft.currentCheck).name} — ${draft.currentCheck.configuration.aspect} Check (${draft.currentCheck.act}): ${formatDraw(draft.currentCheck)}`);
  }

  function rollCheck(rng) {
    return commit((draft) => {
      if (!hasUnresolvedCheck(draft)) throw new Error("No pending Check.");
      draft.currentCheck = Rules.rollPendingCheck(draft.currentCheck, draft.currentCheck.act, rng);
    }, (draft) => `${Rules.getCharacter(draft, draft.currentCheck).name} — Roll: ${formatRoll(draft.currentCheck && Rules.getSelectedRoll(draft.currentCheck))}`);
  }

  function rerollCheck(rng) {
    return commit((draft) => {
      if (!hasUnresolvedCheck(draft)) throw new Error("No pending Check.");
      draft.currentCheck = Rules.rerollPendingCheck(draft.currentCheck, draft.currentCheck.act, rng);
    }, (draft) => `${Rules.getCharacter(draft, draft.currentCheck).name} — Reroll Same Dice: ${formatRoll(Rules.getSelectedRoll(draft.currentCheck))}`);
  }

  function chooseRoll(rollName) {
    return commit((draft) => {
      if (!hasUnresolvedCheck(draft)) throw new Error("No pending Check.");
      draft.currentCheck = Rules.selectRoll(draft.currentCheck, rollName);
    }, (draft) => `${Rules.getCharacter(draft, draft.currentCheck).name} — Selected ${rollName === "reroll" ? "Reroll" : "Original"} result`);
  }

  function finishCheck() {
    return commit((draft) => {
      if (!hasUnresolvedCheck(draft)) throw new Error("No pending Check.");
      const selected = Rules.getSelectedRoll(draft.currentCheck);
      if (!selected) throw new Error("Roll the Check before finishing it.");
      if (selected.wound.triggered && !draft.currentCheck.configuration.harmless) throw new Error("Resolve the Wound before finishing this Check.");
      const next =
        draft.currentCheck.configuration.harmless && selected.wound.triggered
          ? Rules.resolveHarmless(draft, draft.currentCheck, draft.currentCheck.configuration.aspect)
          : Rules.finishNoWound(draft, draft.currentCheck);
      Object.assign(draft, next);
      draft.currentCheck.phase = Rules.PHASE_RESOLVED;
      draft.currentCheck.resolved = true;
    }, (draft) => `${Rules.getCharacter(draft, draft.currentCheck).name} — Check resolved${draft.currentCheck.configuration.harmless && Rules.getSelectedRoll(draft.currentCheck).wound.triggered ? "; Strain recorded: " + draft.currentCheck.configuration.aspect : ""}`);
  }

  function cancelCheck() {
    const name = state.currentCheck ? Rules.getCharacter(state, state.currentCheck).name : "Character";
    return commit((draft) => {
      if (!hasUnresolvedCheck(draft)) throw new Error("No pending Check is available to cancel.");
      if (draft.currentCheck.forcedOmenCommitted) draft.hostOmens += 1;
      draft.currentCheck = null;
    }, `${name} — Pending Check canceled; temporary dice restored`);
  }

  function takeWound() {
    return commit((draft) => {
      if (!hasUnresolvedCheck(draft)) throw new Error("No pending Check.");
      const selected = Rules.getSelectedRoll(draft.currentCheck);
      if (!selected || !selected.wound.triggered || draft.currentCheck.configuration.harmless) throw new Error("No Omen Wound to resolve.");
      const next = Rules.resolveWound(draft, draft.currentCheck);
      Object.assign(draft, next);
      draft.currentCheck.phase = Rules.PHASE_RESOLVED;
      draft.currentCheck.resolved = true;
    }, (draft) => `${Rules.getCharacter(draft, draft.currentCheck).name} took an Omen Wound${Rules.getCharacter(draft, draft.currentCheck).active ? "" : " and succumbed to Death/Despair; their Wound Omens returned to the bag"}`);
  }

  function cheatDeath() {
    return commit((draft) => {
      if (!hasUnresolvedCheck(draft)) throw new Error("No pending Check.");
      if (!Rules.getSelectedRoll(draft.currentCheck) || draft.currentCheck.configuration.harmless) throw new Error("No Omen Wound to resolve.");
      const next = Rules.resolveCheatDeath(draft, draft.currentCheck);
      Object.assign(draft, next);
      draft.currentCheck.phase = Rules.PHASE_RESOLVED;
      draft.currentCheck.resolved = true;
    }, (draft) => `${Rules.getCharacter(draft, draft.currentCheck).name} used Cheat Death`);
  }

  function valiantSacrifice() {
    return commit((draft) => {
      if (!hasUnresolvedCheck(draft)) throw new Error("No pending Check.");
      const next = Rules.resolveValiantSacrifice(draft, draft.currentCheck);
      Object.assign(draft, next);
      draft.currentCheck.phase = Rules.PHASE_RESOLVED;
      draft.currentCheck.resolved = true;
      draft.currentCheck.valiantResolved = true;
    }, (draft) => `${Rules.getCharacter(draft, draft.currentCheck).name} — Valiant Sacrifice resolved before rolling`);
  }

  function reviveCharacter() {
    return commit((draft) => {
      blockIfPending(draft);
      Rules.getCharacter(draft).active = true;
      Rules.getCharacter(draft).statusMessage = "Character status manually set to active.";
    }, (draft) => `${Rules.getCharacter(draft).name} — status reset to active`);
  }

  function recordStrain(aspect) {
    return commit((draft) => {
      blockIfPending(draft);
      const key = aspect || "Unassigned";
      Rules.getCharacter(draft).strain[key] = (Rules.getCharacter(draft).strain[key] || 0) + 1;
    }, (draft) => `${Rules.getCharacter(draft).name} — Strain recorded: ${aspect || "Unassigned"}`);
  }

  function setSetting(key, value) {
    return commit((draft) => {
      if (!["autoApplyStrainFlaw", "lockActDuringPendingCheck"].includes(key) || typeof value !== "boolean") throw new Error("Invalid setting.");
      draft.settings[key] = value;
    });
  }

  function addCharacter() {
    return commit((draft) => {
      if (draft.characters.length >= 6) throw new Error("Maximum 6 characters reached.");
      draft.characters.push(newCharacter(`Character ${draft.characters.length + 1}`));
    }, "Character added");
  }

  function selectCharacter(id) {
    return commit((draft) => {
      blockIfPending(draft);
      if (!draft.characters.some((character) => character.id === id)) throw new Error("Unknown character.");
      draft.selectedCharacterId = id;
    });
  }

  function renameCharacter(id, name) {
    return commit((draft) => {
      if (typeof name !== "string" || !name.trim()) throw new Error("Character names cannot be blank.");
      const character = draft.characters.find((entry) => entry.id === id);
      if (!character) throw new Error("Unknown character.");
      character.name = name.trim();
    });
  }

  function removeCharacter(id) {
    const name = state.characters.find((entry) => entry.id === id)?.name || "Character";
    return commit((draft) => {
      if (draft.characters.length === 1) throw new Error("Cannot remove the final character.");
      if (hasUnresolvedCheck(draft) && draft.currentCheck.characterId === id) throw new Error("Cancel or resolve this character's pending Check before removal.");
      const character = draft.characters.find((entry) => entry.id === id);
      if (!character) throw new Error("Unknown character.");
      draft.bag.omen += character.wounds;
      draft.characters = draft.characters.filter((entry) => entry.id !== id);
      if (draft.selectedCharacterId === id) draft.selectedCharacterId = draft.characters[0].id;
      if (draft.currentCheck && draft.currentCheck.characterId === id) draft.currentCheck = null;
    }, `${name} removed; their Wound Omens returned to the bag`);
  }

  function formatDraw(check) {
    if (!check) return "";
    return check.dice.map((die) => `${die.type}${die.source === "forced" ? " (Forced)" : " (Bag)"}`).join(" / ");
  }

  function formatRoll(roll) {
    if (!roll) return "";
    return `${roll.dice.map((die) => `${die.source === "forced" ? "Forced " : ""}${die.type} ${die.result}`).join(" / ")}; total ${roll.total}; ${roll.result}`;
  }

  const api = {
    setSetting,
    addCharacter,
    selectCharacter,
    renameCharacter,
    removeCharacter,
    hasUnresolvedCheck,
    normalizeState,
    STORAGE_KEY,
    SCHEMA_VERSION,
    defaultState,
    getState,
    resetGame,
    importState,
    validateState,
    clearLog,
    setAct,
    addOmenToBag,
    removeOmenFromBag,
    applyManual,
    drawCheck,
    rollCheck,
    rerollCheck,
    chooseRoll,
    finishCheck,
    cancelCheck,
    takeWound,
    cheatDeath,
    valiantSacrifice,
    reviveCharacter,
    recordStrain,
    getMode: () => mode,
    enterMultiplayer(snapshot, dispatcher) {
      state = normalizeState(snapshot);
      transport = dispatcher;
      mode = "multiplayer";
      return getState();
    },
    receiveSharedState(snapshot) {
      if (mode !== "multiplayer") throw new Error("Not in multiplayer mode.");
      state = normalizeState(snapshot);
      return getState();
    },
    leaveMultiplayer() {
      transport = null;
      mode = "solo";
      state = loadState();
      return getState();
    },
  };
  // Keep synchronous solo APIs; multiplayer dispatch never writes the solo save.
  const mutations = ["setSetting", "addCharacter", "selectCharacter", "renameCharacter", "removeCharacter", "resetGame", "importState", "clearLog", "setAct", "addOmenToBag", "removeOmenFromBag", "applyManual", "drawCheck", "rollCheck", "rerollCheck", "chooseRoll", "finishCheck", "cancelCheck", "takeWound", "cheatDeath", "valiantSacrifice", "reviveCharacter", "recordStrain"];
  for (const action of mutations) {
    const local = api[action];
    api[action] = (...args) => mode === "multiplayer" ? transport(action, args, getState()) : local(...args);
  }
  return api;
});
