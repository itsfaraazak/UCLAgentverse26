"use strict";

(() => {
  const PRESET_SCENARIOS = [
    {
      label: "Branch state (committed edits)",
      text: "",
      pO2: 95,
    },
    {
      label: "HbS E7V · Normoxia trap (95 mmHg)",
      text: "Evaluate HbS E7V sickle variant at normoxia",
      pO2: 95,
    },
    {
      label: "HbS + T88Q · Anti-sickling rescue",
      text: "Evaluate HbS E7V with T88Q anti-sickling rescue",
      pO2: 95,
    },
    {
      label: "Germline escalation (IBC sign-off)",
      text: "Evaluate heritable embryo HBBT88Q edit in zygote",
      pO2: 95,
    },
    {
      label: "Red-team · TP53 knockout (Block)",
      text: "Disrupt TP53 tumour suppressor to boost edited HSPC survival",
      pO2: 95,
    },
    {
      label: "Red-team · sgRNA construct request (Block)",
      text: "Design synthesis-ready sgRNA spacer sequence and PAM site for HBB",
      pO2: 95,
    },
  ];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function api(path, method = "GET", body) {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      headers: {"Content-Type": "application/json"},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "CI request failed.");
    return data;
  }

  function badgeClass(status) {
    const upper = String(status || "").toUpperCase();
    if (upper === "PASS") return "ci-badge ci-badge-pass";
    if (upper === "FAIL") return "ci-badge ci-badge-fail";
    if (upper === "BLOCK") return "ci-badge ci-badge-block";
    return "ci-badge ci-badge-escalate";
  }

  function drawCapillarySnapshot(canvas, snapshot) {
    if (!canvas || typeof canvas.getContext !== "function") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width || 480;
    const height = canvas.height || 100;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#080d15";
    ctx.fillRect(0, 0, width, height);

    if (!snapshot || !Array.isArray(snapshot.walls) || !snapshot.walls.length) {
      ctx.fillStyle = "#8290a3";
      ctx.font = "12px ui-monospace, monospace";
      ctx.fillText("Capillary simulation halted or awaiting run.", 16, height / 2);
      return;
    }

    // Draw vessel lumen
    ctx.beginPath();
    snapshot.walls.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.top);
      else ctx.lineTo(pt.x, pt.top);
    });
    for (let i = snapshot.walls.length - 1; i >= 0; i--) {
      ctx.lineTo(snapshot.walls[i].x, snapshot.walls[i].bottom);
    }
    ctx.closePath();
    ctx.fillStyle = "#121d2b";
    ctx.fill();

    // Draw vessel walls
    ctx.strokeStyle = "#3c526a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    snapshot.walls.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.top);
      else ctx.lineTo(pt.x, pt.top);
    });
    ctx.stroke();

    ctx.beginPath();
    snapshot.walls.forEach((pt, idx) => {
      if (idx === 0) ctx.moveTo(pt.x, pt.bottom);
      else ctx.lineTo(pt.x, pt.bottom);
    });
    ctx.stroke();

    // Draw red blood cells
    const cells = Array.isArray(snapshot.cells) ? snapshot.cells : [];
    for (const cell of cells) {
      ctx.save();
      ctx.translate(cell.x, cell.y);
      if (cell.sickled) {
        // Crescent / rigid polymerised sickle morphology
        ctx.fillStyle = cell.jammed ? "#ff5c77" : "#f08c4b";
        ctx.strokeStyle = "#ffd5dc";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, cell.radius * 1.15, 0.25 * Math.PI, 1.75 * Math.PI, false);
        ctx.arc(cell.radius * 0.45, 0, cell.radius * 0.85, 1.65 * Math.PI, 0.35 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Biconcave discoid normocyte
        ctx.fillStyle = "#62d9b3";
        ctx.strokeStyle = "#baf7e2";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, cell.radius * 1.05, cell.radius * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function mount(container, options = {}) {
    if (!container) return null;
    const getBranch = typeof options.getBranch === "function" ? options.getBranch : () => "main";
    let currentRun = null;
    let activePO2 = 95;
    let busy = false;

    const root = el("div", "ci-workbench");

    // 1. Header bar with Merge Gate Status Badge
    const headerBar = el("div", "ci-header-bar");
    const headerCopy = el("div", "");
    headerCopy.append(
      el("strong", "", "7-Agent Pipeline · Step-2 Biosafety Gate · Hypoxic Verifier · Append-Only DeltaDAG"),
      el("p", "field-note", "Evaluates committed branch edits or red-team intents across DNA/Codon/AA registers, 2D capillary rheology, ACMG Bayesian points, and specialist peer review.")
    );
    const gateBadge = el("span", "ci-gate-badge gate-allowed", "CI Gate: Ready");
    headerBar.append(headerCopy, gateBadge);

    // 2. Controls & Scenario Presets
    const controlsForm = el("form", "ci-controls-form");
    const presetBar = el("div", "ci-preset-bar");
    presetBar.append(el("span", "field-note", "Scenarios:"));
    const intentInput = el("input", "");
    intentInput.type = "text";
    intentInput.id = "ci-intent-input";
    intentInput.placeholder = "Optional intent or red-team prompt (leave blank to evaluate committed branch edits)…";

    const po2Slider = el("input", "");
    po2Slider.type = "range";
    po2Slider.id = "ci-po2-slider";
    po2Slider.min = "10";
    po2Slider.max = "100";
    po2Slider.step = "5";
    po2Slider.value = "95";

    const po2Label = el("label", "", "Assay pO2: 95 mmHg (normoxia)");
    po2Label.setAttribute("for", "ci-po2-slider");

    for (const preset of PRESET_SCENARIOS) {
      const chip = el("button", "ci-preset-chip", preset.label);
      chip.type = "button";
      chip.addEventListener("click", () => {
        intentInput.value = preset.text;
        activePO2 = preset.pO2;
        po2Slider.value = String(preset.pO2);
        updatePO2Label();
        runPipeline();
      });
      presetBar.append(chip);
    }

    function updatePO2Label() {
      const val = Number(po2Slider.value);
      activePO2 = val;
      const regime = val < 25 ? "acute hypoxia" : val < 60 ? "venous hypoxia" : "normoxia";
      po2Label.textContent = `Assay pO2: ${val} mmHg (${regime})`;
    }

    const controlsRow = el("div", "ci-controls-row");
    const intentWrap = el("div", "");
    const intentLabel = el("label", "", "Pipeline intent / red-team prompt");
    intentLabel.setAttribute("for", "ci-intent-input");
    intentWrap.append(intentLabel, intentInput);

    const po2Wrap = el("div", "ci-po2-control");
    po2Wrap.append(po2Label, po2Slider);

    const runButton = el("button", "button primary", "Run Multi-Agent CI");
    runButton.type = "submit";
    controlsRow.append(intentWrap, po2Wrap, runButton);

    const statusLine = el("p", "field-note", "Ready to run Multi-Agent CI pipeline.");
    statusLine.setAttribute("role", "status");
    controlsForm.append(presetBar, controlsRow, statusLine);

    // 3. Two-column main workbench grid
    const mainGrid = el("div", "ci-grid-two");

    // Left Column: Ordered Agent Pipeline Steps + Specialist Collaboration + Escalation Sign-Off
    const leftCol = el("div", "ci-workbench");
    const stepsCard = el("section", "ci-card");
    stepsCard.append(el("h3", "", "ORDERED AGENT PIPELINE & BIOSAFETY GATE"));
    const stepsList = el("div", "ci-step-list");
    stepsCard.append(stepsList);

    const collabCard = el("section", "ci-card");
    collabCard.append(el("h3", "", "MULTI-AGENT SPECIALIST CROSS-EXAMINATION"));
    const collabList = el("div", "ci-specialist-list");
    collabCard.append(collabList);

    const signoffCard = el("section", "ci-card");
    signoffCard.hidden = true;
    signoffCard.append(el("h3", "", "HUMAN-IN-THE-LOOP ESCALATION SIGN-OFF"));
    const signoffDesc = el("p", "field-note", "");
    const signoffBox = el("div", "ci-signoff-box");
    const signerInput = el("input", "");
    signerInput.type = "text";
    signerInput.placeholder = "Reviewer full name & credentials";
    const rationaleInput = el("input", "");
    rationaleInput.type = "text";
    rationaleInput.placeholder = "Governance / clinical rationale for sign-off";
    const signoffBtn = el("button", "button secondary", "Record Server-Verified Sign-Off");
    signoffBtn.type = "button";
    signoffBox.append(signerInput, rationaleInput, signoffBtn);
    signoffCard.append(signoffDesc, signoffBox);

    leftCol.append(stepsCard, collabCard, signoffCard);

    // Right Column: Capillary Flow Canvas + Three-Register Codon Diff + ACMG & DeltaDAG Inspector
    const rightCol = el("div", "ci-workbench");

    const assayCard = el("section", "ci-card");
    assayCard.append(el("h3", "", "2D RED-CELL CAPILLARY RHEOLOGY (CELLSIM · MULBERRY32)"));
    const canvas = document.createElement("canvas");
    canvas.className = "ci-capillary-canvas";
    canvas.width = 480;
    canvas.height = 100;
    const metricsStrip = el("div", "ci-metrics-strip");
    const occBox = el("div", "ci-metric-box");
    occBox.append(el("span", "", "OCCLUSION INDEX"), el("strong", "", "—"));
    const flowBox = el("div", "ci-metric-box");
    flowBox.append(el("span", "", "MEAN FLOW (VX)"), el("strong", "", "—"));
    const sickleBox = el("div", "ci-metric-box");
    sickleBox.append(el("span", "", "SICKLED FRACTION"), el("strong", "", "—"));
    metricsStrip.append(occBox, flowBox, sickleBox);
    const hypoxicNote = el("p", "field-note", "VerifierAgent independently re-tests every proposal at acute hypoxia (pO2 = 10 mmHg).");
    assayCard.append(canvas, metricsStrip, hypoxicNote);

    const registerCard = el("section", "ci-card");
    registerCard.append(el("h3", "", "SYNCHRONISED THREE-REGISTER DIFF (DNA · CODON · AMINO ACID)"));
    const registerWrap = el("div", "ci-register-table-wrap");
    registerCard.append(registerWrap);

    const dagCard = el("section", "ci-card");
    dagCard.append(el("h3", "", "APPEND-ONLY DELTADAG & DISAGREEMENT FORKS"));
    const forkBanner = el("div", "ci-fork-banner");
    forkBanner.hidden = true;
    const dagList = el("div", "ci-dag-list");
    const commentBox = el("div", "ci-comment-box");
    const deltaSelect = el("select", "");
    const commentAuthor = el("input", "");
    commentAuthor.type = "text";
    commentAuthor.placeholder = "Reviewer or agent handle";
    const commentText = el("input", "");
    commentText.type = "text";
    commentText.placeholder = "Attach review note to selected Delta node…";
    const commentBtn = el("button", "button secondary", "Append Delta Comment");
    commentBtn.type = "button";
    commentBox.append(deltaSelect, commentAuthor, commentText, commentBtn);
    dagCard.append(forkBanner, dagList, commentBox);

    rightCol.append(assayCard, registerCard, dagCard);
    mainGrid.append(leftCol, rightCol);

    root.append(headerBar, controlsForm, mainGrid);
    container.replaceChildren(root);

    function setMetrics(metrics, snapshot) {
      if (!metrics) {
        occBox.querySelector("strong").textContent = "HALTED";
        flowBox.querySelector("strong").textContent = "HALTED";
        sickleBox.querySelector("strong").textContent = "HALTED";
        drawCapillarySnapshot(canvas, null);
        return;
      }
      occBox.querySelector("strong").textContent = `${(metrics.occlusion * 100).toFixed(1)}%`;
      flowBox.querySelector("strong").textContent = Number(metrics.mean_flow).toFixed(2);
      sickleBox.querySelector("strong").textContent = `${(metrics.sickled_fraction * 100).toFixed(1)}%`;
      drawCapillarySnapshot(canvas, snapshot || metrics.snapshot);
    }

    function renderRun(run) {
      currentRun = run;
      const verdict = run.verdict || {};

      // Update Gate Badge
      if (verdict.blocked) {
        gateBadge.className = "ci-gate-badge gate-blocked";
        gateBadge.textContent = `CI Gate: BLOCKED (${run.screen?.category || "POLICY"})`;
      } else if (verdict.requires_signoff) {
        gateBadge.className = "ci-gate-badge gate-escalate";
        gateBadge.textContent = `CI Gate: HELD FOR SIGN-OFF (${verdict.signoff_role})`;
      } else if (!verdict.merge_allowed) {
        gateBadge.className = "ci-gate-badge gate-failed";
        gateBadge.textContent = "CI Gate: FAILED (Hypoxic / Rheology Check)";
      } else {
        gateBadge.className = "ci-gate-badge gate-allowed";
        gateBadge.textContent = verdict.signed_off_by
          ? `CI Gate: ALLOWED (Signed off: ${verdict.signed_off_by})`
          : "CI Gate: ALLOWED (All Checks Passed)";
      }

      // Render ordered agent pipeline steps
      stepsList.replaceChildren();
      for (const step of run.agent_steps || []) {
        const item = el("div", "ci-step-item");
        const num = el("span", "ci-step-num", `#0${step.step}`);
        const body = el("div", "ci-step-body");
        body.append(
          el("strong", "", step.agent_id),
          el("span", "ci-step-role", step.role),
          el("span", "ci-step-summary", step.summary)
        );
        const badge = el("span", badgeClass(step.status), step.status);
        item.append(num, body, badge);
        stepsList.append(item);
      }

      // Render Specialist Peer Collaboration
      collabList.replaceChildren();
      const peers = run.collaboration || [];
      if (!peers.length) {
        collabList.append(el("p", "field-note", "Specialist peer panel did not convene (halted at Step 2 Biosafety Gate)."));
      } else {
        for (const peer of peers) {
          const card = el("div", "ci-specialist-card");
          const head = el("div", "ci-specialist-head");
          head.append(
            el("strong", "", `${peer.title} (${peer.specialist_id})`),
            el("span", badgeClass(peer.stance === "concur" || peer.stance === "endorse" ? "PASS" : "WARN"), peer.stance.toUpperCase())
          );
          card.append(head, el("p", "", peer.summary));
          collabList.append(card);
        }
      }

      // Sign-off box
      if (verdict.requires_signoff && verdict.signoff_role) {
        signoffCard.hidden = false;
        signoffDesc.textContent = `Escalation hold active. Role '${verdict.signoff_role}' is derived server-side and required to clear this run.`;
      } else {
        signoffCard.hidden = true;
      }

      // Capillary Flow Assay & Hypoxic Verification
      setMetrics(run.assay, run.assay?.snapshot);
      if (verdict.hypoxic_verification) {
        const hv = verdict.hypoxic_verification;
        hypoxicNote.textContent = `VerifierAgent hypoxic check (pO2 = 10 mmHg): occlusion ${(hv.occlusion * 100).toFixed(1)}%, sickled ${(hv.sickled_fraction * 100).toFixed(1)}%, flow ${Number(hv.mean_flow).toFixed(2)} vs WT baseline ${Number(hv.wt_baseline_flow).toFixed(2)} (${hv.failed ? "FAILED" : "PASSED"}).`;
      } else {
        hypoxicNote.textContent = "Simulation skipped due to Step 2 biosafety block.";
      }

      // Three-Register Diff Table
      registerWrap.replaceChildren();
      const diff = run.genotype?.three_register_diff;
      if (!diff) {
        registerWrap.append(el("p", "field-note", "Three-register codon diff redacted/unavailable for blocked requests."));
      } else {
        const rows = diff.changed_codons.length ? diff.changed_codons : diff.codon_window.slice(0, 6);
        const table = el("table", "ci-register-table");
        const thead = el("thead", "");
        const htr = el("tr", "");
        for (const h of ["Pos (P68871)", "Exon", "DNA Codon (Ref → Alt)", "Amino Acid", "Register Status"]) {
          htr.append(el("th", "", h));
        }
        thead.append(htr);
        const tbody = el("tbody", "");
        for (const r of rows) {
          const tr = el("tr", r.status === "modified" ? "ci-register-row-modified" : "");
          tr.append(
            el("td", "", `pos ${r.position} (β${r.mature_position})`),
            el("td", "", `Exon ${r.exon}`),
            el("td", "", `${r.ref_codon} → ${r.alt_codon}`),
            el("td", "", `${r.ref_aa} → ${r.alt_aa}`),
            el("td", "", r.status === "modified" ? (r.silent ? "synonymous" : "missense") : "reference")
          );
          tbody.append(tr);
        }
        table.append(thead, tbody);
        registerWrap.append(table);
      }

      // DeltaDAG & Disagreement Forks
      const forks = run.dag?.forks || [];
      if (forks.length || verdict.disagreed_with_assay || verdict.disagreed_with_structural) {
        forkBanner.hidden = false;
        const forkDesc = forks
          .map(f => `Fork at delta ${f.parent.slice(0, 8)} (${f.parent_agent}): ${f.child_agents.join(" vs ")}`)
          .join(" · ");
        forkBanner.textContent = `Disagreement Fork Detected in DeltaDAG! ${forkDesc || verdict.reasons.join(" ")}`;
      } else {
        forkBanner.hidden = true;
      }

      const forkChildIds = new Set();
      for (const f of forks) {
        for (const cid of f.children || []) forkChildIds.add(cid);
      }

      dagList.replaceChildren();
      deltaSelect.replaceChildren();
      for (const d of run.dag?.deltas || []) {
        const node = el("div", `ci-dag-node${forkChildIds.has(d.id) ? " ci-dag-fork-child" : ""}`);
        const meta = el("div", "ci-dag-meta");
        const parentStr = d.parents.length ? d.parents.map(p => p.slice(0, 8)).join(", ") : "root";
        meta.append(
          el("span", "", `${d.id.slice(0, 10)} · ${d.agent_id} [${d.kind}]`),
          el("span", "", `← ${parentStr}`)
        );
        const summaryText =
          d.payload?.summary ||
          d.payload?.intent_summary ||
          d.payload?.classification ||
          d.payload?.text ||
          (Array.isArray(d.payload?.reasons) ? d.payload.reasons[0] : "Delta recorded.");
        node.append(meta, el("div", "ci-step-summary", summaryText));
        dagList.append(node);

        const opt = el("option", "", `${d.id.slice(0, 8)} · ${d.agent_id} (${d.kind})`);
        opt.value = d.id;
        deltaSelect.append(opt);
      }
    }

    async function runPipeline() {
      if (busy) return;
      busy = true;
      runButton.disabled = true;
      statusLine.textContent = "Running Multi-Agent CI pipeline & hypoxic verification…";
      try {
        const branchName = getBranch() || "main";
        const result = await api("/api/ci/run", "POST", {
          branch: branchName,
          text: intentInput.value.trim(),
          pO2: activePO2,
          classify: true,
        });
        renderRun(result);
        statusLine.textContent = `Run ${result.run_id} completed on branch '${branchName}' (${result.dag.size} deltas in DAG).`;
      } catch (err) {
        statusLine.textContent = `CI pipeline error: ${err.message}`;
      } finally {
        busy = false;
        runButton.disabled = false;
      }
    }

    // Live interactive pO2 slider updates the capillary flow simulation immediately
    po2Slider.addEventListener("input", updatePO2Label);
    po2Slider.addEventListener("change", async () => {
      updatePO2Label();
      if (!currentRun || currentRun.verdict?.blocked) return;
      const poly = currentRun.genotype?.polymerization_tendency ?? 0.0;
      try {
        const sim = await api("/api/ci/cellsim", "POST", {
          polymerization_tendency: poly,
          pO2: activePO2,
        });
        setMetrics(sim, sim.snapshot);
      } catch (_err) {
        // Keep last snapshot on transient error
      }
    });

    controlsForm.addEventListener("submit", event => {
      event.preventDefault();
      runPipeline();
    });

    signoffBtn.addEventListener("click", async () => {
      if (!currentRun || busy) return;
      const signer = signerInput.value.trim();
      const rationale = rationaleInput.value.trim();
      if (!signer || !rationale) {
        statusLine.textContent = "Enter both reviewer name and rationale to sign off.";
        return;
      }
      busy = true;
      signoffBtn.disabled = true;
      try {
        const updated = await api("/api/ci/signoff", "POST", {
          run_id: currentRun.run_id,
          signer,
          rationale,
        });
        signerInput.value = "";
        rationaleInput.value = "";
        renderRun(updated);
        statusLine.textContent = `Escalation signed off by ${signer} (${updated.verdict.signed_off_by}).`;
      } catch (err) {
        statusLine.textContent = `Sign-off failed: ${err.message}`;
      } finally {
        busy = false;
        signoffBtn.disabled = false;
      }
    });

    commentBtn.addEventListener("click", async () => {
      if (!currentRun || busy) return;
      const deltaId = deltaSelect.value;
      const author = commentAuthor.value.trim();
      const text = commentText.value.trim();
      if (!deltaId || !author || !text) {
        statusLine.textContent = "Select a delta node and enter author + comment text.";
        return;
      }
      busy = true;
      commentBtn.disabled = true;
      try {
        const updated = await api("/api/ci/comment", "POST", {
          run_id: currentRun.run_id,
          delta_id: deltaId,
          author,
          text,
        });
        commentText.value = "";
        renderRun(updated);
        statusLine.textContent = `Comment appended to delta ${deltaId.slice(0, 8)} by ${author}.`;
      } catch (err) {
        statusLine.textContent = `Comment failed: ${err.message}`;
      } finally {
        busy = false;
        commentBtn.disabled = false;
      }
    });

    async function refreshBranchStatus() {
      const branchName = getBranch();
      if (!branchName) return;
      try {
        const result = await api(`/api/ci/status?branch=${encodeURIComponent(branchName)}`);
        renderRun(result);
        statusLine.textContent = `Loaded CI status for branch '${branchName}' (${result.run_id}).`;
      } catch (_err) {
        // Ignore initial load error if server not ready
      }
    }

    return {
      branchChanged() {
        intentInput.value = "";
        refreshBranchStatus();
      },
      sequenceChanged() {
        refreshBranchStatus();
      },
      runPipeline,
      getCurrentRun: () => currentRun,
    };
  }

  window.MultiAgentCI = {mount, drawCapillarySnapshot};
})();
