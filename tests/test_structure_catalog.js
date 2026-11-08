"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const catalog = require("../web/structure_catalog.js");

assert.deepEqual(Object.keys(catalog), ["2HHB", "2HBS"]);
assert.ok(Object.isFrozen(catalog));
for (const [id, entry] of Object.entries(catalog)) {
  assert.equal(entry.id, id);
  assert.equal(entry.path, `/structures/${id.toLowerCase()}.pdb`);
  assert.ok(Object.isFrozen(entry.beta6.chains));
  const data = fs.readFileSync(`web${entry.path}`);
  assert.equal(crypto.createHash("sha256").update(data).digest("hex"), entry.sha256);
  const lines = data.toString("ascii").split("\n");
  assert.ok(lines.some(line => line.startsWith("HEADER") && line.includes(id)));
  assert.ok(lines.some(line => line.startsWith("EXPDTA") && line.includes("X-RAY DIFFRACTION")));
  assert.ok(lines.some(line => line.startsWith("REMARK   2 RESOLUTION.") &&
    line.includes(entry.resolutionAngstrom.toFixed(2))));
  const atoms = lines.filter(line => line.startsWith("ATOM  "));
  assert.deepEqual([...new Set(atoms.map(line => line[21]))].sort(),
    [...entry.alphaChains, ...entry.betaChains].sort());
  assert.deepEqual(entry.comparisonChains, ["A", "B", "C", "D"]);
  for (const chain of entry.beta6.chains) {
    assert.ok(atoms.some(line => line[21] === chain &&
      Number(line.slice(22, 26)) === entry.beta6.residueNumber &&
      line[26] === " " && line.slice(12, 16).trim() === "CA" &&
      line.slice(17, 20) === entry.beta6.residueName), `${id} ${chain} beta 6`);
  }
  assert.deepEqual(entry.beta6.chains, entry.betaChains);
}
assert.equal(catalog["2HHB"].beta6.residueName, "GLU");
assert.equal(catalog["2HBS"].beta6.residueName, "VAL");
assert.deepEqual(catalog["2HHB"].betaChains, ["B", "D"]);
assert.deepEqual(catalog["2HBS"].betaChains, ["B", "D", "F", "H"]);
const sickle = fs.readFileSync("web/structures/2hbs.pdb", "ascii");
for (const chain of ["B", "D", "F", "H"]) {
  assert.match(sickle, new RegExp(`SEQADV 2HBS VAL ${chain}    6  UNP  P68871    GLU     6 VARIANT`));
}
const browser = {};
vm.runInNewContext(fs.readFileSync("web/structure_catalog.js", "utf8"), browser);
assert.equal(browser.StructureCatalog["2HBS"].path, "/structures/2hbs.pdb");
assert.ok(Object.isFrozen(browser.StructureCatalog["2HBS"]));
assert.throws(() => { catalog["2HBS"].betaChains.push("Z"); }, TypeError);
console.log("Structure catalog and deposited coordinate checks passed");
