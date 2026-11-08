"use strict";

// Load prediction_compare.css and 3Dmol before mounting. getState supplies
// {branch, head, from, to, data, active}, where data is the matching comparison
// result and active defaults to true. Call stateChanged after any state or
// visibility change. Set automatic: true only with explicit user configuration.
(() => {
  const residues = {
    ALA: "A", CYS: "C", ASP: "D", GLU: "E", PHE: "F", GLY: "G", HIS: "H",
    ILE: "I", LYS: "K", LEU: "L", MET: "M", ASN: "N", PRO: "P", GLN: "Q",
    ARG: "R", SER: "S", THR: "T", VAL: "V", TRP: "W", TYR: "Y"
  };

  // Require the displayed residue numbers to correspond to the full sequence,
  // rather than assuming an arbitrary PDB's numbering is a sequence mapping.
  function pdbChain(pdb, sequence) {
    if (typeof pdb !== "string") throw new Error("Invalid predicted structure.");
    let chain = null, models = 0;
    const seen = new Map(), ca = new Set();
    for (const line of pdb.split(/\r?\n/)) {
      const record = line.slice(0, 6).trim();
      if (record === "MODEL" && (++models > 1 || seen.size)) throw new Error("Invalid predicted structure.");
      if (record === "HETATM") throw new Error("Invalid predicted structure.");
      if (record !== "ATOM") continue;
      const c = line[21], field = line.slice(22, 26).trim(), n = Number(field);
      const aa = residues[line.slice(17, 20)], atom = line.slice(12, 16).trim();
      if (line.length < 54 || line[16] !== " " || line[26] !== " " ||
          !/^\d+$/.test(field) || n < 1 || n > sequence.length ||
          !aa || aa !== sequence[n - 1] || !atom ||
          [30, 38, 46].some(i => !line.slice(i, i + 8).trim() || !Number.isFinite(Number(line.slice(i, i + 8))))) {
        throw new Error("Predicted structure does not match the full sequence numbering.");
      }
      if (chain === null) chain = c;
      if (chain !== c || (seen.has(n) && seen.get(n) !== aa))
        throw new Error("Predicted structure has inconsistent chains.");
      seen.set(n, aa);
      if (atom === "CA") ca.add(n);
    }
    if (seen.size !== sequence.length || ca.size !== sequence.length)
      throw new Error("Predicted structure does not cover the full sequence.");
    return chain;
  }

  function mount(container, options) {
    if (!container || !container.ownerDocument || !options || typeof options.getState !== "function")
      throw new TypeError("A container and getState are required.");
    const provider = options.provider || "ESM Metagenomic Atlas";
    if (!["ESM Metagenomic Atlas", "Modal"].includes(provider)) throw new Error("Unsupported prediction provider.");
    const doc = container.ownerDocument;
    const request = options.fetch || ((...args) => window.fetch(...args));
    const root = doc.createElement("section");
    root.className = "prediction-compare";
    function el(tag, text, parent = root, className = "") {
      const node = doc.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      parent.append(node);
      return node;
    }
    el("h2", "Compare independently predicted structures");
    el("p", `${options.automatic === true ? "Automatic mode sends" : "Selecting the button sends"} both full selected protein sequences to ${provider} for ESMFold prediction.${provider === "Modal" ? " Modal GPU usage can incur charges." : ""} Provider retention is not verified. Do not submit sensitive or patient data. Leaving or changing selection does not cancel requests already sent.`, root, "prediction-compare__privacy");
    el("p", "These are independently generated single-chain models in independent coordinate frames, not aligned structures. Prediction confidence is not shown. Apparent structural differences around mutations are not reliable evidence of a mutation effect; no functional or clinical inference is supported.");
    const identity = el("p", "");
    const sequences = el("div", undefined, root, "prediction-compare__grid");
    const seqNodes = ["From", "To"].map(label => {
      const box = el("section", undefined, sequences);
      el("h3", label + " sequence", box);
      const node = el("pre", "", box, "prediction-compare__sequence");
      node.setAttribute("aria-label", label + " full sequence to be sent");
      return node;
    });
    const predict = el("button", "Send both sequences and predict with ESMFold");
    predict.type = "button";
    let paused = false;
    if (options.automatic === true) {
      const pause = el("button", "Pause automatic prediction");
      pause.type = "button";
      pause.setAttribute("aria-pressed", "false");
      pause.addEventListener("click", () => {
        paused = !paused;
        pause.textContent = paused ? "Resume automatic prediction" : "Pause automatic prediction";
        pause.setAttribute("aria-pressed", String(paused));
        if (paused) cancelAutomatic();
        else stateChanged();
      });
    }
    const status = el("p", "");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    el("p", "Changed positions are red in From and green in To. Positions use 1-based full-sequence numbering. Drag each model independently or use its view controls.");
    const grid = el("div", undefined, root, "prediction-compare__grid");
    const panels = ["From", "To"].map((label, index) => {
      const box = el("section", undefined, grid, "prediction-compare__panel");
      const heading = el("h3", label, box);
      const message = el("p", "", box);
      const view = el("div", undefined, box, "prediction-compare__view");
      view.setAttribute("aria-label", label + " predicted protein structure");
      const controls = el("div", undefined, box, "prediction-compare__controls");
      const buttons = [];
      for (const [name, action] of [
        ["Rotate", v => v.rotate(30, "y")], ["Zoom in", v => v.zoom(1.2)],
        ["Zoom out", v => v.zoom(1 / 1.2)], ["Reset view", v => v.zoomTo()]
      ]) {
        const button = el("button", name, controls);
        button.type = "button";
        button.setAttribute("aria-label", `${name} ${label} structure`);
        button.addEventListener("click", () => {
          if (!current() || !viewers[index]) return;
          try { action(viewers[index]); viewers[index].render(); }
          catch (_) {
            clearPanel(index);
            message.textContent = "Viewer unavailable. Check WebGL and 3Dmol.";
            updateFinished();
          }
        });
        buttons.push(button);
      }
      return {heading, message, view, buttons};
    });
    container.replaceChildren(root);
    let selected = null, disclosed = null, generation = 0, controller = null;
    let viewers = [null, null], results = [null, null], busy = false, destroyed = false, timer = null;
    const attempted = new Set();
    function read() {
      const s = options.getState() || {};
      return {branch: s.branch, head: s.head, from: s.from, to: s.to, data: s.data, active: s.active !== false};
    }
    function same(a, b) {
      return !!a && !!b && ["branch", "head", "from", "to"].every(k => a[k] === b[k]);
    }
    function sequencesFor(s) {
      const d = s.data;
      if (!["branch", "head", "from", "to"].every(k => typeof s[k] === "string" && s[k]) ||
          !d || !d.from || !d.to || d.from.commit !== s.from || d.to.commit !== s.to)
        return null;
      const a = d.from.sequence && d.from.sequence.sequence;
      const b = d.to.sequence && d.to.sequence.sequence;
      if (typeof a !== "string" || typeof b !== "string" || !/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(a) ||
          !/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(b) || a.length !== b.length) return null;
      return [a, b];
    }
    function sameSequences(a, b) { return !!a && !!b && a[0] === b[0] && a[1] === b[1]; }
    function current() {
      if (destroyed || !same(selected, read())) return false;
      return sameSequences(disclosed, sequencesFor(read()));
    }
    function clearPanel(i) {
      if (viewers[i]) { try { viewers[i].clear(); } catch (_) {} }
      viewers[i] = null;
      panels[i].view.replaceChildren();
      panels[i].buttons.forEach(b => { b.disabled = true; });
    }
    function reset() {
      generation++;
      cancelAutomatic();
      if (controller) controller.abort();
      controller = null;
      busy = false;
      results = [null, null];
      predict.textContent = "Send both sequences and predict with ESMFold";
      panels.forEach((p, i) => { clearPanel(i); p.message.textContent = ""; });
    }
    function stateChanged() {
      if (destroyed) return;
      const next = read(), sequences = sequencesFor(next);
      if (same(selected, next) && sameSequences(disclosed, sequences)) {
        maybeAutomatic(next);
        return;
      }
      if (!same(selected, next)) {
        reset();
        selected = next;
        disclosed = null;
      }
      // A comparison may arrive after the identities. If previously disclosed
      // data changes under the same identity, fail closed instead of reusing it.
      if (disclosed && !sameSequences(disclosed, sequences)) {
        reset();
        disclosed = null;
      }
      if (!disclosed && sequences) disclosed = sequences;
      identity.textContent = `Branch: ${next.branch || "none"} · Head: ${next.head || "none"}`;
      panels[0].heading.textContent = `From: ${next.from || "none"}`;
      panels[1].heading.textContent = `To: ${next.to || "none"}`;
      seqNodes.forEach((node, i) => { node.textContent = disclosed ? disclosed[i] : ""; });
      const identical = disclosed && disclosed[0] === disclosed[1];
      predict.disabled = busy || !disclosed || identical;
      if (!disclosed) status.textContent = "Matching comparison sequences are unavailable. Select valid endpoints and load the comparison.";
      else if (identical) status.textContent = "The selected sequences are identical; there is no sequence difference to compare.";
      else if (!busy && !viewers.some(Boolean)) status.textContent = "Review both full sequences and the privacy notice before predicting.";
      maybeAutomatic(next);
    }
    function stateKey(snapshot) {
      // An identity is deliberately attempted at most once automatically even
      // if its reported sequences change. Their contents are checked separately
      // by current(); changed data can still be sent by explicit manual action.
      return JSON.stringify([snapshot.branch, snapshot.head, snapshot.from, snapshot.to]);
    }
    function cancelAutomatic() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
    function maybeAutomatic(next) {
      if (options.automatic !== true || paused || !next.active || !disclosed ||
          disclosed[0] === disclosed[1] || busy || attempted.has(stateKey(next))) {
        cancelAutomatic();
        return;
      }
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const now = read();
        if (!destroyed && !paused && now.active && !busy && current() &&
            !attempted.has(stateKey(now))) startPrediction();
      }, 600);
    }
    async function predictOne(snapshot, seq, index, signal) {
      const commit = index === 0 ? snapshot.from : snapshot.to;
      const response = await request("/api/structure/predict", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({branch: snapshot.branch, expected_head: snapshot.head, commit, consent: true}), signal
      });
      if (response.status === 504)
        throw new Error("Prediction request timed out. The remote request may still be running; retrying may incur additional charges.");
      let data;
      try { data = await response.json(); } catch (_) { throw new Error("Invalid response."); }
      if (!response.ok) throw new Error(
        typeof data?.error === "string" && data.error.length <= 200 ? data.error : "Prediction unavailable.");
      if (!data || data.head !== snapshot.head || data.commit !== commit || data.sequence !== seq ||
          data.provider !== provider || data.model !== "ESMFold")
        throw new Error("Prediction identity or sequence does not match the selection.");
      return {data, chain: pdbChain(data.pdb, seq)};
    }
    function show(index, result, changes) {
      const panel = panels[index];
      if (!window.$3Dmol || typeof window.$3Dmol.createViewer !== "function") throw new Error("3Dmol or WebGL unavailable.");
      const viewer = window.$3Dmol.createViewer(panel.view, {backgroundColor: "#0c131f"});
      if (!viewer) throw new Error("3Dmol or WebGL unavailable.");
      viewers[index] = viewer;
      viewer.addModel(result.data.pdb, "pdb");
      viewer.setStyle({}, {cartoon: {color: "#aab8c8"}});
      if (changes.length) viewer.setStyle({chain: result.chain, resi: changes}, {
        cartoon: {color: index === 0 ? "red" : "green"},
        stick: {color: index === 0 ? "red" : "green"}
      });
      viewer.zoomTo();
      viewer.render();
      panel.buttons.forEach(b => { b.disabled = false; });
      panel.message.textContent = `${provider} · ESMFold · independently predicted`;
    }
    function updateFinished() {
      if (busy) return;
      const missing = viewers.map((viewer, i) => viewer ? null : i).filter(i => i !== null);
      predict.disabled = missing.length === 0;
      if (!missing.length) {
        predict.textContent = "Predictions loaded";
        status.textContent = "Both predictions loaded.";
      } else {
        const labels = missing.map(i => i === 0 ? "From" : "To").join(" and ");
        predict.textContent = `Retry ${labels}`;
        status.textContent = `${labels} unavailable. Check the message below and retry when ready; a new prediction request may incur charges.`;
      }
    }
    async function startPrediction() {
      if (destroyed || busy || !disclosed || disclosed[0] === disclosed[1]) return;
      if (!current()) { stateChanged(); return; }
      cancelAutomatic();
      const key = stateKey(selected);
      attempted.delete(key);
      attempted.add(key);
      if (attempted.size > 100) attempted.delete(attempted.values().next().value);
      const id = generation, snapshot = selected, seq = disclosed.slice();
      busy = true;
      predict.disabled = true;
      status.textContent = "Waiting for prediction…";
      controller = new AbortController();
      const changes = [];
      for (let i = 0; i < seq[0].length; i++) if (seq[0][i] !== seq[1][i]) changes.push(i + 1);
      const jobs = seq.map(async (sequence, index) => {
        if (viewers[index]) return;
        panels[index].message.textContent = results[index] ? "Loading viewer…" : "Waiting for prediction…";
        try {
          const result = results[index] || await predictOne(snapshot, sequence, index, controller.signal);
          if (id !== generation || !current()) return;
          results[index] = result;
          try { show(index, result, changes); }
          catch (_) { clearPanel(index); panels[index].message.textContent = "Viewer unavailable. Check WebGL and 3Dmol."; }
        } catch (error) {
          if (id === generation && current()) panels[index].message.textContent = `Prediction failed: ${error.message || "Request failed. Check your connection."}`;
        }
      });
      await Promise.all(jobs);
      if (id !== generation || !current()) return;
      controller = null;
      busy = false;
      updateFinished();
    }
    predict.addEventListener("click", startPrediction);
    stateChanged();
    return {
      stateChanged,
      resize() {
        if (destroyed) return;
        if (!current()) { stateChanged(); return; }
        viewers.forEach((viewer, i) => {
          if (!viewer) return;
          try { viewer.resize(); viewer.render(); }
          catch (_) {
            clearPanel(i);
            panels[i].message.textContent = "Viewer unavailable. Check WebGL and 3Dmol.";
            updateFinished();
          }
        });
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        reset();
        root.remove();
      }
    };
  }
  window.PredictionCompare = {mount};
})();
