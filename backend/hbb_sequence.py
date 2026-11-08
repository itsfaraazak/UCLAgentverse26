"""A fixed, public HBB reference and bounded in-silico substitutions.

UniProtKB/Swiss-Prot P68871, sequence version 2. Coordinates are 1-based
on the full 147-residue sequence, including the initiator methionine.
"""

try:
    from .git_history import InvalidInput
except ImportError:
    from git_history import InvalidInput

REFERENCE = {
    "accession": "P68871",
    "sequence_version": 2,
    "source_url": "https://www.uniprot.org/uniprotkb/P68871/entry",
    "sequence": (
        "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPK"
        "VKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFG"
        "KEFTPPVQAAYQKVVAGVANALAHKYH"
    ),
}
AMINO_ACIDS = frozenset("ACDEFGHIKLMNPQRSTVWY")
DISCLAIMER = ("Proposed in-silico protein sequence only; not a measured or predicted "
              "3D structure and not for clinical use.")


def make_state(substitutions):
    if not isinstance(substitutions, list) or len(substitutions) > len(REFERENCE["sequence"]):
        raise InvalidInput("Substitutions must be a bounded list.")
    result = []
    positions = set()
    sequence = list(REFERENCE["sequence"])
    for item in substitutions:
        if not isinstance(item, dict) or set(item) != {"position", "reference", "alternate"}:
            raise InvalidInput("Each substitution requires position, reference and alternate.")
        position, reference, alternate = item["position"], item["reference"], item["alternate"]
        if type(position) is not int or not 1 <= position <= len(sequence) or position in positions:
            raise InvalidInput("Positions must be unique integers within the reference sequence.")
        if (not isinstance(reference, str) or len(reference) != 1 or reference not in AMINO_ACIDS
                or not isinstance(alternate, str) or len(alternate) != 1 or alternate not in AMINO_ACIDS):
            raise InvalidInput("Residues must be uppercase standard amino-acid letters.")
        if reference != REFERENCE["sequence"][position - 1] or reference == alternate:
            raise InvalidInput("Reference residue must match and alternate must differ.")
        positions.add(position)
        sequence[position - 1] = alternate
        result.append({"position": position, "reference": reference, "alternate": alternate})
    result.sort(key=lambda item: item["position"])
    return {"reference": dict(REFERENCE), "sequence": "".join(sequence),
            "substitutions": result, "disclaimer": DISCLAIMER}
