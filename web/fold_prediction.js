"use strict";

// Load vendor/3Dmol-min.js and fold_prediction.css before mounting this component.
(() => {
  function mount(container, options) {
    if (!options || typeof options.getState !== "function") throw new Error("getState is required");
    const provider = options.provider || "ESM Metagenomic Atlas";
    if (!["ESM Metagenomic Atlas", "Modal"].includes(provider)) throw new Error("Unsupported prediction provider");
    const automatic = options.automatic === true;
    if (automatic && provider !== "Modal") throw new Error("Automatic prediction requires Modal");
    const doc = container.ownerDocument;
    const fetchRequest = options.fetch || window.fetch.bind(window);
    const root = doc.createElement("section");
    root.className = "fold-prediction";
    function element(tag, text, parent = root, className = "") {
      const node = doc.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      parent.append(node);
      return node;
    }
    element("h2", "Remote ESMFold prediction");
    const identity = element("p", "");
    element("p", automatic
      ? "Automatic prediction is enabled. Each valid saved sequence selected will be sent to the configured Modal provider automatically and can incur charges. Never submit patient or sensitive data. Provider retention is not verified. Remote requests cannot be cancelled after they are sent, even if you leave or change selection."
      : `The exact saved protein sequence below will be sent to ${provider} when you select Predict.${provider === "Modal" ? " Modal GPU usage can incur charges." : ""} Provider retention is not verified. Never submit patient or sensitive data. Leaving or changing selection does not cancel a request already sent.`, root, "fold-privacy");
    const sequence = element("pre", "", root, "fold-sequence");
    sequence.setAttribute("aria-label", "Exact saved protein sequence to be sent");
    const predict = element("button", "Predict with ESMFold");
    predict.type = "button";
    predict.disabled = true;
    let paused = false;
    if (automatic) {
      const pause = element("button", "Pause automatic prediction");
      pause.type = "button";
      pause.setAttribute("aria-pressed", "false");
      pause.addEventListener("click", () => {
        paused = !paused;
        pause.textContent = paused ? "Resume automatic prediction" : "Pause automatic prediction";
        pause.setAttribute("aria-pressed", String(paused));
        if (!paused) maybeAutoPredict();
      });
    }
    const status = element("p", "Select a saved branch and commit.");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    element("p", "This is an unvalidated single-chain monomer prediction, not a deposited structure or a hemoglobin tetramer. Prediction confidence is not shown. It supports no functional or clinical inference.");
    const result = element("section");
    result.hidden = true;
    const resultIdentity = element("p", "", result);
    const view = element("div", undefined, result, "fold-view");
    view.setAttribute("aria-label", "Predicted protein structure");
    const controls = element("div", undefined, result, "fold-controls");
    function button(label, action) {
      const node = element("button", label, controls);
      node.type = "button";
      node.addEventListener("click", () => {
        if (!viewer || destroyed) return;
        try { action(); viewer.render(); } catch (_) { viewerFailure(); }
      });
    }
    button("Rotate structure", () => viewer.rotate(30, "y"));
    button("Zoom in", () => viewer.zoom(1.2));
    button("Zoom out", () => viewer.zoom(1 / 1.2));
    button("Reset view", () => viewer.zoomTo());
    container.replaceChildren(root);

    let selected = null, savedSequence = null, generation = 0, controller = null;
    let viewer = null, destroyed = false, busy = false;
    const attempted = new Set(), inFlight = new Set();
    const keyFor = snapshot => JSON.stringify([snapshot.branch, snapshot.head]);
    function readState() {
      const state = options.getState() || {};
      return {branch: state.branch, head: state.head, active: state.active !== false};
    }
    function equal(a, b) {
      return !!a && !!b && a.branch === b.branch && a.head === b.head;
    }
    function clearViewer() {
      if (viewer) {
        try { viewer.clear(); } catch (_) { /* Viewer may already have lost its context. */ }
      }
      viewer = null;
      view.replaceChildren();
      result.hidden = true;
      resultIdentity.textContent = "";
    }
    function viewerFailure() {
      clearViewer();
      status.textContent = "Could not display the prediction. Check WebGL support and the bundled 3Dmol library, then try again.";
    }
    function current(id, snapshot) {
      return !destroyed && id === generation && equal(selected, snapshot) && equal(readState(), snapshot);
    }
    async function jsonResponse(response) {
      let data;
      try { data = await response.json(); } catch (_) { throw new Error("Invalid JSON response."); }
      if (response.status === 504)
        throw new Error("Prediction request timed out. The remote request may still be running; retrying may incur additional charges.");
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Request failed.");
      return data;
    }
    async function load(snapshot, id, signal) {
      try {
        const response = await fetchRequest(`/api/sequence?branch=${encodeURIComponent(snapshot.branch)}`, {signal});
        const data = await jsonResponse(response);
        if (!current(id, snapshot)) return;
        if (data.head !== snapshot.head || typeof data.sequence !== "string" || !/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(data.sequence))
          throw new Error("Saved sequence or commit does not match the selected state. Refresh the branch.");
        savedSequence = data.sequence;
        sequence.textContent = savedSequence;
        const key = keyFor(snapshot);
        predict.disabled = inFlight.has(key);
        status.textContent = inFlight.has(key)
          ? "A prediction for this saved sequence is still in progress."
          : "Review the sequence and privacy notice before predicting.";
        controller = null;
        maybeAutoPredict();
      } catch (error) {
        if (!current(id, snapshot)) return;
        status.textContent = `Could not load saved sequence: ${error.message}`;
      } finally {
        if (current(id, snapshot)) controller = null;
      }
    }
    function stateChanged() {
      if (destroyed) return;
      const next = readState();
      if (equal(selected, next)) {
        maybeAutoPredict();
        return;
      }
      selected = next;
      generation++;
      if (controller) controller.abort();
      controller = null;
      busy = false;
      savedSequence = null;
      sequence.textContent = "";
      predict.disabled = true;
      clearViewer();
      const reference = next.head == null;
      identity.textContent = `Branch: ${next.branch || "none"} · ${reference ? "Reference sequence (no substitutions)" : `Full commit: ${next.head}`} · Model: ESMFold`;
      if (typeof next.branch !== "string" || !next.branch || (!reference && typeof next.head !== "string")) {
        status.textContent = "Select a saved branch and commit.";
        return;
      }
      status.textContent = "Loading saved sequence…";
      controller = new AbortController();
      load(next, generation, controller.signal);
    }
    function maybeAutoPredict() {
      if (!automatic || paused || !savedSequence || !readState().active || !equal(readState(), selected)) return;
      const key = keyFor(selected);
      if (!attempted.has(key) && !inFlight.has(key)) startPrediction();
    }
    async function startPrediction() {
      if (destroyed || busy || !savedSequence) return;
      if (!equal(readState(), selected)) { stateChanged(); return; }
      const snapshot = selected, disclosed = savedSequence, id = ++generation;
      const key = keyFor(snapshot);
      if (inFlight.has(key)) return;
      attempted.add(key);
      inFlight.add(key);
      busy = true;
      predict.disabled = true;
      clearViewer();
      status.textContent = "Predicting remotely…";
      try {
        const response = await fetchRequest("/api/structure/predict", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({branch: snapshot.branch, expected_head: snapshot.head, consent: true})
        });
        const data = await jsonResponse(response);
        if (!current(id, snapshot)) return;
        if (data.head !== snapshot.head || data.sequence !== disclosed ||
            data.provider !== provider || data.model !== "ESMFold" ||
            typeof data.pdb !== "string" || !/^ATOM  /m.test(data.pdb))
          throw new Error("Prediction response does not match the disclosed sequence, commit, or provider.");
        try {
          if (!window.$3Dmol) throw new Error("3Dmol unavailable");
          result.hidden = false;
          viewer = window.$3Dmol.createViewer(view, {backgroundColor: "#0c131f"});
          if (!viewer) throw new Error("WebGL unavailable");
          viewer.addModel(data.pdb, "pdb");
          viewer.setStyle({}, {cartoon: {color: "spectrum"}});
          viewer.zoomTo();
          viewer.render();
          resultIdentity.textContent = `Branch: ${snapshot.branch} · Full commit: ${snapshot.head} · ${provider} · ESMFold`;
          status.textContent = "Prediction loaded. Drag to rotate, or use the keyboard-accessible view controls.";
        } catch (_) { viewerFailure(); }
      } catch (error) {
        if (current(id, snapshot)) status.textContent = `Prediction failed: ${error.message}`;
      } finally {
        inFlight.delete(key);
        if (current(id, snapshot)) {
          busy = false;
          predict.disabled = false;
        } else if (!destroyed && equal(selected, snapshot) && equal(readState(), snapshot) && savedSequence && !busy) {
          predict.disabled = false;
          status.textContent = "The previous prediction finished after the selection changed. Select Predict to retry.";
        }
      }
    }
    predict.addEventListener("click", startPrediction);
    stateChanged();
    return {
      stateChanged,
      resize() {
        if (!viewer || destroyed) return;
        if (!equal(readState(), selected)) { stateChanged(); return; }
        try { viewer.resize(); viewer.render(); } catch (_) { viewerFailure(); }
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        generation++;
        if (controller) controller.abort();
        clearViewer();
        root.remove();
      }
    };
  }
  window.FoldPrediction = {mount};
})();
