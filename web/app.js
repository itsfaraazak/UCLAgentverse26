"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const aminoAcids = "ACDEFGHIKLMNPQRSTVWY";
  const drafts = new Map();
  let branch = "", sequence = null, notes = null, busy = false;
  let refreshAfterBusy = false;
  let loadVersion = 0, comparisonVersion = 0;
  let comparison = {status: "idle", from: "", to: "", data: null};
  let moleculeInit, moleculeQueue = Promise.resolve(), moleculeVersion = 0;
  let referenceFocus = null;
  let agentWorkspace, previewVersion = 0;
  let foldPrediction, predictionComparison;
  let availableBranches = [], mergePreview = null, mergeVersion = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  async function request(path, method = "GET", body) {
    const response = await fetch(path, {method, cache: "no-store",
      headers: {"Content-Type": "application/json"}, ...(body ? {body: JSON.stringify(body)} : {})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  function error(message) {
    $("error").textContent = message;
    $("error").hidden = !message;
  }
  function setBusy(value) {
    busy = value;
    $("branch-select").disabled = busy || !$("branch-select").value;
    $("branch-form").querySelector("button").disabled = busy || !sequence;
    $("rollback-form").querySelector("button").disabled = busy || !sequence;
    $("rollback-target").disabled = busy || !sequence;
    for (const id of ["residue-position", "replacement", "commit-message"]) $(id).disabled = busy || !sequence;
    $("substitution-form").querySelector("button").disabled = busy || !sequence;
    if (!busy && refreshAfterBusy) {
      refreshAfterBusy = false;
      refresh();
    }
  }
  function draft() {
    return ["residue-position", "replacement", "commit-message"].map(id => $(id).value);
  }
  function saveDraft() { if (branch) drafts.set(branch, draft()); }
  function restoreDraft() {
    const values = drafts.get(branch) || ["", "", ""];
    ["residue-position", "replacement", "commit-message"].forEach((id, i) => { $(id).value = values[i]; });
  }
  window.addEventListener("beforeunload", event => {
    if (draft().some(Boolean) || [...drafts.values()].some(values => values.some(Boolean))) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  function setView(workspace) {
    $("workspace").hidden = !workspace;
    $("history-view").hidden = workspace;
    for (const [id, active] of [["show-workspace", workspace], ["show-history", !workspace]]) {
      $(id).classList.toggle("active", active);
      if (active) $(id).setAttribute("aria-current", "page");
      else $(id).removeAttribute("aria-current");
    }
    foldPrediction?.stateChanged();
    predictionComparison?.stateChanged();
    if (workspace && window.hbbMolecule) window.hbbMolecule.ready.then(() => window.hbbMolecule.resize()).catch(() => {});
    if (workspace) foldPrediction?.resize();
    if (!workspace) {
      updateDiffMolecule();
      predictionComparison?.resize();
    }
  }
  $("show-workspace").addEventListener("click", () => setView(true));
  $("show-history").addEventListener("click", () => setView(false));

  const structureSelect = $("structure-select");
  $("reference-structure").addEventListener("toggle", () => {
    if ($("reference-structure").open && window.hbbMolecule)
      window.hbbMolecule.ready.then(() => window.hbbMolecule.resize()).catch(() => {});
  });
  if (window.hbbMolecule) window.hbbMolecule.ready.then(() => { structureSelect.disabled = false; }).catch(() => {});
  structureSelect.addEventListener("change", async () => {
    const previous = $("structure-badge").textContent.replace("PDB ", "");
    structureSelect.disabled = true;
    try {
      const id = structureSelect.value;
      await window.hbbMolecule.selectStructure(id);
      $("structure-badge").textContent = `PDB ${id}`;
      $("structure-source").href = `https://www.rcsb.org/structure/${id}`;
      $("structure-source").textContent = `View ${id} at RCSB PDB ↗`;
    } catch (err) {
      structureSelect.value = previous;
      error(`Structure switch failed: ${err.message}`);
    } finally { structureSelect.disabled = false; }
  });
  for (const amino of aminoAcids) $("replacement").append(element("option", "", amino));
  function renderSequence(data) {
    sequence = data;
    foldPrediction?.stateChanged();
    predictionComparison?.stateChanged();
    $("sequence").textContent = data.sequence;
    $("sequence-source").replaceChildren(document.createTextNode(`Reference: ${data.reference.accession} · `));
    const source = element("a", "", "UniProt source ↗");
    source.href = data.reference.source_url;
    $("sequence-source").append(source);
    const list = $("substitutions");
    list.replaceChildren(element("h3", "", "Committed substitutions"));
    if (!data.substitutions.length) list.append(element("p", "field-note", "No substitutions committed."));
    data.substitutions.forEach(change => {
      const row = element("div", "substitution-row");
      row.append(element("span", "", `${change.reference}${change.position}${change.alternate}`));
      const locate = element("button", "text-button", "Locate reference residue");
      locate.type = "button";
      locate.addEventListener("click", async () => {
        try {
          $("reference-structure").open = true;
          await window.hbbMolecule.ready;
          window.hbbMolecule.resize();
          const result = window.hbbMolecule.highlightResidue(change);
          $("substitution-status").textContent = `Reference site ${change.position} highlighted at deposited beta-chain residue ${result.pdbResidue}.`;
        } catch (err) { $("substitution-status").textContent = `Cannot locate reference residue: ${err.message}`; }
      });
      row.append(locate);
      list.append(row);
    });
    setBusy(busy);
  }
  function renderHistory(history) {
    const container = $("history");
    container.replaceChildren();
    if (!history.length) container.append(element("div", "empty", "Your commits will appear here."));
    const rollback = $("rollback-target"), previousTarget = rollback.value;
    const placeholder = element("option", "", "Select a commit");
    placeholder.value = "";
    rollback.replaceChildren(placeholder);
    for (const item of history) {
      const row = element("div", "commit-item"), copy = element("span", "commit-copy");
      copy.append(element("strong", "", item.message), element("small", "", `${item.commit.slice(0, 10)} · ${item.timestamp}`));
      row.append(element("span", "commit-marker", "●"), copy);
      container.append(row);
      const option = element("option", "", `${item.commit.slice(0, 10)} · ${item.message}`);
      option.value = item.commit;
      rollback.append(option);
    }
    rollback.value = history.some(item => item.commit === previousTarget) ? previousTarget : "";
    let removed = false;
    for (const id of ["compare-from", "compare-to"]) {
      const select = $(id), previous = select.value;
      const placeholder = element("option", "", "Select a commit or reference");
      placeholder.value = "";
      const reference = element("option", "", "Reference · P68871 baseline (not a Git commit)");
      reference.value = "reference";
      select.replaceChildren(placeholder, reference);
      for (const item of history) {
        const option = element("option", "", `${item.commit.slice(0, 10)} · ${item.message}`);
        option.value = item.commit;
        select.append(option);
      }
      const retained = previous === "reference" || history.some(item => item.commit === previous);
      select.value = retained ? previous : "";
      select.disabled = !history.length;
      if (previous && !retained) removed = true;
    }
    if (removed) compareCommits();
  }
  async function refresh() {
    const version = ++loadVersion, selected = branch;
    try {
      const [seq, history] = await Promise.all([
        request(`/api/sequence?branch=${encodeURIComponent(selected)}`),
        request(`/api/notes?branch=${encodeURIComponent(selected)}`)
      ]);
      if (version !== loadVersion || selected !== branch) return;
      if (seq.head !== history.head) throw new Error("Branch changed while loading. Refresh to retry.");
      notes = history;
      renderSequence(seq);
      renderHistory(history.history);
      $("substitution-status").textContent = "Positions and reference letters use the canonical sequence.";
      $("branch-status").textContent = `${branch} · ${seq.head ? seq.head.slice(0, 10) : "no commits"}`;
      error("");
    } catch (err) {
      if (version === loadVersion && selected === branch) {
        sequence = null;
        foldPrediction?.stateChanged();
        predictionComparison?.stateChanged();
        setBusy(busy);
        $("branch-status").textContent = `${branch} · data unavailable`;
        error(`Branch data unavailable: ${err.message}`);
      }
    }
  }
  function transitionBranch(next) {
    saveDraft();
    const changed = branch && branch !== next;
    branch = next;
    resetMerge();
    renderMergeSources();
    ++loadVersion;
    if (changed) agentWorkspace?.branchChanged?.();
    sequence = null;
    foldPrediction?.stateChanged();
    predictionComparison?.stateChanged();
    notes = null;
    $("sequence").textContent = "";
    $("sequence-source").replaceChildren();
    $("substitutions").replaceChildren();
    $("substitution-status").textContent = "Loading branch sequence…";
    $("branch-status").textContent = `${branch} · loading…`;
    restoreDraft();
    document.querySelectorAll(".current-branch").forEach(node => { node.textContent = branch; });
    $("compare-from").value = $("compare-to").value = "";
    compareCommits();
    renderHistory([]);
    setBusy(busy);
  }
  async function loadBranches(preferred) {
    const result = await request("/api/branches");
    if (!Array.isArray(result.branches)) throw new Error("Invalid branch list.");
    // The default branch exists conceptually before its first commit.
    const branches = result.branches.length ? result.branches : [{name: "main", head: null}];
    availableBranches = branches;
    const select = $("branch-select");
    select.replaceChildren();
    for (const item of branches) {
      const option = element("option", "", `${item.name} · ${item.head ? item.head.slice(0, 10) : "empty"}`);
      option.value = item.name;
      select.append(option);
    }
    const selected = branches.some(item => item.name === preferred) ? preferred :
      (branches.find(item => item.name === "main") || branches[0]).name;
    select.value = selected;
    transitionBranch(selected);
    await refresh();
  }
  $("branch-select").addEventListener("change", () => {
    transitionBranch($("branch-select").value);
    refresh();
  });
  $("branch-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !sequence) return;
    const name = $("branch-name").value.trim();
    if (!name) return;
    setBusy(true);
    try {
      await request("/api/branches", "POST", {name, from_branch: branch, expected_head: sequence.head});
      $("branch-name").value = "";
      await loadBranches(name);
    } catch (err) { error(`Could not create branch: ${err.message}`); }
    finally { setBusy(false); }
  });
  $("substitution-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!sequence || busy) return;
    const position = Number($("residue-position").value), alternate = $("replacement").value;
    const message = $("commit-message").value.trim(), reference = sequence.reference.sequence[position - 1];
    if (!reference || !aminoAcids.includes(alternate) || !message) {
      $("substitution-status").textContent = "Enter a valid position, amino acid and commit message.";
      return;
    }
    const substitutions = sequence.substitutions.filter(change => change.position !== position);
    if (alternate !== reference) substitutions.push({position, reference, alternate});
    substitutions.sort((a, b) => a.position - b.position);
    const selected = branch, expectedHead = sequence.head;
    ++loadVersion;
    setBusy(true);
    try {
      const data = await request("/api/sequence", "POST", {branch: selected, expected_head: expectedHead, substitutions, message});
      if (branch !== selected) return;
      resetMerge();
      renderSequence(data);
      drafts.delete(branch);
      ["residue-position", "replacement", "commit-message"].forEach(id => { $(id).value = ""; });
      $("substitution-status").textContent = "Sequence proposal committed.";
      if (window.hbbMolecule) window.hbbMolecule.ready.then(() => window.hbbMolecule.clearHighlight()).catch(() => {});
      await refresh();
    } catch (err) {
      $("substitution-status").textContent = `${err.message} Your form values remain here.`;
    } finally { setBusy(false); }
  });

  $("rollback-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !sequence) return;
    const target = $("rollback-target").value, message = $("rollback-message").value.trim();
    if (!target || !message) return;
    const selected = branch, expected_head = sequence.head;
    ++loadVersion;
    setBusy(true);
    try {
      const data = await request("/api/sequence/rollback", "POST", {branch: selected, expected_head, target, message});
      if (selected !== branch) return;
      resetMerge();
      renderSequence(data);
      $("rollback-message").value = "";
      await refresh();
    } catch (err) { error(`Restore failed: ${err.message}`); }
    finally { setBusy(false); }
  });

  function resetMerge() {
    ++mergeVersion;
    mergePreview = null;
    $("merge-commit").disabled = true;
    $("merge-details").replaceChildren();
    $("merge-status").textContent = "Select a branch to preview.";
  }
  function renderMergeSources() {
    const select = $("merge-source"), previous = select.value;
    const placeholder = element("option", "", "Select another branch");
    placeholder.value = "";
    select.replaceChildren(placeholder);
    for (const item of availableBranches.filter(item => item.name !== branch && item.head)) {
      const option = element("option", "", item.name);
      option.value = item.name;
      select.append(option);
    }
    select.value = availableBranches.some(item => item.name === previous && item.name !== branch) ? previous : "";
  }
  $("merge-source").addEventListener("change", resetMerge);
  $("merge-preview").addEventListener("click", async () => {
    if (busy || !branch || !$("merge-source").value) return;
    const target = branch, source = $("merge-source").value, version = ++mergeVersion;
    mergePreview = null;
    $("merge-commit").disabled = true;
    $("merge-details").replaceChildren();
    $("merge-status").textContent = "Comparing branch changes…";
    try {
      const query = `target_branch=${encodeURIComponent(target)}&source_branch=${encodeURIComponent(source)}`;
      const data = await request(`/api/sequence/merge/preview?${query}`);
      if (version !== mergeVersion || target !== branch || source !== $("merge-source").value) return;
      if (!Array.isArray(data.conflicts) || !Array.isArray(data.merged_substitutions) ||
          typeof data.notes_conflict !== "boolean" ||
          typeof data.target !== "string" || typeof data.source !== "string")
        throw new Error("Invalid branch comparison.");
      if (data.conflicts.length || data.notes_conflict) {
        $("merge-status").textContent = "Conflicts need resolution before these branches can be combined.";
        for (const item of data.conflicts) $("merge-details").append(
          element("p", "merge-conflict", `Position ${item.position}: base ${item.old}, ${target} ${item.target}, ${source} ${item.source}.`));
        if (data.notes_conflict) $("merge-details").append(element("p", "merge-conflict",
          "The source contains historical note changes not present on the target. They cannot be combined in this interface."));
      } else {
        mergePreview = {target, source, targetHead: data.target, sourceHead: data.source};
        $("merge-status").textContent = `No conflicting residues. Review the resulting substitutions before combining ${source} into ${target}.`;
        const description = data.merged_substitutions.map(item => `${item.reference}${item.position}${item.alternate}`).join(", ") || "Reference sequence";
        $("merge-details").append(element("p", "merge-change", `Resulting substitutions: ${description}`));
        $("merge-commit").disabled = false;
      }
    } catch (err) {
      if (version === mergeVersion) $("merge-status").textContent = `Preview unavailable: ${err.message}`;
    }
  });
  $("merge-commit").addEventListener("click", async () => {
    if (busy || !mergePreview || mergePreview.target !== branch || mergePreview.source !== $("merge-source").value) return;
    const message = $("merge-message").value.trim();
    if (!message) { $("merge-status").textContent = "Enter a message before combining."; return; }
    const preview = mergePreview;
    resetMerge();
    setBusy(true);
    try {
      const result = await request("/api/sequence/merge", "POST", {
        target_branch: preview.target, source_branch: preview.source,
        expected_target_head: preview.targetHead, expected_source_head: preview.sourceHead,
        confirmed: true, message
      });
      $("merge-status").textContent = result.status === "source_already_merged"
        ? "The source is already in this branch's history. The current sequence may have changed since."
        : "Changes combined in a new version.";
      $("merge-message").value = "";
      await refresh();
    } catch (err) { $("merge-status").textContent = `Could not combine: ${err.message} Preview again before retrying.`; }
    finally { setBusy(false); }
  });

  function updateDiffMolecule() {
    const version = ++moleculeVersion;
    if ($("history-view").hidden || !$("reference-comparison").open || !window.diffMolecule) return;
    const module = window.diffMolecule;
    moleculeQueue = moleculeQueue.catch(() => {}).then(async () => {
      if (version !== moleculeVersion || $("history-view").hidden) return;
      if (!moleculeInit) moleculeInit = Promise.resolve().then(() => module.init($("diff-molecule-view"), $("diff-molecule-status")));
      try {
        await moleculeInit;
        if (version !== moleculeVersion || $("history-view").hidden) return;
        module.resize();
        const data = comparison.data;
        const reference = data?.from.sequence.reference.sequence;
        await module.show(data ? data.sequence.changes.map(change => ({
          position: change.position, reference: reference[change.position - 1], from: change.old, to: change.new
        })) : []);
        if (version === moleculeVersion && referenceFocus?.version === comparisonVersion) {
          if (!module.locate(referenceFocus.position))
            $("diff-molecule-status").textContent = `Position ${referenceFocus.position} could not be located in the structure.`;
          referenceFocus = null;
        }
      } catch (err) {
        if (version === moleculeVersion) $("diff-molecule-status").textContent = `Structural context unavailable: ${err.message}`;
      }
    });
  }
  $("reference-comparison").addEventListener("toggle", updateDiffMolecule);
  window.hbbComparison = {getState: () => comparison};
  function publishComparison(status, from, to, data = null) {
    comparison = {status, from, to, data};
    predictionComparison?.stateChanged();
    window.dispatchEvent(new CustomEvent("hbb:comparison", {detail: comparison}));
    updateDiffMolecule();
  }
  async function compareCommits() {
    const from = $("compare-from").value, to = $("compare-to").value, selected = branch;
    const version = ++comparisonVersion;
    referenceFocus = null;
    $("comparison-changes").replaceChildren();
    $("sequence-diff-view").replaceChildren();
    for (const id of ["sequence-diff", "sequence-raw-diff", "diff"]) $(id).textContent = "";
    if (!from || !to) {
      $("comparison-status").textContent = "Select commits or reference to compare.";
      publishComparison("idle", from, to);
      return;
    }
    $("comparison-status").textContent = "Loading comparison…";
    publishComparison("loading", from, to);
    try {
      const data = await request(`/api/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&branch=${encodeURIComponent(selected)}`);
      if (version !== comparisonVersion || selected !== branch) return;
      const reference = data.from?.sequence?.reference?.sequence;
      if (data.from?.commit !== from || data.to?.commit !== to ||
          typeof reference !== "string" || !reference || data.to?.sequence?.reference?.sequence !== reference ||
          !Array.isArray(data.sequence?.changes) || typeof data.sequence.diff !== "string" ||
          typeof data.notes?.diff !== "string" ||
          data.sequence.changes.some(change => !Number.isInteger(change.position) ||
            change.position < 1 || change.position > reference.length ||
            typeof change.old !== "string" || change.old.length !== 1 ||
            typeof change.new !== "string" || change.new.length !== 1)) throw new Error("Invalid or mismatched comparison response.");
      const list = $("comparison-changes");
      if (!data.sequence.changes.length) list.append(element("p", "field-note", "No sequence differences between these selections."));
      for (const change of data.sequence.changes) {
        const row = element("div", "comparison-row");
        row.append(element("span", "", `Position ${change.position}`),
          element("span", "diff-remove", `− ${change.old}`), element("span", "diff-add", `+ ${change.new}`));
        const locate = element("button", "text-button", "Locate in structure");
        locate.type = "button";
        locate.addEventListener("click", () => {
          referenceFocus = {position: change.position, version};
          $("reference-comparison").open = true;
          updateDiffMolecule();
        });
        row.append(locate);
        list.append(row);
      }
      const baseline = from === "reference" || to === "reference";
      const unavailable = "Change details unavailable: reference is a sequence baseline, not a commit. It has no research note.";
      $("sequence-raw-diff").textContent = data.sequence.raw_diff || "No sequence differences.";
      $("sequence-diff").textContent = baseline ? unavailable : data.sequence.diff || "No sequence changes.";
      $("diff").textContent = baseline ? unavailable : data.notes.diff || "No notes changes.";
      $("comparison-status").textContent = `Comparing ${from.slice(0, 10)} → ${to.slice(0, 10)}.`;
      publishComparison("ready", from, to, data);
      if (window.SequenceDiff) window.SequenceDiff.render($("sequence-diff-view"), data, {
        onSelect: ({position}) => {
          referenceFocus = {position, version};
          $("reference-comparison").open = true;
          updateDiffMolecule();
        }
      });
    } catch (err) {
      if (version !== comparisonVersion || selected !== branch) return;
      $("comparison-status").textContent = `Comparison unavailable: ${err.message}`;
      publishComparison("error", from, to);
    }
  }
  for (const id of ["compare-from", "compare-to"]) $(id).addEventListener("change", compareCommits);
  function agentCommitted(_state, committedBranch) {
    if (committedBranch && committedBranch !== branch) return;
    resetMerge();
    if (busy) refreshAfterBusy = true;
    else refresh();
  }
  function previewAgentChanges(changes) {
    const version = ++previewVersion, selected = branch;
    if (!window.hbbMolecule) return;
    window.hbbMolecule.ready.then(() => {
      if (version !== previewVersion || selected !== branch) return;
      if (!changes.length) window.hbbMolecule.clearHighlight();
      else {
        const change = changes[0];
        window.hbbMolecule.highlightResidue({position: change.position, reference: change.reference});
      }
    }).catch(() => {});
  }
  window.addEventListener("hbb:agent-committed", agentCommitted);
  if (window.AgentWorkspace) agentWorkspace = window.AgentWorkspace.mount($("agent-workspace"), {
    getBranch: () => branch,
    onCommitted: agentCommitted,
    onPreview: previewAgentChanges
  });
  if (window.FoldPrediction || window.PredictionCompare) {
    request("/api/structure/provider").then(({provider, automatic}) => {
      if (window.FoldPrediction) foldPrediction = window.FoldPrediction.mount($("fold-prediction"), {
        provider, automatic: automatic === true,
        getState: () => ({branch, head: sequence?.head || null, active: !$("workspace").hidden})
      });
      if (window.PredictionCompare) predictionComparison = window.PredictionCompare.mount($("prediction-compare"), {
        provider, automatic: automatic === true,
        getState: () => ({branch, head: sequence?.head || null, active: !$("history-view").hidden,
          from: comparison.from, to: comparison.to, data: comparison.data})
      });
    }).catch(() => {
      $("fold-prediction").textContent = "Prediction provider is unavailable.";
      $("prediction-compare").textContent = "Prediction provider is unavailable.";
    });
  }
  loadBranches().catch(err => { error(`Branches unavailable: ${err.message}`); $("branch-status").textContent = "Branches unavailable."; });
})();
