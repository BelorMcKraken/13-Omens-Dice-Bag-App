(function (root, factory) {
  const R = typeof module === "object" && module.exports ? require("./rules.js") : root.ThirteenOmensRules;
  const api = factory(R, root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ThirteenOmensSheet = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function (R, root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ratings = value => Object.keys(R.ASPECTS).map(r => `<option ${r === value ? "selected" : ""}>${r}</option>`).join("");
  function markup(state, c, editable, assignment = "Unassigned") {
    if (!c) return '<p>Unassigned — waiting for the Host.</p>';
    const pending = root.ThirteenOmensState?.hasUnresolvedCheck(state);
    const textField = (key, label, multiline = false) => `<label>${label}${multiline ? `<textarea data-field="${key}" ${editable ? "" : "readonly"} maxlength="4000">${esc(c[key])}</textarea>` : `<input data-field="${key}" value="${esc(c[key])}" ${editable ? "" : "readonly"} maxlength="120">`}</label>`;
    return `<article class="character-sheet ${c.active ? "" : "fallen"}">
      <h3>${esc(c.name)} ${c.active ? "" : "— FALLEN"}</h3><p class="muted">Assigned Player: ${esc(assignment)}</p>
      <div class="sheet-identity">${textField("name", "Name")}${textField("archetype", "Archetype")}</div>${textField("description", "Description", true)}
      ${["core", "story"].map(type => `<h4>${type === "core" ? "Core" : "Story"} Aspects</h4><div class="aspect-rows">${c.aspects.filter(a => a.type === type).map(a => `<div class="aspect-row" data-aspect="${a.id}">
        ${type === "story" && editable ? `<input aria-label="${a.id} name" data-aspect-name value="${esc(a.name)}" maxlength="120">` : `<strong>${esc(a.name)}</strong>`}
        <select aria-label="${esc(a.name)} Rating" data-rating ${editable ? "" : "disabled"}>${ratings(a.rating)}</select><span>TN ${R.ASPECTS[a.rating]}</span>
        <span class="strain-badge ${a.strained ? "is-strained" : ""}">${a.strained ? "STRAINED" : "Clear"}</span>
        ${editable ? `<button type="button" data-strain="${a.id}" ${pending ? "disabled" : ""}>${a.strained ? "Remove" : "Add"} Strain</button>` : ""}
        ${editable && state.storyCharacterCount === 3 && a.strained && c.active && !c.strainReliefUsed ? `<button type="button" data-relief="${a.id}" ${pending ? "disabled" : ""}>Use Small-Group Strain Relief</button>` : ""}
      </div>`).join("")}</div>`).join("")}
      <p class="sheet-wounds">Wounds: ${"●".repeat(c.wounds)}${"○".repeat(Math.max(0, R.getDeathThreshold(state, c) - c.wounds))} · ${c.wounds} / ${R.getDeathThreshold(state, c)}</p>
      <p>Cheat Death: ${R.Perks.hasPerk(c,"the-truth") ? "Forbidden — The Truth" : c.cheatDeathUsed ? "Used" : "Available"} · Strain Relief: ${state.storyCharacterCount === 3 ? c.strainReliefUsed ? "Used" : "Available once this story" : "Only in three-character stories"}</p>
      ${Object.entries(c.strain).filter(([key, value]) => value && !R.findAspect(c, key)).length ? `<p>Legacy Strain: ${Object.entries(c.strain).filter(([key, value]) => value && !R.findAspect(c, key)).map(([key]) => esc(key)).join(", ")}</p>` : ""}
      ${["perks", "gear"].map(key => `<h4>${key === "perks" ? "Perks" : "Gear"}</h4><div data-entries="${key}">${c[key].map(e => entryMarkup(e, editable, key, state, c)).join("") || '<p class="muted">None</p>'}</div>${editable ? `<button type="button" data-add="${key}">Add ${key === "gear" ? "Gear" : "Perk"}</button>` : ""}`).join("")}
      ${textField("notes", "Notes (visible to Players)", true)}
      ${editable ? '<button type="button" data-save class="primary">Save Character Sheet</button><p class="muted">Save commits ratings, identity, Gear, Perks and Notes. Strain buttons commit immediately.</p>' : ""}
      <p data-sheet-error role="status"></p></article>`;
  }
  function entryMarkup(e, editable, key, state, c) {
    const P=R.Perks, rule=P.PERK_RULES[e.ruleKey];
    const mechanics=key==='perks' ? (editable ? '<label>Automation<select data-rule><option value="">Custom / Manual</option>'+Object.entries(P.PERK_RULES).map(([key,r])=>'<option value="'+key+'" '+(e.ruleKey===key?'selected':'')+'>'+r.name+'</option>').join('')+'</select></label>' : '')+'<p>'+esc(c?P.usageStatus(c,e,state):'MANUAL PERK')+'</p>'+(editable&&c?.perks.some(p=>p.id===e.id)?'<button type="button" data-disable="'+esc(e.id)+'" '+(root.ThirteenOmensState.hasUnresolvedCheck(state)?'disabled':'')+'>'+(e.disabled?'Restore':'Disable')+' Perk</button>':'') : '';
    return `<div class="sheet-entry" data-entry="${esc(e.id)}"><label>Name<input data-entry-name value="${esc(e.name)}" maxlength="120" ${editable ? "" : "readonly"}></label><label>Notes<textarea data-entry-notes maxlength="4000" ${editable ? "" : "readonly"}>${esc(e.notes)}</textarea></label>${mechanics}${editable ? '<button type="button" data-remove>Remove</button>' : ""}</div>`;
  }
  function render(container, state, c, editable, assignment) {
    if (!container) return;
    container.innerHTML = markup(state, c, editable, assignment);
    if (!editable || !c) return;
    const store = root.ThirteenOmensState;
    async function act(fn) { try { await fn(); root.ThirteenOmensApp.render(); } catch (e) { container.querySelector('[data-sheet-error]').textContent = e.message; } }
    container.querySelectorAll('[data-strain]').forEach(b => b.addEventListener('click', () => act(() => store.setStrain(c.id, b.dataset.strain, !R.getAspect(c, b.dataset.strain).strained))));
    container.querySelectorAll('[data-relief]').forEach(b => b.addEventListener('click', () => act(() => store.useStrainRelief(c.id, b.dataset.relief))));
    const bindRemove = () => container.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => b.closest('[data-entry]').remove());
    bindRemove();
    container.querySelectorAll("[data-disable]").forEach(b=>b.onclick=()=>act(()=>store.setPerkDisabled(c.id,b.dataset.disable,!c.perks.find(p=>p.id===b.dataset.disable).disabled)));
    container.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      container.querySelector(`[data-entries="${b.dataset.add}"]`).insertAdjacentHTML('beforeend', entryMarkup({ id: root.crypto?.randomUUID ? root.crypto.randomUUID() : `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: "", notes: "" }, true, b.dataset.add, state, c)); bindRemove();
    }));
    container.querySelector('[data-save]').addEventListener('click', () => act(() => {
      const patch = {};
      container.querySelectorAll('[data-field]').forEach(e => patch[e.dataset.field] = e.value);
      patch.aspects = c.aspects.map(a => { const row = container.querySelector(`[data-aspect="${a.id}"]`); return { ...a, name: row.querySelector('[data-aspect-name]')?.value.trim() || a.name, rating: row.querySelector('[data-rating]').value }; });
      for (const key of ['gear', 'perks']) patch[key] = [...container.querySelectorAll(`[data-entries="${key}"] [data-entry]`)].map(e => ({ id: e.dataset.entry, name: e.querySelector('[data-entry-name]').value.trim() || R.Perks.PERK_RULES[e.querySelector("[data-rule]")?.value]?.name || "Custom", notes: e.querySelector('[data-entry-notes]').value, ...(key === "perks" ? {ruleKey:e.querySelector("[data-rule]")?.value || null,disabled:c.perks.find(p=>p.id===e.dataset.entry)?.disabled || false}: {}) }));
      return store.editCharacter(c.id, patch);
    }));
  }
  function configure(state) {
    const select = root.document.getElementById('storedAspect');
    if (!select) return;
    const c = R.getCharacter(state), previous = select.value;
    select.innerHTML = c.aspects.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
    select.value = c.aspects.some(a => a.id === previous) ? previous : 'courage';
    select.onchange = () => root.ThirteenOmensApp.updateCheckMath();
    const count = root.document.getElementById('storyCharacterCount'); count.value = state.storyCharacterCount;
    root.document.getElementById('storyRuleSummary').textContent = `Fixed story size: ${state.storyCharacterCount} · ${state.perishedCharacterIds.length} characters perished · Current death threshold: ${R.getDeathThreshold(state, c)}`;
    const button = root.document.getElementById('saveStoryCount'); button.disabled = root.ThirteenOmensState.hasUnresolvedCheck(state);
    button.onclick = async () => { try { await root.ThirteenOmensState.setStoryCharacterCount(Number(count.value)); root.ThirteenOmensApp.render(); } catch(e) { root.document.getElementById('storyRuleSummary').textContent = e.message; } };
  }
  function options(state, manual, baseTn) {
    const a = R.getAspect(R.getCharacter(state), root.document.getElementById('storedAspect').value) || R.getCharacter(state).aspects[0];
    root.document.getElementById('storedRating').textContent = manual ? "Host manual TN" : `${a.rating} · Base TN ${R.ASPECTS[a.rating]}`;
    root.document.getElementById('storedAspect').disabled = manual;
    return manual ? { manualTn: true, aspect: "Manual Check", baseTn: Number(baseTn) } : { manualTn: false, aspectId: a.id, aspect: a.name, rating: a.rating, baseTn: R.ASPECTS[a.rating] };
  }
  return { markup, render, configure, options };
});
