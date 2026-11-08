"""Opt-in representation of the published hemoglobin S variant, for research.

propose(history) is only for a caller that has already obtained the user's
explicit choice and consent. It performs a live ClinVar lookup, sends no user
sequence to NCBI, and never saves. ``history.sequence_read()`` must return a
coherent snapshot for the intended branch; pass a branch-bound adapter for
non-main branches. Retain the proposal and branch together, display it for
approval, and save only against its exact base_head with an atomic
expected-head check. A proposal with no changes must not be saved.
"""

import re
from datetime import datetime
from urllib.parse import parse_qs, urlsplit

try:
    from . import gene_data, hbb_sequence
    from .git_history import InvalidInput
except ImportError:
    import gene_data
    import hbb_sequence
    from git_history import InvalidInput


class SourceMismatch(Exception):
    """The live source or local reference cannot establish the requested variant."""


def _source(result):
    """Validate identity and provenance, without trusting source-supplied links."""
    try:
        variant = result["variant"]
        provenance = result["provenance"]
        version = variant["accession_version"]
        timestamp = provenance["retrieved_at_utc"]
        url = provenance["request_url"]
        parsed = urlsplit(url)
        query = parse_qs(parsed.query, keep_blank_values=True)
        date = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if (variant["id"] != "15333"
                or variant["accession"] != "VCV000015333"
                or not isinstance(version, str)
                or not re.fullmatch(r"VCV000015333\.[1-9][0-9]*", version)
                or variant["title"] != "NM_000518.5(HBB):c.20A>T (p.Glu7Val)"
                or variant["url"] != "https://www.ncbi.nlm.nih.gov/clinvar/variation/15333/"
                or provenance["provider"] != "NCBI ClinVar via E-utilities"
                or date.utcoffset() is None
                or parsed.scheme != "https" or parsed.netloc != "eutils.ncbi.nlm.nih.gov"
                or parsed.path != "/entrez/eutils/esummary.fcgi" or parsed.fragment
                or query.get("db") != ["clinvar"] or query.get("id") != ["15333"]
                or query.get("retmode") != ["json"]):
            raise ValueError
    except (KeyError, TypeError, ValueError, AttributeError):
        raise SourceMismatch("ClinVar record identity or provenance did not match.") from None
    return {
        "accession": hbb_sequence.REFERENCE["accession"],
        "sequence_version": hbb_sequence.REFERENCE["sequence_version"],
        "url": hbb_sequence.REFERENCE["source_url"],
        "coordinates": "1-based full protein reference, including initiator methionine",
        "clinvar": {
            "accession": variant["accession"], "accession_version": version,
            "title": variant["title"], "url": variant["url"],
            "provenance": {"provider": provenance["provider"],
                           "retrieved_at_utc": timestamp, "request_url": url},
        },
    }


def propose(history):
    """Return an uncommitted plan; raise GeneDataError or SourceMismatch on failure.

    InvalidInput indicates invalid stored substitutions. Already E7V produces
    an empty changes list. An existing different position 7 residue is shown
    explicitly in the proposal; nothing is saved until separate approval.
    No arbitrary goal or replacement of another position is inferred.
    The history adapter is read once before the live lookup.
    """
    reference = hbb_sequence.REFERENCE
    if (reference.get("accession") != "P68871" or reference.get("sequence_version") != 2
            or not isinstance(reference.get("sequence"), str)
            or len(reference["sequence"]) != 147 or reference["sequence"][6] != "E"):
        raise SourceMismatch("The local P68871 reference does not match position 7.")
    snapshot = history.sequence_read()
    current = hbb_sequence.make_state(snapshot["substitutions"])
    old = current["sequence"][6]
    try:
        result = gene_data.lookup_hbb_variant("15333")
    except ValueError:
        raise SourceMismatch("ClinVar record was not found or was not associated with HBB.") from None
    source = _source(result)
    changes = []
    substitutions = list(current["substitutions"])
    if old != "V":
        changes = [{"position": 7, "reference": "E", "old": old, "new": "V"}]
        substitutions = [item for item in substitutions if item["position"] != 7]
        substitutions.append({"position": 7, "reference": "E", "alternate": "V"})
    state = hbb_sequence.make_state(substitutions)
    return {
        "base_head": snapshot["head"],
        "substitutions": state["substitutions"],
        "changes": changes,
        "source": source,
        "details": ("Representation of the disease-associated hemoglobin S known variant "
                    "for research; not a treatment or improvement."),
        "limitations": ("In-silico protein sequence representation only, not an edit to a genome "
                        "or a structural prediction. The ClinVar record can change and does not "
                        "establish effects of other substitutions. Not for diagnosis, treatment, "
                        "or patient-specific interpretation. Review the original source."),
    }
