"use strict";
// Exercise integration and real PDB mapping without claiming to test WebGL.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const code = fs.readFileSync("web/molecule.js", "utf8");
const pdb = fs.readFileSync("web/structures/2hhb.pdb", "utf8");
const sequence = "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH";

async function setup({fail = false, structure = pdb, fetchOverride} = {}) {
  const elements = {};
  for (const id of ["molecule-status", "molecule-view", "molecule-all", "molecule-beta",
    "molecule-rotate", "molecule-zoom-in", "molecule-zoom-out"]) {
    elements[id] = {disabled: true, addEventListener: (name, fn) => { elements[id][name] = fn; }};
  }
  const calls = [], viewer = {};
  for (const name of ["addModel", "removeAllModels", "setStyle", "zoomTo", "render", "rotate", "zoom", "resize"]) {
    viewer[name] = (...args) => { calls.push([name, ...args]); };
  }
  const window = {$3Dmol: {createViewer: () => viewer}, addEventListener: () => {}};
  const context = {document: {getElementById: id => elements[id]}, window,
    fetch: fetchOverride || (async path => {
      assert.ok(["/structures/2hhb.pdb", "/structures/2hbs.pdb"].includes(path));
      return {ok: !fail, text: async () => structure};
    })};
  vm.runInNewContext(code, context);
  return {api: window.hbbMolecule, elements, calls};
}

(async () => {
  const {api, elements, calls} = await setup();
  await api.ready;
  assert.match(elements["molecule-status"].textContent, /Loaded 2HHB/);
  assert.equal(elements["molecule-beta"].disabled, false);
  elements["molecule-beta"].click();
  assert.deepEqual(Array.from(calls.filter(call => call[0] === "zoomTo").at(-1)[1].chain), ["B", "D"]);
  elements["molecule-rotate"].click();
  assert.ok(calls.some(call => call[0] === "rotate" && call[1] === 30));
  for (let position = 2; position <= 147; position++) {
    const result = api.highlightResidue({position, reference: sequence[position - 1]});
    assert.equal(result.pdbResidue, position - 1);
    assert.deepEqual(Array.from(result.chains), ["B", "D"]);
  }
  const beforeModels = calls.filter(call => call[0] === "addModel").length;
  api.highlightResidue({position: 7, reference: "E", alternate: "V"});
  const selected = calls.filter(call => call[0] === "setStyle").at(-1);
  assert.equal(selected[1].resi, 6);
  assert.deepEqual(Array.from(selected[1].chain), ["B", "D"]);
  assert.match(elements["molecule-status"].textContent, /proposed E7V \(annotation only\).*coordinates unchanged/);
  assert.equal(calls.filter(call => call[0] === "addModel").length, beforeModels);
  for (const request of [
    {position: 1, reference: "M"}, {position: 0, reference: "M"},
    {position: 148, reference: "H"}, {position: 7.5, reference: "E"},
    {position: 7, reference: "V"}, {position: 7, reference: "E", alternate: "*"},
    {position: 7, reference: "E", alternate: "E"}, {position: 7, reference: "e"}
  ]) {
    assert.throws(() => api.highlightResidue(request));
    assert.match(elements["molecule-status"].textContent, /No residue selected/);
  }
  api.clearHighlight();
  api.resize();
  assert.equal(calls.filter(call => call[0] === "resize").length, 1);
  const missing = await setup({structure: pdb.split("\n").filter(line =>
    !(line.startsWith("ATOM  ") && line.slice(21, 26) === "D   6")).join("\n")});
  await missing.api.ready;
  assert.throws(() => missing.api.highlightResidue({position: 7, reference: "E"}), /missing/);
  const failed = await setup({fail: true});
  await assert.rejects(failed.api.ready, /could not be loaded/);
  assert.match(failed.elements["molecule-status"].textContent, /unavailable/);
  assert.equal(failed.elements["molecule-beta"].disabled, true);

  // Synthetic second fixture exercises switching independently of the separately
  // supplied 2HBS asset; the real structure can be supplied via HBS_TEST_PDB.
  const hbs = process.env.HBS_TEST_PDB ? fs.readFileSync(process.env.HBS_TEST_PDB, "utf8") :
    pdb.replaceAll("2HHB", "2HBS").split("\n").map(line =>
      line.startsWith("ATOM  ") && ["B", "D"].includes(line[21]) &&
        Number(line.slice(22, 26)) === 6 ? line.slice(0, 17) + "VAL" + line.slice(20) : line
    ).join("\n") + "\nATOM      1  N   GLU F   6      16.354  -7.934  42.428  1.00 44.88           N  \n";
  let resolveSlow;
  let slow = false;
  const switched = await setup({fetchOverride: async path => {
    if (slow && path.includes("2hbs")) return new Promise(resolve => { resolveSlow = resolve; });
    return {ok: true, text: async () => path.includes("2hbs") ? hbs : pdb};
  }});
  await switched.api.ready;
  assert.equal((await switched.api.selectStructure("2HBS")).applied, true);
  const actual = switched.api.highlightResidue({position: 7, reference: "E", alternate: "V"});
  assert.equal(actual.structure, "2HBS");
  assert.equal(actual.observedResidue, "V");
  assert.match(switched.elements["molecule-status"].textContent, /2HBS B\/D:6 is V \(differs from reference E\)/);
  assert.match(switched.elements["molecule-status"].textContent, /proposed E7V \(annotation only\)/);
  for (let position = 2; position <= 147; position++)
    switched.api.highlightResidue({position, reference: sequence[position - 1]});
  const model = switched.calls.filter(call => call[0] === "addModel").at(-1)[1];
  assert.equal(model.split("\n").filter(line => line.startsWith("ATOM  ") &&
    !["A", "B", "C", "D"].includes(line[21])).length, 0);
  assert.equal((await switched.api.selectStructure("2HHB")).applied, true);
  assert.equal(switched.api.highlightResidue({position: 7, reference: "E"}).observedResidue, "E");
  await assert.rejects(switched.api.selectStructure("unknown"), /must be/);
  slow = true;
  const old = switched.api.selectStructure("2HBS");
  await Promise.resolve();
  const recent = switched.api.selectStructure("2HHB");
  assert.equal((await recent).applied, true);
  resolveSlow({ok: true, text: async () => hbs});
  assert.equal((await old).applied, false);
  assert.equal(switched.api.highlightResidue({position: 7, reference: "E"}).structure, "2HHB");

  const unavailable = await setup({fetchOverride: async path => path.includes("2hbs") ?
    {ok: false} : {ok: true, text: async () => pdb}});
  await unavailable.api.ready;
  await assert.rejects(unavailable.api.selectStructure("2HBS"), /could not be loaded/);
  assert.match(unavailable.elements["molecule-status"].textContent, /Still showing 2HHB/);
  assert.equal(unavailable.api.highlightResidue({position: 7, reference: "E"}).structure, "2HHB");

  const wrongHbs = hbs.split("\n").filter(line =>
    !(line.startsWith("ATOM  ") && line.slice(21, 26) === "D   6")).join("\n");
  const incomplete = await setup({fetchOverride: async path => ({
    ok: true, text: async () => path.includes("2hbs") ? wrongHbs : pdb
  })});
  await incomplete.api.selectStructure("2HBS"); // waits for initial readiness
  assert.throws(() => incomplete.api.highlightResidue({position: 7, reference: "E"}), /missing/);
  console.log("Molecular viewer integration checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
