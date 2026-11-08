"use strict";

// Standalone, optional integration. No DOM lookup or WebGL work until init().
(function () {
  const canonical = "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH";
  const names = {ALA: "A", CYS: "C", ASP: "D", GLU: "E", PHE: "F", GLY: "G",
    HIS: "H", ILE: "I", LYS: "K", LEU: "L", MET: "M", ASN: "N", PRO: "P",
    GLN: "Q", ARG: "R", SER: "S", THR: "T", VAL: "V", TRP: "W", TYR: "Y"};
  const disclaimer = "2HHB deposited beta-chain coordinates unchanged; edits are annotations only, not mutant coordinates or predictions of effect.";
  let container, status, viewer, observed, loading, observer;
  let changes = [], mapped = [], issues = [], revision = 0;
  let viewers = [], panels = [], siteButtons = [], selected = null;
  const colors = {before: "#e5484d", after: "#30a46c"};
  const labelColors = ["#9f2028", "#14643f"];

  function message(text) {
    if (status) status.textContent = `${text} ${disclaimer}`;
  }
  function fit(view) {
    view.resize();
    view.zoomTo({chain: ["B", "D"]});
    // Give labels and the paired, narrower canvases room around the molecule.
    if (typeof view.zoom === "function") view.zoom(0.7);
    view.render();
  }
  function controls() {
    const doc = status.ownerDocument;
    const toolbar = doc.createElement("div");
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "Sequence annotation view and changed sites");
    const button = (text, action) => {
      const node = doc.createElement("button");
      node.type = "button";
      node.textContent = text;
      node.addEventListener("click", action);
      toolbar.appendChild(node);
      return node;
    };
    button("Show all sites / reset context", () => {
      selected = null;
      updateSelection();
      viewers.forEach(fit);
    });
    siteButtons = [];
    for (const change of changes) {
      const isMapped = mapped.some(c => c.position === change.position);
      const node = button(`P68871 ${change.position}: OLD ${change.from} → NEW ${change.to}; reference ${change.reference}; ` +
        (isMapped ? `2HHB B/D:${change.position - 1}` : "UNMAPPED — no coordinate marker"),
        () => locate(change.position));
      node.disabled = !isMapped;
      node.style.whiteSpace = "normal";
      node.style.margin = "4px";
      node.setAttribute("aria-pressed", String(selected === change.position));
      siteButtons.push({node, position: change.position});
      node.title = node.disabled ? "Not mapped in deposited 2HHB; see mapping warning." :
        `Focus deposited B/D:${change.position - 1}; sequence identities are annotations only.`;
    }
    status.appendChild(toolbar);
  }
  function visible() {
    return container && container.getClientRects().length > 0 &&
      container.getBoundingClientRect().width > 0 && container.getBoundingClientRect().height > 0;
  }
  function validate(input) {
    if (!Array.isArray(input)) throw new Error("Pass an array of P68871 sequence changes.");
    const seen = new Set();
    return input.map(change => {
      const {position, reference, from, to} = change || {};
      if (!Number.isInteger(position) || position < 1 || position > canonical.length)
        throw new Error("Position must be a 1-based P68871 position (1–147).");
      if (reference !== canonical[position - 1])
        throw new Error(`P68871 reference mismatch at ${position}: expected ${canonical[position - 1]}.`);
      if (![from, to].every(value => typeof value === "string" && value.length === 1 &&
          "ACDEFGHIKLMNPQRSTVWY".includes(value)) || from === to)
        throw new Error(`Change at ${position} needs distinct uppercase amino acids from/to.`);
      if (seen.has(position)) throw new Error(`Duplicate position ${position}.`);
      seen.add(position);
      return {position, reference, from, to};
    });
  }
  function draw() {
    mapped = [];
    issues = [];
    viewers.forEach(v => {
      if (typeof v.removeAllLabels === "function") v.removeAllLabels();
      v.setStyle({}, {cartoon: {color: "#a9b4c2"}});
    });
    for (const change of changes) {
      const resi = change.position - 1;
      if (change.position === 1) {
        issues.push("Initiator M1 is cleaved and unresolvable in 2HHB");
      } else if (["B", "D"].some(chain => observed[chain].get(resi) !== change.reference)) {
        issues.push(`Cannot map P68871 ${change.position}: 2HHB B/D:${resi} missing or mismatched; check the local PDB`);
      } else {
        mapped.push(change);
        // Mark the deposited residue without assigning the proposed residue's identity.
        viewers.forEach((v, index) => {
          const color = index === 0 ? colors.before : colors.after;
          v.setStyle({chain: ["B", "D"], resi},
            {cartoon: {color}, stick: {color, radius: 0.3}});
        });
      }
    }
    message(`OLD red / NEW green — simultaneous sequence annotations on REFERENCE 2HHB. ` +
      `Gray = full deposited beta-chain context (B and D); colored sticks are reference atoms, not edited atoms. ` +
      `${mapped.length}/${changes.length} changed positions marked on both B/D chains.` +
      (changes.length ? ` Proposed sequence edits: ${changes.map(c => `${c.from}${c.position}${c.to}`).join(", ")}.` : " No sequence differences.") +
      (issues.length ? ` ${issues.join("; ")}.` : "") +
      (typeof viewer.setClickable === "function" ? " Click a marked residue to locate it." : " Use locate(position) to focus a marked residue.") +
      " Drag to rotate.");
    controls();
    updateSelection();
    return {applied: true, mapped: mapped.map(c => c.position), issues: issues.slice()};
  }
  async function ensure() {
    if (!container) return {applied: false, pending: true};
    if (!visible()) {
      message("Waiting for a visible, non-zero-size container; reveal it and call resize() if needed.");
      return {applied: false, pending: true};
    }
    if (viewer) {
      viewers.forEach(v => { v.resize(); v.render(); });
      return {applied: true, mapped: mapped.map(c => c.position), issues: issues.slice()};
    }
    if (loading) return loading;
    message("Loading local 2HHB structural context…");
    loading = (async () => {
      try {
        if (!window.$3Dmol) throw new Error("Load the local 3Dmol library first.");
        const response = await fetch("/structures/2hhb.pdb");
        if (!response.ok) throw new Error("Serve /structures/2hhb.pdb locally and retry init().");
        const pdb = await response.text();
        if (!pdb.includes("2HHB") || !pdb.includes("\nATOM  "))
          throw new Error("The local 2HHB PDB is invalid.");
        observed = {B: new Map(), D: new Map()};
        const beta = pdb.split("\n").filter(line => {
          if (!line.startsWith("ATOM  ")) return false;
          const chain = line[21], resi = Number(line.slice(22, 26));
          if (!observed[chain]) return false;
          if (!line.slice(26, 27).trim()) {
            const identity = names[line.slice(17, 20)] || "?";
            const previous = observed[chain].get(resi);
            observed[chain].set(resi, previous && previous !== identity ? "?" : identity);
          }
          return true;
        }).join("\n");
        if (!observed.B.size || !observed.D.size) throw new Error("2HHB beta chains B/D are missing.");
        // Visibility can change during fetch; defer WebGL allocation until visible again.
        if (!visible()) return {applied: false, pending: true};
        if (!panels.length) {
          const doc = status.ownerDocument;
          container.style.display = "flex";
          container.style.flexWrap = "wrap";
          container.style.overflow = "visible";
          container.style.height = "auto";
          for (const title of ["OLD — red — before sequence", "NEW — green — after sequence"]) {
            const panel = doc.createElement("section");
            panel.style.cssText = "flex:1 1 240px;min-width:0;display:flex;flex-direction:column";
            const heading = doc.createElement("strong");
            heading.textContent = `${title} (reference coordinates)`;
            heading.style.color = panels.length ? colors.after : colors.before;
            panel.appendChild(heading);
            const canvas = doc.createElement("div");
            canvas.style.cssText = "position:relative;width:100%;height:320px";
            canvas.setAttribute("role", "img");
            canvas.setAttribute("aria-label", `${title}. Reference 2HHB; use site buttons for keyboard selection.`);
            panel.appendChild(canvas);
            container.appendChild(panel);
            panels.push(canvas);
          }
        }
        for (const panel of panels) {
          const v = window.$3Dmol.createViewer(panel, {backgroundColor: "#0c131f"});
          if (!v) throw new Error("WebGL is unavailable.");
          viewers.push(v);
          v.addModel(beta, "pdb");
          if (typeof v.setClickable === "function") {
            v.setClickable({chain: ["B", "D"]}, true, atom => {
            const position = Number(atom.resi) + 1;
            if (mapped.some(c => c.position === position)) locate(position);
            });
          }
          fit(v);
        }
        // 3Dmol's native link passes setView(view, true) to the peer: the
        // second argument suppresses propagation and prevents feedback loops.
        if (viewers.every(v => typeof v.linkViewer === "function")) {
          viewers[0].linkViewer(viewers[1]);
          viewers[1].linkViewer(viewers[0]);
        }
        viewer = viewers[0];
        return draw(); // Read latest changes, never a pre-fetch snapshot.
      } catch (error) {
        viewers.forEach(v => { if (typeof v.clear === "function") v.clear(); });
        viewers = [];
        viewer = null;
        panels.forEach(panel => { panel.textContent = ""; });
        message(`Structure unavailable: ${error.message} Check WebGL support and call init() to retry.`);
        const retry = status.ownerDocument.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry loading reference structure";
        retry.addEventListener("click", () => { void ensure(); });
        status.appendChild(retry);
        return {applied: false, error: error.message};
      } finally {
        loading = null;
      }
    })();
    const result = await loading;
    // Also clears synchronous failures before the async function first suspends.
    loading = null;
    return result;
  }
  function init(element, statusElement) {
    if (!element || !statusElement) throw new Error("init(container, status) requires two DOM elements.");
    if (container && container !== element) throw new Error("diffMolecule owns one container; reuse the original container.");
    container = element;
    status = statusElement;
    status.setAttribute("aria-live", "polite");
    if (!observer && window.ResizeObserver) {
      observer = new window.ResizeObserver(() => { void resize(); });
      observer.observe(container);
    } else if (!observer) {
      window.addEventListener("resize", () => { void resize(); });
      observer = true;
    }
    return ensure();
  }
  function show(input) {
    ++revision;
    try {
      changes = validate(input);
      selected = null;
    } catch (error) {
      changes = [];
      if (viewer) draw();
      message(`No changes highlighted: ${error.message} Correct the comparison data and call show() again.`);
      return Promise.resolve({applied: false, error: error.message});
    }
    const request = revision;
    if (viewer) return Promise.resolve(draw());
    return ensure().then(result => request === revision ? result : {applied: false, superseded: true});
  }
  function resize() {
    if (viewer && visible()) {
      viewers.forEach(v => { v.resize(); v.render(); });
      return Promise.resolve({applied: true});
    }
    return ensure();
  }
  function locate(position) {
    if (!viewer || !mapped.some(c => c.position === position)) return false;
    selected = position;
    updateSelection();
    // Keep whole chains visible while labels identify the selected site.
    viewers.forEach(fit);
    return true;
  }
  function updateSelection() {
    siteButtons.forEach(({node, position}) =>
      node.setAttribute("aria-pressed", String(position === selected)));
    viewers.forEach((v, index) => {
      if (typeof v.removeAllLabels === "function") v.removeAllLabels();
      for (const change of mapped) {
        const position = change.position;
        // Large comparisons remain readable; the complete identities stay in
        // the keyboard-accessible list, and selecting one reveals its labels.
        if (selected !== null ? position !== selected : mapped.length > 8) continue;
        if (typeof v.addLabel !== "function") continue;
        for (const chain of ["B", "D"]) {
          // Keep labels compact inside paired canvases; the site list and
          // status retain the deposited-residue mapping and limitations.
          v.addLabel(`${index === 0 ? "OLD" : "NEW"} ${index === 0 ? change.from : change.to}${position}`,
          {backgroundColor: labelColors[index], fontColor: "white",
            fontSize: selected === position ? 16 : 11},
          {chain, resi: position - 1, atom: "CA"});
        }
      }
      v.render();
    });
  }
  window.diffMolecule = {init, show, resize, locate};
})();
