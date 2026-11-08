"use strict";

// P68871 canonical sequence, including the cleaved initiator methionine.
// PDBe maps residues 2–147 to 2HHB and 2HBS B/D author residues 1–146.
(function () {
  const sequence = "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH";
  const aminoAcids = "ACDEFGHIKLMNPQRSTVWY";
  const names = {ALA: "A", CYS: "C", ASP: "D", GLU: "E", PHE: "F", GLY: "G",
    HIS: "H", ILE: "I", LYS: "K", LEU: "L", MET: "M", ASN: "N", PRO: "P",
    GLN: "Q", ARG: "R", SER: "S", THR: "T", VAL: "V", TRP: "W", TYR: "Y"};
  const status = document.getElementById("molecule-status");
  const controls = ["molecule-all", "molecule-beta", "molecule-rotate",
    "molecule-zoom-in", "molecule-zoom-out"].map(id => document.getElementById(id));
  let viewer, residues, structure = "2HHB", switchSequence = 0;

  function defaultStatus() {
    return `Loaded ${structure} locally (chains A–D). Independently deposited experimental structure; drag to rotate.`;
  }

  function baseStyle() {
    viewer.setStyle({chain: ["A", "C"]}, {cartoon: {color: "#83a9ef"}});
    viewer.setStyle({chain: ["B", "D"]}, {cartoon: {color: "#91e0c4"}});
    viewer.setStyle({resn: "HEM"}, {stick: {colorscheme: "Jmol", radius: 0.18}});
  }
  function requireViewer() {
    if (!viewer || !residues) throw new Error("Molecular viewer is not ready.");
  }
  function clearHighlight() {
    requireViewer();
    baseStyle();
    status.textContent = defaultStatus();
    viewer.render();
  }
  function highlightResidue({position, reference, alternate} = {}) {
    requireViewer();
    // Invalid requests must not leave an older selection appearing current.
    clearHighlight();
    try {
      if (!Number.isInteger(position) || position < 1 || position > sequence.length)
        throw new Error("Position must be a 1-based P68871 position from 1 to 147.");
      if (typeof reference !== "string" || reference.length !== 1 || !aminoAcids.includes(reference))
        throw new Error("Reference must be an uppercase one-letter amino acid.");
      if (alternate !== undefined && (typeof alternate !== "string" ||
          alternate.length !== 1 || !aminoAcids.includes(alternate) || alternate === reference))
        throw new Error("Alternate must be a different uppercase one-letter amino acid.");
      if (sequence[position - 1] !== reference)
        throw new Error(`Reference mismatch: P68871 position ${position} is ${sequence[position - 1]}.`);
      if (position === 1)
        throw new Error(`P68871 initiator Met 1 is removed and is not present in ${structure}.`);
      const pdbResidue = position - 1;
      const chains = ["B", "D"];
      const observedResidue = structure === "2HBS" && position === 7 ? "V" : reference;
      for (const chain of chains) {
        if (residues[chain].get(pdbResidue) !== observedResidue)
          throw new Error(`${structure} residue ${chain}:${pdbResidue} is missing or does not match the expected ${observedResidue}.`);
      }
      const selection = {chain: chains, resi: pdbResidue};
      viewer.setStyle(selection, {cartoon: {color: "#ffca55"},
        stick: {colorscheme: "Jmol", radius: 0.3}});
      viewer.zoomTo(selection);
      viewer.render();
      status.textContent = `P68871 reference ${reference}${position}; ${structure} B/D:${pdbResidue} is ${observedResidue}` +
        (observedResidue !== reference ? ` (differs from reference ${reference})` : "") +
        (alternate ? `; proposed ${reference}${position}${alternate} (annotation only)` : "") +
        ". Deposited experimental coordinates unchanged; no structure predicted from the proposal.";
      return {position, reference, alternate: alternate ?? null, pdbResidue, chains, structure, observedResidue};
    } catch (error) {
      status.textContent = `No residue selected: ${error.message}`;
      throw error;
    }
  }
  function resize() {
    requireViewer();
    viewer.resize();
    viewer.render();
  }
  async function loadStructure(id) {
      const response = await fetch(`/structures/${id.toLowerCase()}.pdb`);
      if (!response.ok) throw new Error("The local structure could not be loaded.");
      const pdb = await response.text();
      if (!pdb.includes(id) || !pdb.includes("\nATOM  "))
        throw new Error("The local structure file is invalid.");
      const observed = {B: new Map(), D: new Map()};
      for (const line of pdb.split("\n")) {
        if (!line.startsWith("ATOM  ")) continue;
        const chain = line.slice(21, 22);
        if (!observed[chain] || line.slice(26, 27).trim()) continue;
        const number = Number(line.slice(22, 26).trim());
        const residue = names[line.slice(17, 20)];
        if (number >= 1 && number <= 146 && residue) {
          const previous = observed[chain].get(number);
          observed[chain].set(number, previous && previous !== residue ? "?" : residue);
        }
      }
      // 2HBS contains two tetramers; retain only the comparable A–D tetramer,
      // including its hemes and waters, rather than merely hiding extra chains.
      const filtered = pdb.split("\n").filter(line =>
        !["ATOM  ", "HETATM", "ANISOU", "TER   "].includes(line.slice(0, 6)) ||
        ["A", "B", "C", "D"].includes(line.slice(21, 22))).join("\n");
      if (!observed.B.size || !observed.D.size)
        throw new Error(`The local ${id} structure is missing beta chains B or D.`);
      return {pdb: filtered, observed};
  }
  async function selectStructure(id) {
    if (id !== "2HHB" && id !== "2HBS")
      throw new Error("Structure must be 2HHB or 2HBS.");
    const request = ++switchSequence;
    await api.ready;
    if (request !== switchSequence) return {applied: false, structure: id};
    let loaded;
    try {
      loaded = await loadStructure(id);
    } catch (error) {
      if (request !== switchSequence) return {applied: false, structure: id};
      status.textContent = `Could not load ${id}: ${error.message} Still showing ${structure}.`;
      throw error;
    }
    if (request !== switchSequence) return {applied: false, structure: id};
    viewer.removeAllModels();
    viewer.addModel(loaded.pdb, "pdb");
    residues = loaded.observed;
    structure = id;
    baseStyle();
    viewer.zoomTo();
    viewer.render();
    status.textContent = defaultStatus();
    return {applied: true, structure: id};
  }
  // Install synchronously so callers can await readiness even while fetch is pending.
  const api = {highlightResidue, clearHighlight, resize, selectStructure, ready: null};
  window.hbbMolecule = api;
  api.ready = (async () => {
    try {
      if (!window.$3Dmol) throw new Error("The molecular viewer library is unavailable.");
      const loaded = await loadStructure("2HHB");
      viewer = window.$3Dmol.createViewer(document.getElementById("molecule-view"),
        {backgroundColor: "#0c131f"});
      if (!viewer) throw new Error("WebGL is unavailable.");
      viewer.addModel(loaded.pdb, "pdb");
      residues = loaded.observed;
      baseStyle();
      const whole = () => { viewer.zoomTo(); viewer.render(); };
      controls[0].addEventListener("click", whole);
      controls[1].addEventListener("click", () => { viewer.zoomTo({chain: ["B", "D"]}); viewer.render(); });
      controls[2].addEventListener("click", () => { viewer.rotate(30, "y"); viewer.render(); });
      controls[3].addEventListener("click", () => { viewer.zoom(1.2); viewer.render(); });
      controls[4].addEventListener("click", () => { viewer.zoom(1 / 1.2); viewer.render(); });
      window.addEventListener("resize", resize);
      whole();
      controls.forEach(control => { control.disabled = false; });
      status.textContent = defaultStatus();
    } catch (error) {
      viewer = null;
      residues = null;
      status.textContent = `Structure unavailable: ${error.message} Check WebGL support and reload.`;
      throw error;
    }
  })();
  // Avoid an unhandled rejection when no integration consumer is present.
  api.ready.catch(() => {});
})();
