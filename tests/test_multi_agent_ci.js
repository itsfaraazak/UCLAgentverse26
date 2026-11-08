"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.id = "";
    this.type = "";
    this.value = "";
    this.placeholder = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.width = 480;
    this.height = 100;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }
  getAttribute(k) {
    return this.attributes.get(k);
  }
  append(...nodes) {
    for (const n of nodes) {
      if (n) this.children.push(n);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }
  dispatch(event, payload = {}) {
    const handlers = this.listeners.get(event) || [];
    for (const h of handlers) h({preventDefault() {}, ...payload});
  }
  querySelector(selector) {
    const tag = selector.toUpperCase();
    for (const child of this.children) {
      if (child.tagName === tag) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
  getContext() {
    return {
      clearRect() {},
      fillRect() {},
      fillText() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
      stroke() {},
      save() {},
      restore() {},
      translate() {},
      arc() {},
      ellipse() {},
    };
  }
}

function collectText(node) {
  let out = node.textContent || "";
  for (const child of node.children || []) {
    out += " " + collectText(child);
  }
  return out;
}

async function runTest() {
  const sampleRun = {
    run_id: "ci-0001-abcdef12",
    branch: "main",
    head_commit: "1234567890abcdef1234567890abcdef12345678",
    screen: {
      verdict: "escalate",
      category: "GERMLINE_HERITABLE",
      requires_signoff: "institutional_biosafety_committee",
      redacted: false,
      summary: "Heritable germline edit requires IBC sign-off.",
    },
    genotype: {
      allele_id: "HbS",
      allele_name: "HbS · Sickle Variant",
      polymerization_tendency: 0.9,
      three_register_diff: {
        changed_codons: [
          {
            codon_index: 6,
            position: 7,
            mature_position: 6,
            exon: 1,
            ref_codon: "GAG",
            alt_codon: "GTG",
            ref_aa: "E",
            alt_aa: "V",
            status: "modified",
            silent: false,
          },
        ],
        codon_window: [],
      },
    },
    assay: {
      pO2: 95,
      occlusion: 0.12,
      mean_flow: 1.05,
      sickled_fraction: 0.08,
      passed: true,
      snapshot: {
        walls: [{x: 0, top: 10, bottom: 90}, {x: 480, top: 10, bottom: 90}],
        cells: [{id: 0, x: 120, y: 50, vx: 1.0, radius: 6.5, sickled: true, jammed: false}],
      },
    },
    collaboration: [
      {
        specialist_id: "StructuralBiophysicsAgent",
        title: "Structural Biophysics Specialist",
        stance: "challenge",
        target_agent: "StructuralImpactAgent",
        summary: "Challenges monomer-only assessment due to deoxy-Hb fibre contacts.",
      },
    ],
    verdict: {
      passed: false,
      blocked: false,
      merge_allowed: false,
      requires_signoff: true,
      signoff_role: "institutional_biosafety_committee",
      signed_off_by: null,
      disagreed_with_assay: true,
      disagreed_with_structural: true,
      reasons: ["VerifierAgent refuted normoxic assay under venous hypoxia."],
      hypoxic_verification: {
        pO2: 10,
        occlusion: 0.62,
        mean_flow: 0.34,
        sickled_fraction: 0.85,
        wt_baseline_flow: 1.08,
        failed: true,
      },
    },
    agent_steps: [
      {step: 1, agent_id: "IntentAgent", role: "Intent Parser", status: "PASS", delta_id: "d1", summary: "Parsed intent"},
      {step: 2, agent_id: "BiosafetyGateAgent", role: "Biosafety Gate", status: "ESCALATE", delta_id: "d2", summary: "Escalated"},
    ],
    dag: {
      size: 2,
      deltas: [
        {id: "d100000000000000", agent_id: "IntentAgent", kind: "intent", parents: [], payload: {summary: "Parsed intent"}},
        {id: "d200000000000000", agent_id: "VerifierAgent", kind: "verdict", parents: ["d100000000000000"], payload: {summary: "Forked verdict"}},
      ],
      forks: [
        {
          parent: "d100000000000000",
          parent_agent: "StructuralImpactAgent",
          children: ["d200000000000000"],
          child_agents: ["FunctionalAssayAgent", "VerifierAgent"],
        },
      ],
      heads: ["d200000000000000"],
    },
  };

  const calls = [];
  const windowObj = {};
  const documentObj = {
    createElement: tag => new FakeElement(tag),
  };
  const sandbox = {
    window: windowObj,
    document: documentObj,
    fetch: async (url, opts = {}) => {
      calls.push({url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null});
      return {
        ok: true,
        json: async () => sampleRun,
      };
    },
  };

  const code = fs.readFileSync(path.join(__dirname, "..", "web", "multi_agent_ci.js"), "utf8");
  vm.runInNewContext(code, sandbox);

  assert.equal(typeof windowObj.MultiAgentCI?.mount, "function");
  const container = new FakeElement("div");
  const instance = windowObj.MultiAgentCI.mount(container, {getBranch: () => "main"});
  assert.ok(instance);

  await instance.runPipeline();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/ci/run");
  assert.equal(calls[0].body.branch, "main");

  const renderedText = collectText(container);
  assert.match(renderedText, /StructuralBiophysicsAgent/);
  assert.match(renderedText, /GAG → GTG/);
  assert.match(renderedText, /Disagreement Fork Detected in DeltaDAG/);
  assert.match(renderedText, /institutional_biosafety_committee/);
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
