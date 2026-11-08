"use strict";

// Fixed local deposited coordinate files; no user sequence is used to generate them.
// Chain IDs and residue numbers below are legacy PDB author identifiers.
// The 2HBS asymmetric unit contains two tetramers; comparisonChains selects
// one tetramer without discarding the other from the deposited coordinates.
(function (root) {
  const catalog = {
    "2HHB": {
      id: "2HHB",
      label: "Deoxyhemoglobin A",
      path: "/structures/2hhb.pdb",
      format: "pdb",
      description: "Experimentally determined human deoxyhemoglobin A.",
      method: "X-ray diffraction",
      resolutionAngstrom: 1.74,
      alphaChains: ["A", "C"],
      betaChains: ["B", "D"],
      comparisonChains: ["A", "B", "C", "D"],
      beta6: {residueNumber: 6, residueName: "GLU", chains: ["B", "D"]},
      sourceUrl: "https://www.rcsb.org/structure/2HHB",
      downloadUrl: "https://files.rcsb.org/download/2HHB.pdb",
      entryDoi: "https://doi.org/10.2210/pdb2hhb/pdb",
      citation: "Fermi et al. (1984), J Mol Biol 175:159–174, https://doi.org/10.1016/0022-2836(84)90472-8",
      license: "CC0-1.0",
      licenseUrl: "https://www.rcsb.org/pages/policies",
      sha256: "d04b447c1177616e37d39e5af23b44d6aa85b5de74ed7ead84e1f0f5ff1fd40d"
    },
    "2HBS": {
      id: "2HBS",
      label: "Deoxyhemoglobin S",
      path: "/structures/2hbs.pdb",
      format: "pdb",
      description: "Separately deposited experimental deoxyhemoglobin S, not computed from user edits.",
      method: "X-ray diffraction",
      resolutionAngstrom: 2.05,
      alphaChains: ["A", "C", "E", "G"],
      betaChains: ["B", "D", "F", "H"],
      comparisonChains: ["A", "B", "C", "D"],
      beta6: {residueNumber: 6, residueName: "VAL", chains: ["B", "D", "F", "H"]},
      sourceUrl: "https://www.rcsb.org/structure/2HBS",
      downloadUrl: "https://files.rcsb.org/download/2HBS.pdb",
      entryDoi: "https://doi.org/10.2210/pdb2hbs/pdb",
      citation: "Harrington, Adachi and Royer (1997), J Mol Biol 272:398–407, https://doi.org/10.1006/jmbi.1997.1253",
      license: "CC0-1.0",
      licenseUrl: "https://www.rcsb.org/pages/policies",
      sha256: "b552883a48cd11bf8bc86785cc7ab5e49203e4c0dae922aaf2cc489421cd5c09"
    }
  };

  // PDB archive data are dedicated to the public domain under CC0 1.0:
  // https://www.rcsb.org/pages/policies. The hashes identify the bundled
  // snapshots; the current download may change as archive entries are revised.
  // Beta 6 uses mature globin numbering (UniProt P68871 precursor position 7).
  // Different crystals are not a controlled before/after experiment: their
  // observed differences cannot all be attributed to the E6V substitution.
  function freezeDeep(value) {
    Object.values(value).forEach(child => {
      if (child && typeof child === "object") freezeDeep(child);
    });
    return Object.freeze(value);
  }
  freezeDeep(catalog);
  if (typeof module !== "undefined" && module.exports) module.exports = catalog;
  else root.StructureCatalog = catalog;
})(typeof globalThis !== "undefined" ? globalThis : this);
