"""Multi-Agent Collaboration & Multi-Agent CI Pipeline for EditVerse.

Implements:
- Three-register synchronised HBB model (DNA / Codon / Amino Acid) backed by
  NCBI RefSeq NM_000518.5 and UniProtKB P68871.
- Append-only, content-addressed DeltaDAG that records attributed deltas and
  forks when downstream verification or specialist peer agents contradict
  upstream claims.
- Structural BiosafetyGateAgent at pipeline position 2 with a frozen policy
  table, SHA-256 redaction for blocked requests, and a monotonic narrowing
  guard (`narrow_verdict`) so AI narration can never weaken a deterministic
  safety verdict.
- Deterministic headless 2D red-cell capillary flow simulation (`CellSim` and
  `run_assay`) seeded via `Mulberry32`, plus hypoxic stress testing at
  `pO2 = 10 mmHg`.
- Point-based Bayesian ACMG/AMP classification (Tavtigian et al. 2018) and
  actionable reclassification conflict detection.
- Multi-Agent Collaboration round (`StructuralBiophysicsAgent`,
  `ClinicalGeneticsAgent`, `BiosafetyGovernanceAgent`, plus optional Gemini
  specialist synthesis under the narrowing guard) where independent specialist
  agents cross-examine proposed edits, attach peer-review deltas, and vote on
  consensus vs fork.
- Server-side CI Run Store, human-in-the-loop sign-off with server-derived
  roles, delta comments, and branch merge-gate evaluation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
import re
import threading
from typing import Any

try:
    from . import hbb_sequence
    from .git_history import InvalidInput
except ImportError:
    import hbb_sequence
    from git_history import InvalidInput


# ---------------------------------------------------------------------------
# 1. Three-Register Reference Genome Model (NCBI NM_000518.5 / UniProt P68871)
# ---------------------------------------------------------------------------

HBB_ACCESSION = "NM_000518.5"
HBB_LOCUS = "chr11:5,225,464-5,227,071 (GRCh38, reverse strand)"

# 148 codons (147 amino-acid codons matching P68871 + TAA stop codon)
HBB_REF_CDS = (
    "ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAAC"
    "GTGGATGAAGTTGGTGGTGAGGCCCTGGGCAGGCTGCTGGTGGTCTACCCTTGGACCCAG"
    "AGGTTCTTTGAGTCCTTTGGGGATCTGTCCACTCCTGATGCTGTTATGGGCAACCCTAAG"
    "GTGAAGGCTCATGGCAAGAAAGTGCTCGGTGCCTTTAGTGATGGCCTGGCTCACCTGGAC"
    "AACCTCAAGGGCACCTTTGCCACACTGAGTGAGCTGCACTGTGACAAGCTGCACGTGGAT"
    "CCTGAGAACTTCAGGCTCCTGGGCAACGTGCTGGTCTGTGTGCTGGCCCATCACTTTGGC"
    "AAAGAATTCACCCCACCAGTGCAGGCTGCCTATCAGAAAGTGGTGGCTGGTGTGGCTAAT"
    "GCCCTGGCCCACAAGTATCACTAA"
)

HBB_EXONS = (
    {"index": 1, "name": "Exon 1", "start_codon": 0, "end_codon": 30},
    {"index": 2, "name": "Exon 2", "start_codon": 30, "end_codon": 104},
    {"index": 3, "name": "Exon 3", "start_codon": 104, "end_codon": 148},
)

CODON_TABLE: dict[str, str] = {
    "TTT": "F", "TTC": "F", "TTA": "L", "TTG": "L",
    "CTT": "L", "CTC": "L", "CTA": "L", "CTG": "L",
    "ATT": "I", "ATC": "I", "ATA": "I", "ATG": "M",
    "GTT": "V", "GTC": "V", "GTA": "V", "GTG": "V",
    "TCT": "S", "TCC": "S", "TCA": "S", "TCG": "S",
    "CCT": "P", "CCC": "P", "CCA": "P", "CCG": "P",
    "ACT": "T", "ACC": "T", "ACA": "T", "ACG": "T",
    "GCT": "A", "GCC": "A", "GCA": "A", "GCG": "A",
    "TAT": "Y", "TAC": "Y", "TAA": "*", "TAG": "*",
    "CAT": "H", "CAC": "H", "CAA": "Q", "CAG": "Q",
    "AAT": "N", "AAC": "N", "AAA": "K", "AAG": "K",
    "GAT": "D", "GAC": "D", "GAA": "E", "GAG": "E",
    "TGT": "C", "TGC": "C", "TGA": "*", "TGG": "W",
    "CGT": "R", "CGC": "R", "CGA": "R", "CGG": "R",
    "AGT": "S", "AGC": "S", "AGA": "R", "AGG": "R",
    "GGT": "G", "GGC": "G", "GGA": "G", "GGG": "G",
}

CANONICAL_AA_CODONS: dict[str, str] = {
    "A": "GCC", "C": "TGC", "D": "GAC", "E": "GAG", "F": "TTC",
    "G": "GGC", "H": "CAC", "I": "ATC", "K": "AAG", "L": "CTG",
    "M": "ATG", "N": "AAC", "P": "CCC", "Q": "CAG", "R": "AGG",
    "S": "TCC", "T": "ACC", "V": "GTG", "W": "TGG", "Y": "TAC",
}

AA_HYDROPHOBICITY: dict[str, float] = {
    "I": 4.5, "V": 4.2, "L": 3.8, "F": 2.8, "C": 2.5,
    "M": 1.9, "A": 1.8, "G": -0.4, "T": -0.7, "S": -0.8,
    "W": -0.9, "Y": -1.3, "P": -1.6, "H": -3.2, "E": -3.5,
    "Q": -3.5, "D": -3.5, "N": -3.5, "K": -3.9, "R": -4.5,
}

AA_CHARGE: dict[str, int] = {
    "D": -1, "E": -1, "K": 1, "R": 1, "H": 1,
}

# Known HBB clinical/biophysical codon presets and polymerization tendencies
KNOWN_HBB_ALLELES: dict[str, dict[str, Any]] = {
    "WT": {
        "id": "WT",
        "name": "HbA · Wildtype Reference",
        "substitutions": [],
        "codon_overrides": {},
        "polymerization_tendency": 0.0,
        "summary": "Normal adult beta-globin (Glu at position 7 / mature beta-6). Soluble in both oxygenated and deoxygenated states.",
    },
    "HbS": {
        "id": "HbS",
        "name": "HbS · Sickle Variant (E7V / mature E6V, GAG→GTG)",
        "substitutions": [{"position": 7, "reference": "E", "alternate": "V"}],
        "codon_overrides": {6: "GTG"},
        "polymerization_tendency": 0.90,
        "summary": "Pathogenic sickle variant (rs334): negatively charged Glu7 is replaced by hydrophobic Val7, creating a sticky donor patch that polymerizes under deoxy-Hb conditions.",
    },
    "HbC": {
        "id": "HbC",
        "name": "HbC · Lysine Variant (E7K / mature E6K, GAG→AAG)",
        "substitutions": [{"position": 7, "reference": "E", "alternate": "K"}],
        "codon_overrides": {6: "AAG"},
        "polymerization_tendency": 0.35,
        "summary": "Charge-reversal variant (Glu7Lys): causes mild crystal formation and red-cell dehydration without acute deoxy-HbS polymerization.",
    },
    "HbA_T87Q": {
        "id": "HbA_T87Q",
        "name": "HbA-T87Q · Anti-Sickling Therapeutic (T88Q / mature T87Q, ACA→CAG)",
        "substitutions": [{"position": 88, "reference": "T", "alternate": "Q"}],
        "codon_overrides": {87: "CAG"},
        "polymerization_tendency": 0.02,
        "summary": "Anti-sickling gamma-like substitution (Thr88Gln / mature Thr87Gln): sterically blocks lateral Val7 acceptor pocket contacts in deoxy-Hb fibres.",
    },
    "HbS_T87Q_Rescue": {
        "id": "HbS_T87Q_Rescue",
        "name": "HbS + T88Q · Second-Site Anti-Sickling Rescue (E7V + T88Q)",
        "substitutions": [
            {"position": 7, "reference": "E", "alternate": "V"},
            {"position": 88, "reference": "T", "alternate": "Q"},
        ],
        "codon_overrides": {6: "GTG", 87: "CAG"},
        "polymerization_tendency": 0.14,
        "summary": "Second-site cis rescue: Gln88 disrupts axial/lateral fibre contacts, suppressing E7V polymerization under moderate hypoxia.",
    },
    "HbE": {
        "id": "HbE",
        "name": "HbE · Splice-Adjacent Variant (E27K / mature E26K, GAG→AAG)",
        "substitutions": [{"position": 27, "reference": "E", "alternate": "K"}],
        "codon_overrides": {26: "AAG"},
        "polymerization_tendency": 0.28,
        "summary": "Structural and cryptic-splice beta-globin variant at Exon 1 boundary (Glu27Lys).",
    },
    "HbO_Arab": {
        "id": "HbO_Arab",
        "name": "HbO-Arab · Surface Charge Variant (E122K / mature E121K, GAA→AAA)",
        "substitutions": [{"position": 122, "reference": "E", "alternate": "K"}],
        "codon_overrides": {121: "AAA"},
        "polymerization_tendency": 0.42,
        "summary": "Exon 3 surface charge reversal (Glu122Lys) that enhances sickling when co-inherited with HbS.",
    },
}


def exon_for_codon(codon_index: int) -> int:
    for exon in HBB_EXONS:
        if exon["start_codon"] <= codon_index < exon["end_codon"]:
            return exon["index"]
    return 3


def preferred_mutant_codon(ref_codon: str, target_aa: str, position_1based: int) -> str:
    """Pick the single-nucleotide or closest biological codon encoding target_aa."""
    codon_idx = position_1based - 1
    if codon_idx == 6 and target_aa == "V":
        return "GTG"
    if codon_idx == 6 and target_aa == "K":
        return "AAG"
    if codon_idx == 26 and target_aa == "K":
        return "AAG"
    if codon_idx == 87 and target_aa == "Q":
        return "CAG"
    if codon_idx == 121 and target_aa == "K":
        return "AAA"
    candidates = [codon for codon, aa in CODON_TABLE.items() if aa == target_aa]
    if not candidates:
        return ref_codon
    # Sort by Hamming distance to ref_codon, then canonical preference
    canonical = CANONICAL_AA_CODONS.get(target_aa, candidates[0])
    candidates.sort(
        key=lambda c: (
            sum(1 for a, b in zip(c, ref_codon) if a != b),
            0 if c == canonical else 1,
            c,
        )
    )
    return candidates[0]


def compute_three_register_diff(
    substitutions: list[dict[str, Any]],
    codon_overrides: dict[int, str] | None = None,
) -> dict[str, Any]:
    """Compute the synchronised DNA / Codon / Amino-Acid three-register diff."""
    overrides = dict(codon_overrides or {})
    sub_by_pos = {int(item["position"]): item for item in substitutions}
    total_codons = len(HBB_REF_CDS) // 3
    all_rows: list[dict[str, Any]] = []
    changed_rows: list[dict[str, Any]] = []
    mutated_cds: list[str] = []

    for codon_idx in range(total_codons):
        pos_1based = codon_idx + 1
        ref_codon = HBB_REF_CDS[codon_idx * 3 : codon_idx * 3 + 3]
        ref_aa = CODON_TABLE.get(ref_codon, "?")
        if codon_idx in overrides:
            alt_codon = overrides[codon_idx]
        elif pos_1based in sub_by_pos:
            alt_codon = preferred_mutant_codon(ref_codon, sub_by_pos[pos_1based]["alternate"], pos_1based)
        else:
            alt_codon = ref_codon
        alt_aa = CODON_TABLE.get(alt_codon, "?")
        mutated_cds.append(alt_codon)
        is_changed = alt_codon != ref_codon or alt_aa != ref_aa
        is_silent = alt_codon != ref_codon and alt_aa == ref_aa
        nt_changes = [
            {
                "cds_position": codon_idx * 3 + i + 1,
                "codon_offset": i + 1,
                "reference": ref_codon[i],
                "alternate": alt_codon[i],
            }
            for i in range(3)
            if ref_codon[i] != alt_codon[i]
        ]
        row = {
            "codon_index": codon_idx,
            "position": pos_1based,
            "mature_position": pos_1based - 1 if pos_1based > 1 else 0,
            "exon": exon_for_codon(codon_idx),
            "ref_codon": ref_codon,
            "alt_codon": alt_codon,
            "ref_aa": ref_aa,
            "alt_aa": alt_aa,
            "status": "modified" if is_changed else "unchanged",
            "silent": is_silent,
            "nucleotide_changes": nt_changes,
        }
        all_rows.append(row)
        if is_changed:
            changed_rows.append(row)

    return {
        "accession": HBB_ACCESSION,
        "protein_accession": hbb_sequence.REFERENCE["accession"],
        "locus": HBB_LOCUS,
        "reference_cds_length": len(HBB_REF_CDS),
        "mutated_cds": "".join(mutated_cds),
        "exons": list(HBB_EXONS),
        "changed_codons": changed_rows,
        "codon_window": _extract_codon_window(all_rows, changed_rows),
    }


def _extract_codon_window(
    all_rows: list[dict[str, Any]],
    changed_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return a compact synchronised codon window around modified sites (plus codon 1-12 baseline)."""
    indices: set[int] = set(range(0, min(10, len(all_rows))))
    for row in changed_rows:
        idx = row["codon_index"]
        for neighbor in range(max(0, idx - 2), min(len(all_rows), idx + 3)):
            indices.add(neighbor)
    return [all_rows[i] for i in sorted(indices)]


# ---------------------------------------------------------------------------
# 2. Append-Only Content-Addressed DeltaDAG
# ---------------------------------------------------------------------------

VALID_DELTA_KINDS = frozenset({
    "intent",
    "screen",
    "edit_plan",
    "structural",
    "assay",
    "offtarget",
    "classification",
    "conflict",
    "peer_review",
    "verdict",
    "therapy_match",
    "comment",
    "signoff",
})


def _canonical_json(value: Any) -> str:
    if value is None or isinstance(value, (bool, int, float, str)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(str(k) for k in value.keys())
        return "{" + ",".join(
            f"{json.dumps(k)}:{_canonical_json(value[k])}" for k in keys
        ) + "}"
    return json.dumps(str(value))


def compute_delta_id(
    agent_id: str,
    kind: str,
    parents: list[str] | tuple[str, ...],
    payload: dict[str, Any],
    created_at: int,
) -> str:
    canonical = _canonical_json({
        "agentId": agent_id,
        "createdAt": created_at,
        "kind": kind,
        "parents": list(parents),
        "payload": payload,
    })
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class Delta:
    id: str
    agent_id: str
    kind: str
    parents: tuple[str, ...]
    created_at: int
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "agent_id": self.agent_id,
            "kind": self.kind,
            "parents": list(self.parents),
            "created_at": self.created_at,
            "payload": dict(self.payload),
        }


class DeltaDAG:
    """Append-only directed acyclic graph of attributed agent deltas."""

    def __init__(self) -> None:
        self._nodes: dict[str, Delta] = {}
        self._order: list[str] = []
        self._counter: int = 0

    @property
    def size(self) -> int:
        return len(self._order)

    def add(
        self,
        agent_id: str,
        kind: str,
        payload: dict[str, Any],
        parents: list[str] | tuple[str, ...] = (),
    ) -> Delta:
        if kind not in VALID_DELTA_KINDS:
            raise ValueError(f"Unsupported delta kind: {kind}")
        parent_tuple = tuple(parents)
        for parent_id in parent_tuple:
            if parent_id not in self._nodes:
                raise ValueError(f"Unknown parent delta '{parent_id}' in DeltaDAG")
        self._counter += 1
        created_at = self._counter
        delta_id = compute_delta_id(agent_id, kind, parent_tuple, payload, created_at)
        if delta_id in self._nodes:
            return self._nodes[delta_id]
        delta = Delta(
            id=delta_id,
            agent_id=agent_id,
            kind=kind,
            parents=parent_tuple,
            created_at=created_at,
            payload=json.loads(json.dumps(payload)),
        )
        self._nodes[delta_id] = delta
        self._order.append(delta_id)
        return delta

    def get(self, delta_id: str) -> Delta | None:
        return self._nodes.get(delta_id)

    def all(self) -> list[Delta]:
        return [self._nodes[i] for i in self._order]

    def by_kind(self, kind: str) -> list[Delta]:
        return [self._nodes[i] for i in self._order if self._nodes[i].kind == kind]

    def heads(self) -> list[Delta]:
        referenced: set[str] = set()
        for delta_id in self._order:
            for parent_id in self._nodes[delta_id].parents:
                referenced.add(parent_id)
        return [self._nodes[i] for i in self._order if i not in referenced]

    def history(self, delta_id: str) -> list[Delta]:
        visited: set[str] = set()
        acc: list[Delta] = []

        def walk(current_id: str) -> None:
            if current_id in visited:
                return
            node = self._nodes.get(current_id)
            if not node:
                return
            visited.add(current_id)
            for parent_id in node.parents:
                walk(parent_id)
            acc.append(node)

        walk(delta_id)
        return acc

    def forks(self) -> list[dict[str, Any]]:
        children_by_parent: dict[str, list[str]] = {}
        for delta_id in self._order:
            node = self._nodes[delta_id]
            for parent_id in node.parents:
                children_by_parent.setdefault(parent_id, []).append(node.id)
        out: list[dict[str, Any]] = []
        for parent_id, children in children_by_parent.items():
            # Ignore simple comment/signoff attachments when computing reasoning forks,
            # or include them with explicit metadata so UI can highlight agent disagreement forks.
            non_annotation_children = [
                cid for cid in children
                if self._nodes[cid].kind not in ("comment", "signoff")
            ]
            if len(non_annotation_children) > 1:
                parent_node = self._nodes.get(parent_id)
                out.append({
                    "parent": parent_id,
                    "parent_agent": parent_node.agent_id if parent_node else "unknown",
                    "parent_kind": parent_node.kind if parent_node else "unknown",
                    "children": non_annotation_children,
                    "child_agents": [self._nodes[cid].agent_id for cid in non_annotation_children],
                })
        return out

    def to_list(self) -> list[dict[str, Any]]:
        return [node.to_dict() for node in self.all()]


# ---------------------------------------------------------------------------
# 3. Structural Biosafety Policy & Monotonic AI Narrowing Guard
# ---------------------------------------------------------------------------

BIOSAFETY_POLICY: dict[str, dict[str, Any]] = {
    "THERAPEUTIC_SOMATIC": {
        "verdict": "allow",
        "requires_signoff": None,
        "summary": "Somatic beta-globin editing within research scope.",
    },
    "TUMOUR_SUPPRESSOR_DISRUPTION": {
        "verdict": "block",
        "requires_signoff": None,
        "summary": "Disrupting tumour-suppressor loci (TP53, RB1, BRCA1/2, PTEN, APC) is blocked by structural biosafety policy.",
    },
    "GERMLINE_HERITABLE": {
        "verdict": "escalate",
        "requires_signoff": "institutional_biosafety_committee",
        "summary": "Heritable germline, zygote, or embryo editing requires Institutional Biosafety Committee (IBC) review and sign-off.",
    },
    "MULTIPLEX_UNJUSTIFIED": {
        "verdict": "escalate",
        "requires_signoff": "principal_investigator",
        "summary": "Unjustified multiplex editing across >= 3 positions elevates chromosomal translocation risk; Principal Investigator sign-off required.",
    },
    "CONSTRUCT_DESIGN_REQUEST": {
        "verdict": "block",
        "requires_signoff": None,
        "summary": "Actionable wet-lab construct design (sgRNA spacers, primers, repair templates, viral vectors, or synthesis-ready oligos) is out of bounds.",
    },
    "PATHOGEN_OR_TOXIN_ENHANCEMENT": {
        "verdict": "block",
        "requires_signoff": None,
        "summary": "Pathogen, viral, or toxin engineering and gain-of-function enhancement are strictly blocked.",
    },
    "OUT_OF_SCOPE": {
        "verdict": "block",
        "requires_signoff": None,
        "summary": "Request falls outside the bounded in-silico HBB research workspace.",
    },
}

FLAGGED_LOCI: dict[str, dict[str, str]] = {
    "HBB": {"gene": "HBB", "category": "therapeutic_target", "note": "Human beta-globin locus (11p15.4)."},
    "TP53": {"gene": "TP53", "category": "tumour_suppressor", "note": "Guardian of the genome; p53 loss drives clonal expansion in edited HSPCs."},
    "RB1": {"gene": "RB1", "category": "tumour_suppressor", "note": "Retinoblastoma tumour suppressor."},
    "BRCA1": {"gene": "BRCA1", "category": "tumour_suppressor", "note": "Homologous recombination DNA repair tumour suppressor."},
    "BRCA2": {"gene": "BRCA2", "category": "tumour_suppressor", "note": "Homologous recombination DNA repair tumour suppressor."},
    "PTEN": {"gene": "PTEN", "category": "tumour_suppressor", "note": "PI3K/AKT pathway tumour suppressor."},
    "APC": {"gene": "APC", "category": "tumour_suppressor", "note": "Wnt signalling tumour suppressor."},
    "CCR5": {"gene": "CCR5", "category": "germline_sensitive", "note": "Chemokine receptor associated with heritable human embryo editing controversy."},
}

_PATTERNS = {
    "pathogen": re.compile(
        r"\b(pathogen|toxin|ricin|anthrax|ebola|smallpox|variola|botulinum|gain[- ]of[- ]function|bioweapon|virulence|transmissibility|pandemic|anthracis|yersinia|marburg|sars[- ]cov)\b",
        re.I,
    ),
    "construct": re.compile(
        r"\b(sgrna|grna|guide\s*rna|pam\s+site|protospacer|spacer\s+sequence|pcr\s+primer|primer\s+pair|oligo\s+sequence|plasmid\s+map|aav\s+vector|lentiviral|lipid\s+nanoparticle|synthesis[- ]ready|wet[- ]lab\s+protocol|cas9\s+rnp\s+protocol|hdr\s+template\s+sequence)\b",
        re.I,
    ),
    "tumour_suppressor": re.compile(
        r"\b(tp53|p53|rb1|brca1|brca2|pten|apc)\b.*\b(knock\s*out|disrupt|silence|inactivate|delete|loss[- ]of[- ]function|frameshift|null|disable|ablate|mutate)\b"
        r"|\b(knock\s*out|disrupt|silence|inactivate|delete|disable|ablate)\b.*\b(tp53|p53|rb1|brca1|brca2|pten|apc)\b",
        re.I,
    ),
    "germline": re.compile(
        r"\b(germline|embryo|zygote|heritable|oocyte|sperm|blastocyst|ivf\s+edit|human\s+cloning|ccr5)\b",
        re.I,
    ),
    "multiplex": re.compile(
        r"\b(multiplex|simultaneous\s+edits|5\s+loci|multiple\s+chromosomes|combinatorial\s+knockout)\b",
        re.I,
    ),
}

_VERDICT_SEVERITY = {"allow": 0, "escalate": 1, "block": 2}


def narrow_verdict(structural_verdict: str, secondary_verdict: str | None) -> str:
    """Monotonic narrowing guard: secondary/AI verdicts can tighten (`allow` -> `escalate` -> `block`), never loosen."""
    if structural_verdict not in _VERDICT_SEVERITY:
        raise ValueError(f"Unknown structural verdict: {structural_verdict}")
    if not secondary_verdict or secondary_verdict not in _VERDICT_SEVERITY:
        return structural_verdict
    if _VERDICT_SEVERITY[secondary_verdict] > _VERDICT_SEVERITY[structural_verdict]:
        return secondary_verdict
    return structural_verdict


def screen_intent(
    raw_text: str,
    substitutions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run deterministic structural biosafety policy screening."""
    text = (raw_text or "").strip()
    digest = hashlib.sha256(
        f"{text}|{_canonical_json(substitutions)}".encode("utf-8")
    ).hexdigest()[:16]

    matched_loci: list[str] = ["HBB"]
    upper = text.upper()
    for locus in FLAGGED_LOCI:
        if re.search(rf"\b{re.escape(locus)}\b", upper) and locus not in matched_loci:
            matched_loci.append(locus)
    if re.search(r"\bP53\b", upper) and "TP53" not in matched_loci:
        matched_loci.append("TP53")

    category = "THERAPEUTIC_SOMATIC"
    if _PATTERNS["pathogen"].search(text):
        category = "PATHOGEN_OR_TOXIN_ENHANCEMENT"
    elif _PATTERNS["construct"].search(text):
        category = "CONSTRUCT_DESIGN_REQUEST"
    elif _PATTERNS["tumour_suppressor"].search(text) or any(
        loc in matched_loci for loc in ("TP53", "RB1", "BRCA1", "BRCA2", "PTEN", "APC")
    ):
        category = "TUMOUR_SUPPRESSOR_DISRUPTION"
    elif _PATTERNS["germline"].search(text):
        category = "GERMLINE_HERITABLE"
    elif len(substitutions) >= 3 or _PATTERNS["multiplex"].search(text):
        category = "MULTIPLEX_UNJUSTIFIED"

    policy = BIOSAFETY_POLICY[category]
    verdict = policy["verdict"]
    redacted = verdict == "block"

    return {
        "verdict": verdict,
        "category": category,
        "matched_loci": matched_loci,
        "requires_signoff": policy["requires_signoff"],
        "redacted": redacted,
        "request_digest": digest,
        "summary": policy["summary"],
    }


# ---------------------------------------------------------------------------
# 4. Deterministic 2D Red-Cell Capillary Flow Simulation (`CellSim`)
# ---------------------------------------------------------------------------

class Mulberry32:
    """Deterministic 32-bit PRNG matching the JavaScript `mulberry32` algorithm."""

    def __init__(self, seed: int) -> None:
        self._state = seed & 0xFFFFFFFF

    def next_float(self) -> float:
        self._state = (self._state + 0x6D2B79F5) & 0xFFFFFFFF
        t = self._state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


class CellSim:
    """Deterministic 2D red-blood-cell capillary flow model under variable oxygen tension."""

    def __init__(
        self,
        seed: int = 101,
        cell_count: int = 26,
        polymerization_tendency: float = 0.0,
        pO2: float = 95.0,
    ) -> None:
        self.width = 480.0
        self.height = 100.0
        self.constriction = 0.42
        self.sickling_onset_below = 60.0
        self.rng = Mulberry32(seed)
        self.polymerization_tendency = max(0.0, min(1.0, float(polymerization_tendency)))
        self.pO2 = max(10.0, min(100.0, float(pO2)))
        self.tick = 0
        self.cells: list[dict[str, Any]] = []
        for idx in range(cell_count):
            x = (idx / max(1, cell_count)) * self.width + self.rng.next_float() * 8.0
            top, bottom = self.walls_at(x)
            margin = 8.0
            span = max(4.0, (bottom - top) - 2.0 * margin)
            y = top + margin + self.rng.next_float() * span
            self.cells.append({
                "id": idx,
                "x": x % self.width,
                "y": y,
                "vx": 1.1,
                "vy": 0.0,
                "radius": 6.5,
                "sickled": False,
                "jammed": False,
            })

    def walls_at(self, x: float) -> tuple[float, float]:
        center = self.width * 0.52
        sigma = self.width * 0.13
        dx = (x - center) / sigma
        pinch = math.exp(-0.5 * dx * dx) * (self.height * 0.5 * (1.0 - self.constriction))
        top = 8.0 + pinch
        bottom = self.height - 8.0 - pinch
        return top, bottom

    def step(self) -> None:
        self.tick += 1
        hypoxia = max(0.0, min(1.0, (self.sickling_onset_below - self.pO2) / 50.0))
        # Deoxy-Hb polymerization requires hypoxia (pO2 < 60 mmHg) and exhibits a cooperative
        # nucleation barrier in polymerization_tendency.
        poly_coop = self.polymerization_tendency * self.polymerization_tendency
        effective_sickle_prob = poly_coop * hypoxia

        for cell in self.cells:
            # Deterministic sickling / unsickling transition
            roll = self.rng.next_float()
            if hypoxia > 0.0 and roll < effective_sickle_prob * 0.28:
                cell["sickled"] = True
            elif self.pO2 >= 65.0 or roll < 0.14 * (1.0 - poly_coop * hypoxia):
                cell["sickled"] = False

            top, bottom = self.walls_at(cell["x"])
            channel_half = max(6.0, (bottom - top) * 0.5)
            mid_y = (top + bottom) * 0.5
            radial = min(1.0, abs(cell["y"] - mid_y) / channel_half)
            # Hagen-Poiseuille parabolic profile
            base_drive = 1.65 * (1.0 - 0.55 * radial * radial)
            deformability = 0.26 if cell["sickled"] else 0.92

            # Constriction impedance for rigid sickled cells
            in_throat = abs(cell["x"] - self.width * 0.52) < self.width * 0.16
            throat_drag = 0.22 if (cell["sickled"] and in_throat) else (0.78 if cell["sickled"] else 1.0)
            target_vx = base_drive * throat_drag * (0.45 + 0.55 * deformability)

            cell["vx"] = 0.72 * cell["vx"] + 0.28 * target_vx
            cell["vy"] = (mid_y - cell["y"]) * (0.04 if cell["sickled"] else 0.09)

        # Pairwise collision & rigid-fibre jamming in the capillary throat
        n = len(self.cells)
        for i in range(n):
            ci = self.cells[i]
            ci["jammed"] = False
            for j in range(i + 1, n):
                cj = self.cells[j]
                dx = cj["x"] - ci["x"]
                dy = cj["y"] - ci["y"]
                dist_sq = dx * dx + dy * dy
                min_dist = ci["radius"] + cj["radius"]
                if 0.0001 < dist_sq < min_dist * min_dist:
                    dist = math.sqrt(dist_sq)
                    overlap = (min_dist - dist) * 0.5
                    nx = dx / dist
                    ny = dy / dist
                    ci["x"] -= nx * overlap * 0.6
                    cj["x"] += nx * overlap * 0.6
                    ci["y"] -= ny * overlap * 0.6
                    cj["y"] += ny * overlap * 0.6
                    if ci["sickled"] and cj["sickled"]:
                        ci["vx"] *= 0.35
                        cj["vx"] *= 0.35
                        ci["jammed"] = True
                        cj["jammed"] = True
                    elif ci["sickled"] or cj["sickled"]:
                        ci["vx"] *= 0.62
                        cj["vx"] *= 0.62

        # Advance positions & enforce wall boundaries
        for cell in self.cells:
            if cell["sickled"] and abs(cell["x"] - self.width * 0.52) < self.width * 0.13:
                if self.polymerization_tendency >= 0.55 and hypoxia >= 0.45:
                    cell["vx"] *= 0.28
                    cell["jammed"] = True
            cell["x"] = (cell["x"] + max(0.02, cell["vx"])) % self.width
            cell["y"] += cell["vy"]
            top, bottom = self.walls_at(cell["x"])
            pad = cell["radius"] * (0.95 if cell["sickled"] else 0.65)
            if cell["y"] < top + pad:
                cell["y"] = top + pad
            if cell["y"] > bottom - pad:
                cell["y"] = bottom - pad

    def metrics(self) -> dict[str, float]:
        if not self.cells:
            return {"occlusion": 0.0, "mean_flow": 0.0, "sickled_fraction": 0.0}
        sickled_count = sum(1 for c in self.cells if c["sickled"])
        jammed_count = sum(1 for c in self.cells if c["jammed"] or c["vx"] < 0.42)
        mean_vx = sum(c["vx"] for c in self.cells) / len(self.cells)
        sickled_fraction = sickled_count / len(self.cells)
        jam_ratio = jammed_count / len(self.cells)
        occlusion = min(1.0, max(0.0, 0.55 * jam_ratio + 0.45 * sickled_fraction * max(0.0, 1.0 - mean_vx / 1.5)))
        return {
            "occlusion": round(occlusion, 4),
            "mean_flow": round(mean_vx, 4),
            "sickled_fraction": round(sickled_fraction, 4),
        }

    def snapshot(self) -> dict[str, Any]:
        wall_profile = []
        for x in range(0, int(self.width) + 1, 16):
            top, bottom = self.walls_at(float(x))
            wall_profile.append({"x": x, "top": round(top, 2), "bottom": round(bottom, 2)})
        return {
            "width": self.width,
            "height": self.height,
            "pO2": self.pO2,
            "polymerization_tendency": self.polymerization_tendency,
            "tick": self.tick,
            "metrics": self.metrics(),
            "walls": wall_profile,
            "cells": [
                {
                    "id": c["id"],
                    "x": round(c["x"], 2),
                    "y": round(c["y"], 2),
                    "vx": round(c["vx"], 3),
                    "radius": c["radius"],
                    "sickled": c["sickled"],
                    "jammed": c["jammed"],
                }
                for c in self.cells
            ],
        }


def run_assay(
    polymerization_tendency: float = 0.0,
    pO2: float = 95.0,
    seed: int = 101,
    warmup_steps: int = 60,
    sample_steps: int = 60,
    cell_count: int = 26,
) -> dict[str, Any]:
    """Run headless deterministic capillary flow assay and return averaged metrics + final snapshot."""
    sim = CellSim(
        seed=seed,
        cell_count=cell_count,
        polymerization_tendency=polymerization_tendency,
        pO2=pO2,
    )
    for _ in range(max(1, warmup_steps)):
        sim.step()
    occ_sum = 0.0
    flow_sum = 0.0
    sickle_sum = 0.0
    steps = max(1, sample_steps)
    for _ in range(steps):
        sim.step()
        m = sim.metrics()
        occ_sum += m["occlusion"]
        flow_sum += m["mean_flow"]
        sickle_sum += m["sickled_fraction"]
    mean_occ = round(occ_sum / steps, 4)
    mean_flow = round(flow_sum / steps, 4)
    mean_sickle = round(sickle_sum / steps, 4)
    passed = bool(mean_occ < 0.35 and mean_flow >= 0.72)
    return {
        "occlusion": mean_occ,
        "mean_flow": mean_flow,
        "sickled_fraction": mean_sickle,
        "passed": passed,
        "pO2": sim.pO2,
        "polymerization_tendency": sim.polymerization_tendency,
        "seed": seed,
        "steps": warmup_steps + steps,
        "snapshot": sim.snapshot(),
    }


# ---------------------------------------------------------------------------
# 5. Composite Genotype & Biophysical Scoring for Arbitrary HBB Substitutions
# ---------------------------------------------------------------------------

def evaluate_genotype_biophysics(
    substitutions: list[dict[str, Any]],
    raw_text: str = "",
) -> dict[str, Any]:
    """Resolve branch substitutions + text intent into a composite HBB allele model."""
    subs = [
        {
            "position": int(s["position"]),
            "reference": str(s["reference"]),
            "alternate": str(s["alternate"]),
        }
        for s in substitutions
    ]
    subs.sort(key=lambda s: s["position"])
    sub_map = {s["position"]: s for s in subs}

    # If the branch has no committed substitutions yet, check whether the free-text intent
    # explicitly names a known HBB allele or residue change so red-team / exploratory prompts work.
    inferred_from_text = False
    text = (raw_text or "").strip()
    if not subs and text:
        upper = text.upper()
        if re.search(r"\b(HBS|E7V|E6V|GLU7VAL|GLU6VAL|SICKLE)\b", upper) and re.search(r"\b(T88Q|T87Q|THR88GLN|THR87GLN|RESCUE|CASGEVY)\b", upper):
            subs = list(KNOWN_HBB_ALLELES["HbS_T87Q_Rescue"]["substitutions"])
            inferred_from_text = True
        elif re.search(r"\b(T88Q|T87Q|THR88GLN|THR87GLN)\b", upper):
            subs = list(KNOWN_HBB_ALLELES["HbA_T87Q"]["substitutions"])
            inferred_from_text = True
        elif re.search(r"\b(HBS|E7V|E6V|GLU7VAL|GLU6VAL|SICKLE|RS334)\b", upper):
            subs = list(KNOWN_HBB_ALLELES["HbS"]["substitutions"])
            inferred_from_text = True
        elif re.search(r"\b(HBC|E7K|E6K|GLU7LYS|GLU6LYS)\b", upper):
            subs = list(KNOWN_HBB_ALLELES["HbC"]["substitutions"])
            inferred_from_text = True
        elif re.search(r"\b(HBE|E27K|E26K|GLU27LYS|GLU26LYS)\b", upper):
            subs = list(KNOWN_HBB_ALLELES["HbE"]["substitutions"])
            inferred_from_text = True
        elif re.search(r"\b(HBO[- ]?ARAB|E122K|E121K)\b", upper):
            subs = list(KNOWN_HBB_ALLELES["HbO_Arab"]["substitutions"])
            inferred_from_text = True
        else:
            # Parse explicit residue token like E7V, T88Q
            match = re.search(r"\b([ACDEFGHIKLMNPQRSTVWY])(\d{1,3})([ACDEFGHIKLMNPQRSTVWY])\b", upper)
            if match:
                ref_aa, pos_str, alt_aa = match.group(1), match.group(2), match.group(3)
                pos = int(pos_str)
                ref_seq = hbb_sequence.REFERENCE["sequence"]
                if 1 <= pos <= len(ref_seq) and ref_seq[pos - 1] == ref_aa and ref_aa != alt_aa:
                    subs = [{"position": pos, "reference": ref_aa, "alternate": alt_aa}]
                    inferred_from_text = True
        sub_map = {s["position"]: s for s in subs}

    # Check exact preset match
    matched_preset = None
    for preset in KNOWN_HBB_ALLELES.values():
        if preset["substitutions"] == subs:
            matched_preset = preset
            break

    # Compute polymerization tendency from biophysical principles
    if matched_preset is not None:
        poly = float(matched_preset["polymerization_tendency"])
        allele_id = matched_preset["id"]
        allele_name = matched_preset["name"]
        summary = matched_preset["summary"]
    else:
        poly = 0.0
        pos7 = sub_map.get(7)
        pos88 = sub_map.get(88)
        if pos7:
            alt7 = pos7["alternate"]
            if alt7 == "V":
                poly += 0.90
            elif alt7 in ("I", "L", "F", "M", "W"):
                poly += 0.68
            elif alt7 == "K":
                poly += 0.35
            else:
                poly += 0.22
        if pos88 and pos88["alternate"] == "Q":
            # Anti-sickling steric block at lateral contact site
            poly = max(0.02, poly * 0.16)
        # Other substitutions contribute based on hydrophobicity shift & haem-pocket proximity
        haem_pocket_positions = {43, 44, 64, 67, 68, 89, 93, 94, 99, 103, 107, 142}
        for s in subs:
            if s["position"] in (7, 88):
                continue
            delta_hydro = AA_HYDROPHOBICITY.get(s["alternate"], 0.0) - AA_HYDROPHOBICITY.get(s["reference"], 0.0)
            delta_charge = abs(AA_CHARGE.get(s["alternate"], 0) - AA_CHARGE.get(s["reference"], 0))
            if s["position"] in haem_pocket_positions:
                poly += 0.28 + max(0.0, delta_hydro * 0.04)
            elif delta_hydro > 2.5 or delta_charge > 0:
                poly += 0.15 + max(0.0, delta_hydro * 0.03)
            else:
                poly += 0.06
        poly = round(min(0.98, max(0.0, poly)), 3)
        labels = [f"{s['reference']}{s['position']}{s['alternate']}" for s in subs]
        allele_id = "_".join(labels) if labels else "WT"
        allele_name = f"HBB ({', '.join(labels)})" if labels else KNOWN_HBB_ALLELES["WT"]["name"]
        summary = (
            f"Composite in-silico HBB genotype with {len(subs)} substitution(s): {', '.join(labels)}."
            if labels
            else KNOWN_HBB_ALLELES["WT"]["summary"]
        )

    residue_impacts: list[dict[str, Any]] = []
    for s in subs:
        pos = s["position"]
        ref_aa = s["reference"]
        alt_aa = s["alternate"]
        d_hydro = round(AA_HYDROPHOBICITY.get(alt_aa, 0.0) - AA_HYDROPHOBICITY.get(ref_aa, 0.0), 2)
        d_charge = AA_CHARGE.get(alt_aa, 0) - AA_CHARGE.get(ref_aa, 0)
        if pos == 7 and alt_aa == "V":
            mechanism = "Surface Glu7→Val7 creates a hydrophobic donor patch on the A-helix that binds the EF-pocket of adjacent deoxy-Hb tetramers."
            optimistic_surface_note = "Surface-exposed residue away from the haem iron pocket; monomer backbone fold remains intact in oxygenated state."
        elif pos == 88 and alt_aa == "Q":
            mechanism = "Thr88→Gln88 introduces a bulky polar side chain in the F-helix acceptor pocket that sterically inhibits deoxy-HbS fibre polymerization."
            optimistic_surface_note = "Conservative polar substitution on the F-helix exterior; preserves oxygen-binding haem geometry."
        else:
            mechanism = (
                f"Residue {ref_aa}{pos}{alt_aa} (mature beta-{pos - 1}) shifts hydropathy by {d_hydro:+.2f} "
                f"and formal charge by {d_charge:+d}."
            )
            optimistic_surface_note = mechanism
        residue_impacts.append({
            "position": pos,
            "mature_position": pos - 1,
            "reference": ref_aa,
            "alternate": alt_aa,
            "hydropathy_shift": d_hydro,
            "charge_shift": d_charge,
            "mechanism": mechanism,
            "optimistic_surface_note": optimistic_surface_note,
        })

    three_reg = compute_three_register_diff(
        subs,
        matched_preset["codon_overrides"] if matched_preset else None,
    )

    return {
        "allele_id": allele_id,
        "allele_name": allele_name,
        "substitutions": subs,
        "inferred_from_text": inferred_from_text,
        "polymerization_tendency": poly,
        "summary": summary,
        "residue_impacts": residue_impacts,
        "three_register_diff": three_reg,
    }


# ---------------------------------------------------------------------------
# 6. Point-Based Bayesian ACMG/AMP Classification & Therapy Lookup
# ---------------------------------------------------------------------------

ACMG_SCOPE_NOTE = (
    "Computational research estimate using the Tavtigian et al. (2018) point-based "
    "ACMG/AMP scale; not a clinical diagnostic report."
)

PRIOR_CLASSIFICATIONS: dict[str, dict[str, Any]] = {
    "WT": {"classification": "Benign", "actionable": False, "source": "RefSeq NM_000518.5 / UniProt P68871"},
    "E7V": {"classification": "Pathogenic", "actionable": True, "source": "ClinVar VCV000015333 (HbS)"},
    "E7K": {"classification": "Pathogenic", "actionable": True, "source": "ClinVar VCV000015126 (HbC)"},
    "E27K": {"classification": "Pathogenic", "actionable": True, "source": "ClinVar VCV000015169 (HbE)"},
    "T88Q": {"classification": "Benign", "actionable": False, "source": "Engineered anti-sickling betaA-T87Q payload"},
}

APPROVED_THERAPIES = (
    {
        "id": "casgevy",
        "name": "Casgevy (exagamglogene autotemcel)",
        "regulator": "MHRA (Nov 2023) · FDA (Dec 2023) · EMA (Feb 2024)",
        "mechanism": "Ex-vivo CRISPR/Cas9 disruption of the erythroid enhancer of BCL11A in autologous CD34+ HSPCs to reactivate fetal hemoglobin (HbF), preventing deoxy-HbS polymerization.",
        "indication": "Severe sickle cell disease with recurrent vaso-occlusive crises and transfusion-dependent beta-thalassemia.",
    },
    {
        "id": "lyfgenia",
        "name": "Lyfgenia (lovotibeglogene autotemcel)",
        "regulator": "FDA (Dec 2023)",
        "mechanism": "Lentiviral vector encoding anti-sickling betaA-T87Q (full-length position T88Q) globin, which sterically blocks lateral Val7 contacts in deoxy-Hb fibres.",
        "indication": "Patients >= 12 years with sickle cell disease and a history of vaso-occlusive events.",
    },
)


def classify_acmg_points(
    genotype: dict[str, Any],
    assay_metrics: dict[str, Any],
) -> dict[str, Any]:
    """Score the genotype on the Tavtigian 2018 point-based ACMG/AMP scale."""
    subs = genotype["substitutions"]
    poly = genotype["polymerization_tendency"]
    evidence: list[dict[str, Any]] = []
    points = 0

    if not subs:
        evidence.append({"code": "BA1/BS2", "points": -6, "rationale": "Matches canonical wildtype P68871 / NM_000518.5 reference sequence."})
        points -= 6
    else:
        labels = {f"{s['reference']}{s['position']}{s['alternate']}" for s in subs}
        if "E7V" in labels and "T88Q" not in labels:
            evidence.append({"code": "PS1", "points": 4, "rationale": "Established pathogenic sickle substitution Glu7Val (rs334) at codon 7."})
            evidence.append({"code": "PS3", "points": 4, "rationale": "Functional capillary assay demonstrates severe deoxy-Hb polymerization and vaso-occlusion."})
            evidence.append({"code": "PM1", "points": 2, "rationale": "Located in critical beta-6 donor contact hotspot on Helix A."})
            evidence.append({"code": "PP3", "points": 1, "rationale": "Hydropathy shift (+7.7) predicts intermolecular beta-chain fibre assembly."})
            points += 11
        elif "E7V" in labels and "T88Q" in labels:
            evidence.append({"code": "PS1_mod", "points": 2, "rationale": "Retains primary E7V sickle allele on the same beta-globin chain."})
            evidence.append({"code": "BS3_rescue", "points": -2, "rationale": "Second-site T88Q anti-sickling substitution suppresses fibre contacts at normoxia."})
            points += 0
        elif "T88Q" in labels and len(subs) == 1:
            evidence.append({"code": "BS3", "points": -4, "rationale": "Well-characterised anti-sickling T88Q (mature T87Q) substitution preserves capillary flow."})
            evidence.append({"code": "BP4", "points": -1, "rationale": "Computational structural & flow models show no polymerization propensity."})
            points -= 5
        else:
            if poly >= 0.55 or assay_metrics["occlusion"] >= 0.45:
                evidence.append({"code": "PS3_sim", "points": 4, "rationale": "Capillary flow simulation shows elevated vaso-occlusion and impaired red-cell velocity."})
                points += 4
            if poly >= 0.30:
                evidence.append({"code": "PM1", "points": 2, "rationale": "Substitution perturbs beta-globin surface charge or haem-pocket stability."})
                evidence.append({"code": "PP3", "points": 2, "rationale": "Biophysical scoring predicts elevated polymerization or instability."})
                points += 4
            elif poly <= 0.12:
                evidence.append({"code": "BP4", "points": -2, "rationale": "Low biophysical perturbation and unobstructed capillary flow."})
                points -= 2
            else:
                evidence.append({"code": "PM2_supp", "points": 1, "rationale": "Rare missense substitution in HBB requiring functional follow-up."})
                points += 1

    if points >= 10:
        classification = "Pathogenic"
    elif points >= 6:
        classification = "Likely Pathogenic"
    elif points >= 0:
        classification = "Variant of Uncertain Significance"
    elif points >= -5:
        classification = "Likely Benign"
    else:
        classification = "Benign"

    actionable = classification in ("Pathogenic", "Likely Pathogenic")
    labels = [f"{s['reference']}{s['position']}{s['alternate']}" for s in subs]
    key = "+".join(labels) if labels else "WT"
    prior = PRIOR_CLASSIFICATIONS.get(labels[0] if len(labels) == 1 else key)

    return {
        "classification": classification,
        "total_points": points,
        "actionable": actionable,
        "evidence_codes": evidence,
        "prior_record": prior,
        "scope_note": ACMG_SCOPE_NOTE,
    }


# ---------------------------------------------------------------------------
# 7. Multi-Agent Collaboration & Specialist Cross-Examination
# ---------------------------------------------------------------------------

def run_collaborative_specialist_round(
    genotype: dict[str, Any],
    screen_result: dict[str, Any],
    structural_payload: dict[str, Any],
    assay_payload: dict[str, Any],
    offtarget_payload: dict[str, Any],
    acmg_payload: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Run independent specialist peer agents that cross-examine upstream deltas."""
    subs = genotype["substitutions"]
    poly = genotype["polymerization_tendency"]
    labels = [f"{s['reference']}{s['position']}{s['alternate']}" for s in subs]
    label_str = ", ".join(labels) if labels else "WT (Reference)"

    perspectives: list[dict[str, Any]] = []

    # Specialist 1: Structural Biophysics Peer Agent
    if poly >= 0.50:
        bio_stance = "challenge"
        bio_note = (
            f"Challenges StructuralImpactAgent's monomer-only surface assessment for {label_str}: "
            f"although oxygenated monomer fold is preserved, intermolecular donor-acceptor contacts "
            f"(polymerization tendency {poly:.2f}) will drive deoxy-Hb fibre nucleation under venous hypoxia."
        )
    elif any(s["position"] == 88 and s["alternate"] == "Q" for s in subs):
        bio_stance = "endorse"
        bio_note = (
            f"Endorses {label_str}: Gln88 (mature Gln87) projects into the lateral Val7 acceptor pocket, "
            f"providing a validated steric barrier against deoxy-Hb polymer assembly."
        )
    else:
        bio_stance = "concur"
        bio_note = (
            f"Concurs with StructuralImpactAgent for {label_str}: low intermolecular polymerization propensity "
            f"({poly:.2f}) and preserved beta-globin fold geometry."
        )
    perspectives.append({
        "specialist_id": "StructuralBiophysicsAgent",
        "title": "Structural Biophysics Specialist",
        "stance": bio_stance,
        "target_agent": "StructuralImpactAgent",
        "summary": bio_note,
    })

    # Specialist 2: Clinical Genetics & Heme-Pathology Peer Agent
    if acmg_payload:
        cls_name = acmg_payload["classification"]
        pts = acmg_payload["total_points"]
        if acmg_payload["actionable"]:
            clin_stance = "flag_risk"
            clin_note = (
                f"Flags {label_str} as clinically actionable ({cls_name}, {pts:+d} ACMG pts). "
                f"Normoxic flow assays (pO2 = {assay_payload['pO2']} mmHg) can mask microvascular sickling; "
                f"recommends mandatory hypoxic stress verification at pO2 = 10 mmHg before branch merge."
            )
        else:
            clin_stance = "concur"
            clin_note = (
                f"Evaluates {label_str} as non-actionable ({cls_name}, {pts:+d} ACMG pts) with "
                f"capillary occlusion {assay_payload['occlusion']:.2f} at pO2 = {assay_payload['pO2']} mmHg."
            )
    else:
        clin_stance = "concur"
        clin_note = f"Reviews capillary rheology for {label_str} (mean flow {assay_payload['mean_flow']:.2f}, occlusion {assay_payload['occlusion']:.2f})."
    perspectives.append({
        "specialist_id": "ClinicalGeneticsAgent",
        "title": "Clinical Genetics & Rheology Specialist",
        "stance": clin_stance,
        "target_agent": "FunctionalAssayAgent",
        "summary": clin_note,
    })

    # Specialist 3: Biosafety & Governance Peer Agent
    if screen_result["verdict"] == "escalate" or offtarget_payload["multiplex_risk"] != "low":
        gov_stance = "hold_for_signoff"
        gov_note = (
            f"Governance hold on {label_str}: policy category {screen_result['category']} "
            f"(multiplex risk: {offtarget_payload['multiplex_risk']}). Requires human sign-off "
            f"by {screen_result['requires_signoff'] or 'principal_investigator'} prior to branch merge."
        )
    else:
        gov_stance = "concur"
        gov_note = (
            f"Verifies somatic HBB scope for {label_str}: no tumour-suppressor or germline loci touched; "
            f"structural biosafety verdict '{screen_result['verdict']}' is upheld."
        )
    perspectives.append({
        "specialist_id": "BiosafetyGovernanceAgent",
        "title": "Biosafety & Governance Specialist",
        "stance": gov_stance,
        "target_agent": "BiosafetyGateAgent",
        "summary": gov_note,
    })

    return perspectives


# ---------------------------------------------------------------------------
# 8. Multi-Agent CI Pipeline Orchestrator & Server-Side Run Store
# ---------------------------------------------------------------------------

def _substitutions_digest(substitutions: list[dict[str, Any]]) -> str:
    return hashlib.sha256(_canonical_json(substitutions).encode("utf-8")).hexdigest()[:16]


class CIPipelineStore:
    """Thread-safe server-side store for Multi-Agent CI runs, DeltaDAGs, sign-offs, and comments."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._runs: dict[str, dict[str, Any]] = {}
        self._dags: dict[str, DeltaDAG] = {}
        self._latest_by_branch: dict[str, str] = {}
        self._counter = 0

    def reset(self) -> None:
        with self._lock:
            self._runs.clear()
            self._dags.clear()
            self._latest_by_branch.clear()
            self._counter = 0

    def run_pipeline(
        self,
        branch: str,
        head_commit: str | None,
        substitutions: list[dict[str, Any]],
        raw_text: str = "",
        pO2: float = 95.0,
        classify: bool = True,
        seed: int = 101,
    ) -> dict[str, Any]:
        if not isinstance(pO2, (int, float)) or math.isnan(pO2) or math.isinf(pO2):
            raise InvalidInput("pO2 must be a finite number between 10 and 100 mmHg.")
        clamped_po2 = max(10.0, min(100.0, float(pO2)))
        text = str(raw_text or "").strip()
        if len(text) > 2000:
            raise InvalidInput("Intent text must be at most 2000 characters.")

        dag = DeltaDAG()
        agent_steps: list[dict[str, Any]] = []

        # Step 1: IntentAgent
        screen_preview = screen_intent(text, substitutions)
        is_blocked = screen_preview["verdict"] == "block"
        intent_payload = {
            "branch": branch,
            "head_commit": head_commit,
            "substitutions_count": len(substitutions),
            "request_digest": screen_preview["request_digest"],
            "redacted": is_blocked,
            "intent_summary": (
                f"[REDACTED — sha256:{screen_preview['request_digest']}]"
                if is_blocked
                else (text or f"Evaluate committed HBB sequence on branch '{branch}'")
            ),
        }
        intent_delta = dag.add("IntentAgent", "intent", intent_payload, parents=())
        agent_steps.append({
            "step": 1,
            "agent_id": "IntentAgent",
            "role": "Intent & Branch State Parser",
            "status": "PASS",
            "delta_id": intent_delta.id,
            "summary": intent_payload["intent_summary"],
        })

        # Step 2: BiosafetyGateAgent (Structural Position 2 — fail-closed)
        screen_delta = dag.add(
            "BiosafetyGateAgent",
            "screen",
            screen_preview,
            parents=(intent_delta.id,),
        )
        gate_status = (
            "BLOCK" if screen_preview["verdict"] == "block"
            else "ESCALATE" if screen_preview["verdict"] == "escalate"
            else "PASS"
        )
        agent_steps.append({
            "step": 2,
            "agent_id": "BiosafetyGateAgent",
            "role": "Structural Biosafety Gate (Position 2)",
            "status": gate_status,
            "delta_id": screen_delta.id,
            "summary": f"{screen_preview['category']} → {screen_preview['verdict'].upper()}: {screen_preview['summary']}",
        })

        # If blocked at Position 2, halt downstream scientific agents immediately!
        if is_blocked:
            verdict_payload = {
                "passed": False,
                "blocked": True,
                "merge_allowed": False,
                "requires_signoff": False,
                "signoff_role": None,
                "signed_off_by": None,
                "disagreed_with_assay": False,
                "disagreed_with_structural": False,
                "reasons": [
                    f"Blocked at Step 2 by BiosafetyGateAgent ({screen_preview['category']}): {screen_preview['summary']}"
                ],
                "hypoxic_verification": None,
            }
            verdict_delta = dag.add(
                "VerifierAgent",
                "verdict",
                verdict_payload,
                parents=(screen_delta.id,),
            )
            agent_steps.append({
                "step": 3,
                "agent_id": "VerifierAgent",
                "role": "Independent Safety & Merge-Gate Verifier",
                "status": "BLOCK",
                "delta_id": verdict_delta.id,
                "summary": "Downstream edit planning, structural folding, and capillary simulation halted due to Step 2 biosafety block.",
            })
            return self._store_run(
                branch=branch,
                head_commit=head_commit,
                substitutions=substitutions,
                dag=dag,
                agent_steps=agent_steps,
                screen_result=screen_preview,
                genotype=None,
                assay_result=None,
                hypoxic_assay=None,
                acmg_result=None,
                conflict_result=None,
                collaborative_round=[],
                therapy_matches=[],
                verdict_payload=verdict_payload,
            )

        # Step 3: EditPlannerAgent (Three-Register Diff + Genotype Resolution)
        genotype = evaluate_genotype_biophysics(substitutions, text)
        edit_plan_payload = {
            "allele_id": genotype["allele_id"],
            "allele_name": genotype["allele_name"],
            "substitutions": genotype["substitutions"],
            "inferred_from_text": genotype["inferred_from_text"],
            "polymerization_tendency": genotype["polymerization_tendency"],
            "changed_codons_count": len(genotype["three_register_diff"]["changed_codons"]),
            "summary": genotype["summary"],
        }
        edit_delta = dag.add(
            "EditPlannerAgent",
            "edit_plan",
            edit_plan_payload,
            parents=(screen_delta.id,),
        )
        agent_steps.append({
            "step": 3,
            "agent_id": "EditPlannerAgent",
            "role": "Three-Register Codon & Edit Planner",
            "status": "PASS",
            "delta_id": edit_delta.id,
            "summary": f"{genotype['allele_name']} · {len(genotype['three_register_diff']['changed_codons'])} codon change(s) mapped onto {HBB_ACCESSION}.",
        })

        # Step 4: StructuralImpactAgent
        # Note: For surface polymerizing alleles like HbS (E7V), StructuralImpactAgent evaluates
        # the oxygenated monomer fold as locally intact ("optimistic"), which sets up a genuine
        # scientific contradiction when VerifierAgent tests deoxy-Hb fibre formation at pO2 = 10 mmHg!
        poly = genotype["polymerization_tendency"]
        has_surface_sickle_trap = any(s["position"] == 7 and s["alternate"] == "V" for s in genotype["substitutions"]) and not any(
            s["position"] == 88 and s["alternate"] == "Q" for s in genotype["substitutions"]
        )
        structural_optimistic = has_surface_sickle_trap or poly < 0.45
        structural_payload = {
            "allele_id": genotype["allele_id"],
            "monomer_fold_intact": True,
            "optimistic_assessment": structural_optimistic,
            "polymerization_tendency": poly,
            "residue_impacts": genotype["residue_impacts"],
            "summary": (
                "Oxygenated monomer backbone fold intact; Glu7Val is a surface-exposed Helix-A residue distant from the haem pocket (requires deoxy-state fibre check)."
                if has_surface_sickle_trap
                else (
                    "Beta-globin monomer geometry and surface hydropathy within normal bounds."
                    if structural_optimistic
                    else f"Elevated structural perturbation detected (polymerization tendency {poly:.2f})."
                )
            ),
        }
        structural_delta = dag.add(
            "StructuralImpactAgent",
            "structural",
            structural_payload,
            parents=(edit_delta.id,),
        )
        agent_steps.append({
            "step": 4,
            "agent_id": "StructuralImpactAgent",
            "role": "Monomer Fold & Surface Biophysics Agent",
            "status": "PASS" if structural_optimistic else "WARN",
            "delta_id": structural_delta.id,
            "summary": structural_payload["summary"],
        })

        # Step 5: FunctionalAssayAgent (Capillary flow at user-selected pO2, default 95 mmHg)
        assay_result = run_assay(
            polymerization_tendency=poly,
            pO2=clamped_po2,
            seed=seed,
        )
        assay_passed = assay_result["occlusion"] < 0.35 and assay_result["mean_flow"] >= 0.72
        assay_payload = {
            "pO2": clamped_po2,
            "occlusion": assay_result["occlusion"],
            "mean_flow": assay_result["mean_flow"],
            "sickled_fraction": assay_result["sickled_fraction"],
            "passed": assay_passed,
            "summary": (
                f"At pO2 = {clamped_po2:.0f} mmHg: occlusion {assay_result['occlusion']:.2f}, "
                f"mean flow {assay_result['mean_flow']:.2f}, sickled fraction {assay_result['sickled_fraction']:.2f} "
                f"({'PASS' if assay_passed else 'FAIL'})."
            ),
        }
        assay_delta = dag.add(
            "FunctionalAssayAgent",
            "assay",
            assay_payload,
            parents=(structural_delta.id,),
        )
        agent_steps.append({
            "step": 5,
            "agent_id": "FunctionalAssayAgent",
            "role": f"Capillary Flow Assay Agent (pO2 = {clamped_po2:.0f} mmHg)",
            "status": "PASS" if assay_passed else "FAIL",
            "delta_id": assay_delta.id,
            "summary": assay_payload["summary"],
        })

        # Step 6: OffTargetRiskAgent
        edit_count = len(genotype["substitutions"])
        multiplex_risk = "high" if edit_count >= 3 else "moderate" if edit_count == 2 else "low"
        offtarget_payload = {
            "edit_count": edit_count,
            "multiplex_risk": multiplex_risk,
            "matched_loci": screen_preview["matched_loci"],
            " homologous_paralog_note": "HBD (delta-globin) shares 93% sequence identity with HBB; verify off-target cleavage window in Exon 1/2.",
            "passed": multiplex_risk != "high",
            "summary": (
                f"{edit_count} substitution(s) on HBB; multiplex translocation risk is {multiplex_risk}."
            ),
        }
        offtarget_delta = dag.add(
            "OffTargetRiskAgent",
            "offtarget",
            offtarget_payload,
            parents=(assay_delta.id,),
        )
        agent_steps.append({
            "step": 6,
            "agent_id": "OffTargetRiskAgent",
            "role": "Paralog & Multiplex Off-Target Risk Agent",
            "status": "WARN" if multiplex_risk == "high" else "PASS",
            "delta_id": offtarget_delta.id,
            "summary": offtarget_payload["summary"],
        })

        last_parent_id = offtarget_delta.id
        acmg_result = None
        conflict_result = None

        # Step 7: Optional ACMG Classification & Conflict Agent
        if classify:
            acmg_result = classify_acmg_points(genotype, assay_result)
            cls_delta = dag.add(
                "AcmgClassificationAgent",
                "classification",
                acmg_result,
                parents=(last_parent_id,),
            )
            agent_steps.append({
                "step": len(agent_steps) + 1,
                "agent_id": "AcmgClassificationAgent",
                "role": "Bayesian Point-Based ACMG Classifier",
                "status": "WARN" if acmg_result["actionable"] else "PASS",
                "delta_id": cls_delta.id,
                "summary": f"{acmg_result['classification']} ({acmg_result['total_points']:+d} pts).",
            })
            last_parent_id = cls_delta.id

            # Check for actionable reclassification vs WT baseline or prior record
            prior_actionable = False
            if acmg_result["prior_record"]:
                prior_actionable = bool(acmg_result["prior_record"].get("actionable"))
            reclassified_actionable = acmg_result["actionable"] and len(genotype["substitutions"]) > 0
            conflict_result = {
                "has_actionable_conflict": reclassified_actionable,
                "prior_actionable": prior_actionable,
                "new_classification": acmg_result["classification"],
                "requires_signoff": "board_certified_medical_geneticist" if reclassified_actionable else None,
                "summary": (
                    f"Actionable pathogenicity alert ({acmg_result['classification']}): requires board_certified_medical_geneticist sign-off or anti-sickling rescue."
                    if reclassified_actionable
                    else f"No actionable pathogenicity conflict ({acmg_result['classification']})."
                ),
            }
            conflict_delta = dag.add(
                "ClassificationConflictAgent",
                "conflict",
                conflict_result,
                parents=(last_parent_id,),
            )
            agent_steps.append({
                "step": len(agent_steps) + 1,
                "agent_id": "ClassificationConflictAgent",
                "role": "Actionable Reclassification Conflict Agent",
                "status": "ESCALATE" if reclassified_actionable else "PASS",
                "delta_id": conflict_delta.id,
                "summary": conflict_result["summary"],
            })
            last_parent_id = conflict_delta.id

        # Step 8: Multi-Agent Collaborative Specialist Round
        collaborative_round = run_collaborative_specialist_round(
            genotype=genotype,
            screen_result=screen_preview,
            structural_payload=structural_payload,
            assay_payload=assay_payload,
            offtarget_payload=offtarget_payload,
            acmg_payload=acmg_result,
        )
        peer_payload = {
            "specialists": collaborative_round,
            "consensus": all(p["stance"] in ("concur", "endorse") for p in collaborative_round),
            "challenges": [p["specialist_id"] for p in collaborative_round if p["stance"] not in ("concur", "endorse")],
            "summary": (
                "All 3 specialist peer agents concur on variant safety and rheology."
                if all(p["stance"] in ("concur", "endorse") for p in collaborative_round)
                else f"Specialist cross-examination raised review flags from: {', '.join(p['specialist_id'] for p in collaborative_round if p['stance'] not in ('concur', 'endorse'))}."
            ),
        }
        peer_delta = dag.add(
            "CollaborativePeerPanel",
            "peer_review",
            peer_payload,
            parents=(last_parent_id,),
        )
        agent_steps.append({
            "step": len(agent_steps) + 1,
            "agent_id": "CollaborativePeerPanel",
            "role": "Multi-Agent Specialist Cross-Examination",
            "status": "PASS" if peer_payload["consensus"] else "WARN",
            "delta_id": peer_delta.id,
            "summary": peer_payload["summary"],
        })
        last_parent_id = peer_delta.id

        # Step 9: VerifierAgent — Independent Hypoxic Stress Test (pO2 = 10 mmHg) & Disagreement Forking
        hypoxic_assay = run_assay(
            polymerization_tendency=poly,
            pO2=10.0,
            seed=seed + 17,
        )
        wt_hypoxic_baseline = run_assay(
            polymerization_tendency=0.0,
            pO2=10.0,
            seed=seed + 17,
        )
        hypoxic_failed = (
            hypoxic_assay["occlusion"] >= 0.35
            or hypoxic_assay["sickled_fraction"] >= 0.40
            or hypoxic_assay["mean_flow"] < wt_hypoxic_baseline["mean_flow"] * 0.62
        )

        disagreed_with_assay = bool(assay_passed and hypoxic_failed)
        disagreed_with_structural = bool(structural_optimistic and hypoxic_failed)

        reasons: list[str] = []
        if not assay_passed:
            reasons.append(
                f"FunctionalAssayAgent failed at pO2 = {clamped_po2:.0f} mmHg (occlusion {assay_result['occlusion']:.2f}, flow {assay_result['mean_flow']:.2f})."
            )
        if hypoxic_failed:
            reasons.append(
                f"VerifierAgent hypoxic stress test at pO2 = 10 mmHg failed: occlusion {hypoxic_assay['occlusion']:.2f}, "
                f"sickled fraction {hypoxic_assay['sickled_fraction']:.2f}, mean flow {hypoxic_assay['mean_flow']:.2f} "
                f"(vs WT baseline flow {wt_hypoxic_baseline['mean_flow']:.2f})."
            )
        if disagreed_with_assay:
            reasons.append(
                f"Agent Disagreement Fork: FunctionalAssayAgent passed at normoxia (pO2 = {clamped_po2:.0f} mmHg), "
                f"but VerifierAgent refuted it under venous hypoxia (pO2 = 10 mmHg)."
            )
        if disagreed_with_structural:
            reasons.append(
                "Agent Disagreement Fork: StructuralImpactAgent reported intact oxygenated monomer fold, "
                "but VerifierAgent demonstrated intermolecular deoxy-Hb polymerization under hypoxia."
            )

        # Determine required human sign-off role (server-derived)
        signoff_role = screen_preview["requires_signoff"]
        if not signoff_role and conflict_result and conflict_result["requires_signoff"] and not hypoxic_failed:
            signoff_role = conflict_result["requires_signoff"]
        requires_signoff = signoff_role is not None
        if requires_signoff:
            reasons.append(
                f"Human-in-the-loop sign-off required from role '{signoff_role}'."
            )

        scientific_passed = bool(assay_passed and not hypoxic_failed)
        merge_allowed = bool(scientific_passed and not requires_signoff)

        verdict_payload = {
            "passed": scientific_passed,
            "blocked": False,
            "merge_allowed": merge_allowed,
            "requires_signoff": requires_signoff,
            "signoff_role": signoff_role,
            "signed_off_by": None,
            "disagreed_with_assay": disagreed_with_assay,
            "disagreed_with_structural": disagreed_with_structural,
            "reasons": reasons or ["All structural, normoxic, and hypoxic capillary flow checks passed."],
            "hypoxic_verification": {
                "pO2": 10.0,
                "occlusion": hypoxic_assay["occlusion"],
                "mean_flow": hypoxic_assay["mean_flow"],
                "sickled_fraction": hypoxic_assay["sickled_fraction"],
                "wt_baseline_flow": wt_hypoxic_baseline["mean_flow"],
                "failed": hypoxic_failed,
            },
        }

        # Crucial DeltaDAG Forking Behaviour:
        # When VerifierAgent contradicts FunctionalAssayAgent or StructuralImpactAgent,
        # it attaches its refutation verdict directly to the contradicted upstream delta
        # as well as the tip of the DAG, creating an explicit, inspectable fork on that parent!
        if disagreed_with_structural:
            verdict_parents: tuple[str, ...] = (structural_delta.id, last_parent_id)
        elif disagreed_with_assay:
            verdict_parents = (assay_delta.id, last_parent_id)
        else:
            verdict_parents = (last_parent_id,)

        verdict_delta = dag.add(
            "VerifierAgent",
            "verdict",
            verdict_payload,
            parents=verdict_parents,
        )
        verifier_status = (
            "FAIL" if not scientific_passed
            else "ESCALATE" if requires_signoff
            else "PASS"
        )
        agent_steps.append({
            "step": len(agent_steps) + 1,
            "agent_id": "VerifierAgent",
            "role": "Independent Hypoxic Stress & Disagreement Verifier (pO2 = 10 mmHg)",
            "status": verifier_status,
            "delta_id": verdict_delta.id,
            "summary": verdict_payload["reasons"][0],
        })

        # Step 10: TherapyLookupAgent (runs when merge_allowed is True)
        therapy_matches: list[dict[str, Any]] = []
        if merge_allowed:
            therapy_matches = [dict(item) for item in APPROVED_THERAPIES]
            therapy_delta = dag.add(
                "TherapyLookupAgent",
                "therapy_match",
                {
                    "count": len(therapy_matches),
                    "therapies": therapy_matches,
                    "summary": "Surfaced approved HBB gene-editing therapeutic context (Casgevy, Lyfgenia).",
                },
                parents=(verdict_delta.id,),
            )
            agent_steps.append({
                "step": len(agent_steps) + 1,
                "agent_id": "TherapyLookupAgent",
                "role": "Approved HBB Therapy Context Agent",
                "status": "PASS",
                "delta_id": therapy_delta.id,
                "summary": "Surfaced Casgevy (BCL11A enhancer edit) and Lyfgenia (betaA-T87Q anti-sickling globin) reference context.",
            })

        return self._store_run(
            branch=branch,
            head_commit=head_commit,
            substitutions=substitutions,
            dag=dag,
            agent_steps=agent_steps,
            screen_result=screen_preview,
            genotype=genotype,
            assay_result=assay_result,
            hypoxic_assay=hypoxic_assay,
            acmg_result=acmg_result,
            conflict_result=conflict_result,
            collaborative_round=collaborative_round,
            therapy_matches=therapy_matches,
            verdict_payload=verdict_payload,
        )

    def _store_run(
        self,
        branch: str,
        head_commit: str | None,
        substitutions: list[dict[str, Any]],
        dag: DeltaDAG,
        agent_steps: list[dict[str, Any]],
        screen_result: dict[str, Any],
        genotype: dict[str, Any] | None,
        assay_result: dict[str, Any] | None,
        hypoxic_assay: dict[str, Any] | None,
        acmg_result: dict[str, Any] | None,
        conflict_result: dict[str, Any] | None,
        collaborative_round: list[dict[str, Any]],
        therapy_matches: list[dict[str, Any]],
        verdict_payload: dict[str, Any],
    ) -> dict[str, Any]:
        with self._lock:
            self._counter += 1
            run_id = f"ci-{self._counter:04d}-{verdict_payload['reasons'][0][:0]}{dag.all()[-1].id[:8]}"
            record = {
                "run_id": run_id,
                "branch": branch,
                "head_commit": head_commit,
                "substitutions_digest": _substitutions_digest(substitutions),
                "substitutions": list(substitutions),
                "screen": screen_result,
                "genotype": genotype,
                "assay": assay_result,
                "hypoxic_assay": hypoxic_assay,
                "classification": acmg_result,
                "conflict": conflict_result,
                "collaboration": collaborative_round,
                "therapies": therapy_matches,
                "verdict": dict(verdict_payload),
                "agent_steps": list(agent_steps),
                "dag": {
                    "size": dag.size,
                    "deltas": dag.to_list(),
                    "forks": dag.forks(),
                    "heads": [d.id for d in dag.heads()],
                },
                "signoffs": [],
                "comments": [],
            }
            self._runs[run_id] = record
            self._dags[run_id] = dag
            self._latest_by_branch[branch] = run_id
            return json.loads(json.dumps(record))

    def signoff_run(
        self,
        run_id: str,
        signer: str,
        rationale: str,
    ) -> dict[str, Any]:
        """Record a human-in-the-loop sign-off with a server-derived role."""
        signer_clean = str(signer or "").strip()
        rationale_clean = str(rationale or "").strip()
        if not signer_clean or len(signer_clean) > 120:
            raise InvalidInput("Provide a signer name (1–120 characters).")
        if not rationale_clean or len(rationale_clean) > 1000:
            raise InvalidInput("Provide a review rationale (1–1000 characters).")

        with self._lock:
            record = self._runs.get(run_id)
            dag = self._dags.get(run_id)
            if not record or not dag:
                raise InvalidInput("Unknown CI run ID.")
            verdict = record["verdict"]
            if verdict["blocked"]:
                raise InvalidInput("Blocked biosafety verdicts cannot be overridden by sign-off.")
            if not verdict["requires_signoff"] or not verdict["signoff_role"]:
                raise InvalidInput("This CI run does not have a pending escalation sign-off.")

            # Role is strictly derived server-side from the run's required role!
            granted_role = verdict["signoff_role"]
            verdict_deltas = dag.by_kind("verdict")
            parent_id = verdict_deltas[-1].id if verdict_deltas else dag.all()[-1].id
            signoff_payload = {
                "signer": signer_clean,
                "granted_role": granted_role,
                "rationale": rationale_clean,
            }
            signoff_delta = dag.add(
                f"HumanReviewer:{signer_clean}",
                "signoff",
                signoff_payload,
                parents=(parent_id,),
            )
            record["signoffs"].append({
                "delta_id": signoff_delta.id,
                "signer": signer_clean,
                "granted_role": granted_role,
                "rationale": rationale_clean,
            })
            verdict["requires_signoff"] = False
            verdict["signed_off_by"] = f"{signer_clean} ({granted_role})"
            verdict["merge_allowed"] = bool(verdict["passed"] and not verdict["blocked"])
            if verdict["merge_allowed"]:
                verdict["reasons"].append(
                    f"Escalation cleared by {signer_clean} in server-verified role '{granted_role}'."
                )
                if not record["therapies"]:
                    record["therapies"] = [dict(item) for item in APPROVED_THERAPIES]
                    therapy_delta = dag.add(
                        "TherapyLookupAgent",
                        "therapy_match",
                        {
                            "count": len(record["therapies"]),
                            "therapies": record["therapies"],
                            "summary": "Surfaced approved HBB therapy context following escalation sign-off.",
                        },
                        parents=(signoff_delta.id,),
                    )
                    record["agent_steps"].append({
                        "step": len(record["agent_steps"]) + 1,
                        "agent_id": "TherapyLookupAgent",
                        "role": "Approved HBB Therapy Context Agent",
                        "status": "PASS",
                        "delta_id": therapy_delta.id,
                        "summary": "Surfaced Casgevy and Lyfgenia reference context after sign-off.",
                    })

            record["dag"] = {
                "size": dag.size,
                "deltas": dag.to_list(),
                "forks": dag.forks(),
                "heads": [d.id for d in dag.heads()],
            }
            return json.loads(json.dumps(record))

    def comment_delta(
        self,
        run_id: str,
        delta_id: str,
        author: str,
        text: str,
    ) -> dict[str, Any]:
        """Attach an attributed collaborative review comment to a specific Delta node in the DAG."""
        author_clean = str(author or "").strip()
        text_clean = str(text or "").strip()
        if not author_clean or len(author_clean) > 120:
            raise InvalidInput("Provide an author name (1–120 characters).")
        if not text_clean or len(text_clean) > 1000:
            raise InvalidInput("Provide a comment (1–1000 characters).")

        with self._lock:
            record = self._runs.get(run_id)
            dag = self._dags.get(run_id)
            if not record or not dag:
                raise InvalidInput("Unknown CI run ID.")
            target_delta = dag.get(delta_id)
            if not target_delta:
                raise InvalidInput("Target delta ID not found in this CI run.")

            comment_payload = {
                "target_delta_id": delta_id,
                "target_agent": target_delta.agent_id,
                "author": author_clean,
                "text": text_clean,
            }
            comment_node = dag.add(
                f"Reviewer:{author_clean}",
                "comment",
                comment_payload,
                parents=(delta_id,),
            )
            record["comments"].append({
                "id": comment_node.id,
                "target_delta_id": delta_id,
                "target_agent": target_delta.agent_id,
                "author": author_clean,
                "text": text_clean,
                "created_at": comment_node.created_at,
            })
            record["dag"] = {
                "size": dag.size,
                "deltas": dag.to_list(),
                "forks": dag.forks(),
                "heads": [d.id for d in dag.heads()],
            }
            return json.loads(json.dumps(record))

    def get_branch_status(
        self,
        branch: str,
        head_commit: str | None,
        substitutions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Return the latest CI run for `branch` (or automatically run the baseline pipeline if none exists or head changed)."""
        sub_digest = _substitutions_digest(substitutions)
        with self._lock:
            run_id = self._latest_by_branch.get(branch)
            if run_id and run_id in self._runs:
                existing = self._runs[run_id]
                if (
                    existing["head_commit"] == head_commit
                    and existing["substitutions_digest"] == sub_digest
                ):
                    return json.loads(json.dumps(existing))
        return self.run_pipeline(
            branch=branch,
            head_commit=head_commit,
            substitutions=substitutions,
            raw_text="",
            pO2=95.0,
            classify=True,
        )

    def evaluate_merge_gate(
        self,
        target_branch: str,
        source_branch: str,
        source_head: str | None,
        merged_substitutions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Evaluate whether `source_branch` -> `target_branch` passes the Multi-Agent CI merge gate."""
        sub_digest = _substitutions_digest(merged_substitutions)
        with self._lock:
            run_id = self._latest_by_branch.get(source_branch)
            run_record = self._runs.get(run_id) if run_id else None

        if (
            not run_record
            or run_record["head_commit"] != source_head
            or run_record["substitutions_digest"] != sub_digest
        ):
            run_record = self.run_pipeline(
                branch=source_branch,
                head_commit=source_head,
                substitutions=merged_substitutions,
                raw_text=f"Merge gate evaluation: combine '{source_branch}' into '{target_branch}'",
                pO2=95.0,
                classify=True,
            )

        verdict = run_record["verdict"]
        if verdict["blocked"]:
            gate_status = "blocked"
        elif verdict["requires_signoff"]:
            gate_status = "held_for_signoff"
        elif not verdict["passed"]:
            gate_status = "failed_ci"
        else:
            gate_status = "allowed"

        return {
            "target_branch": target_branch,
            "source_branch": source_branch,
            "source_head": source_head,
            "gate_status": gate_status,
            "merge_allowed": bool(verdict["merge_allowed"]),
            "requires_signoff": bool(verdict["requires_signoff"]),
            "signoff_role": verdict["signoff_role"],
            "signed_off_by": verdict["signed_off_by"],
            "disagreed_with_assay": bool(verdict["disagreed_with_assay"]),
            "disagreed_with_structural": bool(verdict["disagreed_with_structural"]),
            "reasons": list(verdict["reasons"]),
            "run_id": run_record["run_id"],
            "run": run_record,
        }


CI_STORE = CIPipelineStore()
