"""Content-addressed research artifacts; no sequence design or biological validation."""

import copy
import difflib
import hashlib
import json
from collections import deque


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def checks(artifact):
    claims = artifact["claims"]
    return [
        {"name": "Evidence references", "status": "pass" if claims and all(c["source_ids"] for c in claims) else "fail",
         "detail": "Every claim must reference evidence. References do not establish scientific validity."},
        {"name": "Unique claims", "status": "pass" if len({c["text"] for c in claims}) == len(claims) else "fail",
         "detail": "Duplicate claim text is rejected."},
    ]


def commit(objects, artifact, parents=()):
    content = {"artifact": copy.deepcopy(artifact), "parents": list(parents)}
    oid = digest(content)
    objects[oid] = {**content, "checks": checks(artifact)}
    return oid


def create_workspace(agents):
    objects = {}
    base = commit(objects, {"summary": "Research evidence review", "claims": []})
    branches = {"main": base}
    for index, agent in enumerate(agents):
        branches[f"investigator-{index + 1}"] = commit(
            objects, {"summary": agent["summary"], "claims": agent["claims"]}, [base])
    return {"objects": objects, "branches": branches, "base": base, "comments": []}


def ancestors(objects, start):
    """Return shortest parent distances, including the starting commit."""
    distances = {start: 0}
    queue = deque([start])
    while queue:
        current = queue.popleft()
        for parent in objects[current]["parents"]:
            if parent not in distances:
                distances[parent] = distances[current] + 1
                queue.append(parent)
    return distances


def merge_base(objects, left, right):
    left_distances, right_distances = ancestors(objects, left), ancestors(objects, right)
    common = left_distances.keys() & right_distances.keys()
    if not common:
        raise ValueError("Branches do not have a common ancestor.")
    # Remove common ancestors of another common ancestor. Multiple remaining
    # bases require an explicit resolution rather than silently choosing one.
    candidates = set(common)
    for oid in common:
        candidates.difference_update(set(ancestors(objects, oid)) - {oid})
    if len(candidates) != 1:
        raise ValueError("Branches have multiple merge bases; explicit resolution is required.")
    return candidates.pop()


def merge(workspace, left, right):
    """Three-way field merge. Conflicts return without mutating either branch."""
    objects, branches = workspace["objects"], workspace["branches"]
    left_oid, right_oid = branches[left], branches[right]
    base_oid = merge_base(objects, left_oid, right_oid)
    base = objects[base_oid]["artifact"]
    a, b = (objects[oid]["artifact"] for oid in (left_oid, right_oid))
    merged, conflicts = {}, []
    for field in base:
        if a[field] == b[field] or b[field] == base[field]:
            merged[field] = a[field]
        elif a[field] == base[field]:
            merged[field] = b[field]
        else:
            conflicts.append({"field": field, "base": base[field], "left": a[field], "right": b[field]})
    if conflicts:
        return {"conflicts": conflicts, "base": base_oid, "parents": [left_oid, right_oid],
                "branches": [left, right], "main": branches["main"], "merged": merged}
    oid = commit(objects, merged, [left_oid, right_oid])
    branches["main"] = oid
    return {"commit": oid, "conflicts": []}


def diff(workspace, left, right):
    objects = workspace["objects"]
    a, b = (json.dumps(objects[oid]["artifact"], indent=2, sort_keys=True).splitlines()
            for oid in (left, right))
    return "\n".join(difflib.unified_diff(a, b, fromfile=left[:12], tofile=right[:12], lineterm=""))
