/* Standalone sequence comparison.
 *
 * Browser: load sequence_diff.css and this script, then call
 *   SequenceDiff.render(container, compareResponse, {onSelect(detail) { ... }})
 * CommonJS: require("./sequence_diff.js").render(...)
 *
 * render replaces the container's contents and returns {select, destroy}.
 * select(position) selects a 1-based position without calling onSelect;
 * select(null) clears selection. Clicks call onSelect with
 * {position, old, new, reference, changed}. reference is null if unavailable.
 * destroy clears the container if this instance is still its owner.
 *
 * The endpoint sequences must be equal-length strings. This component renders
 * aligned substitutions, not insertions or deletions. Changes must exactly
 * describe the differences. Reference is taken only from endpoint source data.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SequenceDiff = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const owners = new WeakMap();
  const lineLength = 50;

  function render(container, response, options = {}) {
    if (!container || !container.ownerDocument) throw new TypeError("A DOM container is required");
    const from = response && response.from && response.from.sequence;
    const to = response && response.to && response.to.sequence;
    const oldSeq = from && from.sequence;
    const newSeq = to && to.sequence;
    const changes = response && response.sequence && response.sequence.changes;
    if (typeof oldSeq !== "string" || typeof newSeq !== "string" ||
        oldSeq.length !== newSeq.length || !Array.isArray(changes)) {
      throw new TypeError("Expected equal-length endpoint sequences and a changes array");
    }
    const refs = [from, to].map(state => state.reference && state.reference.sequence)
      .filter(ref => ref !== undefined && ref !== null);
    if (refs.some(ref => typeof ref !== "string" || ref.length !== oldSeq.length) ||
        refs.some(ref => ref !== refs[0])) {
      throw new TypeError("Reference sequences must agree and match the endpoint length");
    }
    const reference = refs.length ? refs[0] : null;
    const byPosition = new Map();
    for (const change of changes) {
      const p = change && change.position;
      if (!Number.isInteger(p) || p < 1 || p > oldSeq.length || byPosition.has(p) ||
          change.old !== oldSeq[p - 1] || change.new !== newSeq[p - 1] ||
          change.old === change.new) {
        throw new TypeError("Invalid sequence change");
      }
      byPosition.set(p, change);
    }
    for (let i = 0; i < oldSeq.length; i++) {
      if ((oldSeq[i] !== newSeq[i]) !== byPosition.has(i + 1)) {
        throw new TypeError("Changes do not match endpoint sequences");
      }
    }
    if (options.onSelect !== undefined && typeof options.onSelect !== "function") {
      throw new TypeError("onSelect must be a function");
    }

    const doc = container.ownerDocument;
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const view = el("section", "sequence-diff");
    view.setAttribute("aria-label", "Sequence comparison");
    const label = endpoint => endpoint.kind === "reference" || endpoint.commit === "reference"
      ? "Reference baseline" : String(endpoint.commit || "Unknown endpoint");
    view.append(el("p", "sequence-diff__endpoints",
      `From: ${label(response.from)} · To: ${label(response.to)}`));
    view.append(el("p", "sequence-diff__legend",
      "Positions are 1-based. Changed old residues are marked −; changed new residues are marked +. Select a residue to focus its position."));
    const controls = new Map();
    let selected = null;
    const detail = p => ({
      position: p, old: oldSeq[p - 1], new: newSeq[p - 1],
      reference: reference === null ? null : reference[p - 1],
      changed: byPosition.has(p)
    });
    function select(position) {
      if (owners.get(container) !== api) return;
      if (position !== null && (!Number.isInteger(position) || position < 1 || position > oldSeq.length)) {
        throw new RangeError("Position must be null or a valid 1-based position");
      }
      if (selected !== null) for (const node of controls.get(selected) || []) node.setAttribute("aria-pressed", "false");
      selected = position;
      if (selected !== null) for (const node of controls.get(selected) || []) node.setAttribute("aria-pressed", "true");
    }
    function button(p, className, text, description) {
      const node = el("button", className, text);
      node.type = "button";
      node.setAttribute("aria-label", description);
      node.setAttribute("aria-pressed", "false");
      node.dataset.position = String(p);
      if (!controls.has(p)) controls.set(p, []);
      controls.get(p).push(node);
      node.addEventListener("click", () => {
        if (owners.get(container) !== api) return;
        select(p);
        if (options.onSelect) options.onSelect(detail(p));
      });
      return node;
    }

    const list = el("section", "sequence-diff__changes");
    list.append(el("h3", "", `Changed positions (${changes.length})`));
    if (!changes.length) list.append(el("p", "", "No sequence differences."));
    else {
      const items = el("ul", "sequence-diff__change-list");
      for (const p of [...byPosition.keys()].sort((a, b) => a - b)) {
        const d = detail(p);
        const ref = d.reference === null ? "" : `; reference ${d.reference}`;
        const item = el("li");
        item.append(button(p, "sequence-diff__change", `${p}: ${d.old} → ${d.new}${ref}`,
          `Position ${p}: old ${d.old}, new ${d.new}${ref}`));
        items.append(item);
      }
      list.append(items);
    }
    view.append(list);

    const alignment = el("section", "sequence-diff__alignment");
    alignment.setAttribute("aria-label", "Aligned sequences");
    if (!oldSeq.length) alignment.append(el("p", "", "Empty sequences."));
    for (let start = 0; start < oldSeq.length; start += lineLength) {
      const end = Math.min(start + lineLength, oldSeq.length);
      const block = el("div", "sequence-diff__block");
      block.append(el("p", "sequence-diff__range", `Positions ${start + 1}–${end}`));
      const scroll = el("div", "sequence-diff__scroll");
      scroll.setAttribute("tabindex", "0");
      scroll.setAttribute("aria-label", `Aligned positions ${start + 1} to ${end}; scroll horizontally`);
      const rows = reference === null ? [["Old", oldSeq], ["New", newSeq]] :
        [["Reference", reference], ["Old", oldSeq], ["New", newSeq]];
      for (const [name, seq] of rows) {
        const row = el("div", "sequence-diff__row");
        row.append(el("span", "sequence-diff__row-label", name));
        const residues = el("div", "sequence-diff__residues");
        for (let i = start; i < end; i++) {
          const p = i + 1, changed = byPosition.has(p);
          const kind = changed && name !== "Reference" ? (name === "Old" ? "old" : "new") : "";
          const marker = kind === "old" ? "−" : kind === "new" ? "+" : "";
          residues.append(button(p, `sequence-diff__residue${kind ? " sequence-diff__residue--" + kind : ""}`,
            marker + seq[i], `${name} position ${p}: ${seq[i]}${kind ? ", changed " + kind : ""}`));
        }
        row.append(residues);
        scroll.append(row);
      }
      block.append(scroll);
      alignment.append(block);
    }
    view.append(alignment);
    const api = {
      select,
      destroy() {
        if (owners.get(container) === api) {
          owners.delete(container);
          container.replaceChildren();
        }
      }
    };
    owners.set(container, api);
    container.replaceChildren(view);
    return api;
  }
  return {render};
});
