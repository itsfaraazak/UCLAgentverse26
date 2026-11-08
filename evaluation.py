"""Reproducible, synthetic evaluation of the artifact checks, not agent quality.

Run from the repository root: python evaluation.py
"""
from backend.versioning import checks


def artifact(*claims):
    return {"summary": "Synthetic review", "claims": [
        {"text": text, "source_ids": sources} for text, sources in claims
    ]}


# Labels specify the documented mechanical rules, not scientific validity.
CASES = [
    ("one referenced claim", artifact(("A", ["WHO"])), True, True),
    ("two referenced claims", artifact(("A", ["WHO"]), ("B", ["NASEM"])), True, True),
    ("empty artifact", artifact(), False, True),
    ("one missing reference", artifact(("A", [])), False, True),
    ("second missing reference", artifact(("A", ["WHO"]), ("B", [])), False, True),
    ("exact duplicate", artifact(("A", ["WHO"]), ("A", ["NASEM"])), True, False),
    ("duplicate and missing reference", artifact(("A", []), ("A", ["WHO"])), False, False),
    ("three claims with late duplicate", artifact(("A", ["WHO"]), ("B", ["WHO"]), ("A", ["WHO"])), True, False),
    ("case differs", artifact(("A", ["WHO"]), ("a", ["WHO"])), True, True),
    ("whitespace differs", artifact(("A", ["WHO"]), ("A ", ["WHO"])), True, True),
]


def evaluate():
    totals = {name: dict(tp=0, tn=0, fp=0, fn=0)
              for name in ("checks", "baseline")}
    print("Positive = artifact satisfies both documented structural rules.")
    print("case | expected | checks | nonempty-claims baseline")
    for name, item, evidence, unique in CASES:
        expected = evidence and unique
        predictions = {
            "checks": all(c["status"] == "pass" for c in checks(item)),
            "baseline": bool(item["claims"]),
        }
        for method, predicted in predictions.items():
            key = ("tp" if expected else "fp") if predicted else ("fn" if expected else "tn")
            totals[method][key] += 1
        print(f"{name} | {int(expected)} | {int(predictions['checks'])} | {int(predictions['baseline'])}")
    for method, counts in totals.items():
        print(f"{method}: " + " ".join(f"{k.upper()}={v}" for k, v in counts.items()) +
              f" correct={counts['tp'] + counts['tn']}/{len(CASES)}")
    print("Hand-authored rule-conformance cases, not a representative benchmark.")
    print("References are not verified; neither method assesses truth, safety, or agent effectiveness.")
    return totals


if __name__ == "__main__":
    evaluate()
