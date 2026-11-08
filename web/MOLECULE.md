# HBB molecular context

This viewer helps an evidence reviewer locate HBB-encoded beta-globin within
the human hemoglobin complex. It shows fixed experimental structures, independent of the
workspace's synthetic artifact and any gene record. It can annotate a proposed
single amino-acid substitution, but does not model it, predict effects, or support clinical or experimental
decisions. It depicts crystallographic deoxygenated states, not dynamics or
all physiological states; unresolved or uncertain features are not inferred.

## Frontend API and indexing

`molecule.js` installs `window.hbbMolecule` synchronously. Once its `ready`
promise resolves, call for example:

```js
await window.hbbMolecule.ready;
const mapping = window.hbbMolecule.highlightResidue({
  position: 7, reference: "E", alternate: "V"
});
// mapping includes structure: "2HHB", observedResidue: "E",
// pdbResidue: 6, chains: ["B", "D"] and the inputs.
await window.hbbMolecule.selectStructure("2HBS");
// The same request now highlights the deposited V at B/D:6.
window.hbbMolecule.highlightResidue({position: 7, reference: "E", alternate: "V"});
```

Positions are **1-based canonical UniProt P68871**, including initiator Met;
they are not zero-based indices, nucleotide coordinates, or mature-chain
numbering. `reference` and optional `alternate` are uppercase one-letter
standard amino acids; an alternate must differ from the reference. Position 1
is not represented in either structure. The API throws on invalid inputs, mismatches,
missing native coordinates, or calls before readiness; failed selections
clear the prior highlight. `ready` rejects on initialization failure.
`clearHighlight()` restores the native view's styles and `resize()` updates
the viewer after its container becomes visible. Neither changes coordinates.
`selectStructure("2HHB" | "2HBS")` waits for initial readiness, fetches the
local file, and returns `{applied: true, structure}` on success; the latest
request wins and superseded calls return `{applied: false, structure}`.
Load failures reject and preserve the previously displayed structure.
Successful switching clears the previous highlight; callers can apply it again.
Only chains A–D are loaded, including their hemes and waters.

According to PDBe's [2HHB](https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/2hhb)
and [2HBS](https://www.ebi.ac.uk/pdbe/api/mappings/uniprot/2hbs) mappings,
P68871 positions 2–147 map to author residues 1–146 in both beta chains B and
D, with no insertion codes. [UniProt P68871](https://www.uniprot.org/uniprotkb/P68871/entry)
identifies Met 1 as removed and the mature chain as 2–147. Thus P68871 Glu 7
is 2HHB Glu 6, not residue 7. Independently deposited 2HBS has Val 6 at this
site in both beta chains, as documented by [RCSB](https://www.rcsb.org/structure/2HBS).
The viewer verifies that both chains contain the expected deposited residue
before highlighting; the sole allowed reference difference is 2HBS E7V. The
proposed alternate is text only: highlighted atoms and coordinates remain
those of the selected experiment, not a model derived from the proposal. This mapping applies only to this
reference sequence and structure; callers must independently establish that
their sequence and numbering correspond.

The locally bundled, unmodified PDB file is
[2HHB](https://www.rcsb.org/structure/2HHB), downloaded from
https://files.rcsb.org/download/2HHB.pdb. SHA-256:
`d04b447c1177616e37d39e5af23b44d6aa85b5de74ed7ead84e1f0f5ff1fd40d`.
Fermi G, Perutz MF, Shaanan B, Fourme R. *The crystal structure of human
deoxyhaemoglobin at 1.74 Å resolution*. J Mol Biol 175:159–174 (1984).
[DOI: 10.1016/0022-2836(84)90472-8](https://doi.org/10.1016/0022-2836(84)90472-8).
The PDB record identifies alpha chains A and C and beta chains B and D.
PDB archive data is [CC0 1.0](https://www.rcsb.org/pages/policies).

The separately supplied [2HBS](https://www.rcsb.org/structure/2HBS) file is
an experimental deoxyhemoglobin S structure, not a calculation from user
edits. Harrington DJ, Adachi K, Royer WE Jr. *The high resolution crystal
structure of deoxyhemoglobin S*. J Mol Biol 272:398–407 (1997),
[DOI: 10.1006/jmbi.1997.1253](https://doi.org/10.1006/jmbi.1997.1253).
The deposited asymmetric unit includes chains A–H; this viewer limits the
comparison to A–D and does not align the two experimental structures.

The viewer uses [3Dmol.js 2.5.3](https://3dmol.org/) locally, downloaded from
https://unpkg.com/3dmol@2.5.3/build/3Dmol-min.js; SHA-256
`bcf422137a34b4e206413a8a83a67c24a1ace84e282bf3b164f6bda6aeb42a20`.
Its BSD-3-Clause and incorporated component notices are in
`vendor/3Dmol-LICENSE.txt`. Cite 3Dmol.js: Rego N, Koes D, Bioinformatics 31,
1322–1324 (2015), https://doi.org/10.1093/bioinformatics/btu829.

Run `python3 backend/server.py`, open the local page, and scroll to molecular
context. Drag or use buttons to rotate, zoom, focus on beta chains, or reset.
`molecule.js` fetches only `/structures/2hhb.pdb` and `/structures/2hbs.pdb` and calls the local 3Dmol.js
`createViewer`, `addModel`, `setStyle`, `zoomTo`, `rotate`, `zoom`, and `render`
APIs; there is no new backend API or live RCSB request. Both assets are local,
and the server's CSP is unchanged. Browser rendering under that CSP still needs
an end-to-end WebGL check. 3Dmol also contains
optional string callback evaluation and worker-based surface rendering; this
viewer uses neither and does not request `unsafe-eval` or `blob:` workers.
WebGL is required; failures are reported in the panel. External citation links
require connectivity. The existing security policy blocks external font imports,
so the page uses system font fallbacks.
