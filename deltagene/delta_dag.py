"""Core Delta/DAG data model for DeltaGene.

A Delta is an atomic, attributed unit of research work: a literature
citation, a variant classification, a detected conflict, a compliance
gate, a human sign-off, or a therapy match. Deltas form a DAG (each names
its parent delta ids) so that disagreement between agents or humans
*forks* the graph instead of silently overwriting a prior claim -- the
same model Zed's DeltaDB uses for collaborative code review, applied here
to genomics claims instead of code edits.

This module has no external dependencies and no LLM calls: it is the
deterministic substrate every agent reads from and writes to.
"""
from __future__ import annotations

import dataclasses
import json
import os
import time
import uuid
from typing import Any, Literal

DeltaKind = Literal[
    "evidence",
    "classification",
    "conflict",
    "gate",
    "signoff",
    "therapy_match",
]

VALID_KINDS: tuple[DeltaKind, ...] = (
    "evidence",
    "classification",
    "conflict",
    "gate",
    "signoff",
    "therapy_match",
)


@dataclasses.dataclass(frozen=True)
class Delta:
    """One atomic, attributed claim in the research thread.

    subject: stable key for the thing this delta concerns, e.g.
        "HBB:c.20A>T" (gene:variant). All deltas about the same variant
        share a subject so they can be diffed against each other.
    parents: ids of the delta(s) this one responds to or builds on.
        Empty for a root claim (e.g. the first evidence delta).
    payload: kind-specific structured data. See README.md "Delta payload
        shapes" for the contract each agent reads/writes.
    """

    id: str
    kind: DeltaKind
    author: str
    subject: str
    payload: dict[str, Any]
    parents: tuple[str, ...] = dataclasses.field(default_factory=tuple)
    created_at: float = dataclasses.field(default_factory=time.time)

    @staticmethod
    def new(
        kind: DeltaKind,
        author: str,
        subject: str,
        payload: dict[str, Any],
        parents: tuple[str, ...] | list[str] = (),
    ) -> "Delta":
        if kind not in VALID_KINDS:
            raise ValueError(f"unknown delta kind: {kind!r}")
        return Delta(
            id=uuid.uuid4().hex[:12],
            kind=kind,
            author=author,
            subject=subject,
            payload=payload,
            parents=tuple(parents),
        )

    def to_dict(self) -> dict[str, Any]:
        d = dataclasses.asdict(self)
        d["parents"] = list(d["parents"])
        return d

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "Delta":
        d = dict(d)
        d["parents"] = tuple(d.get("parents", ()))
        return Delta(**d)


class DeltaDAG:
    """Append-only store of Deltas, optionally persisted to a JSON file.

    This is intentionally a thin, auditable store -- every number a judge
    sees in the demo can be traced back through `history()` to the exact
    evidence and rule that produced it.
    """

    def __init__(self, path: str | None = None):
        self._deltas: dict[str, Delta] = {}
        self._path = path
        if path and os.path.exists(path):
            self._load()

    def add(self, delta: Delta) -> Delta:
        for parent_id in delta.parents:
            if parent_id not in self._deltas:
                raise KeyError(f"unknown parent delta id: {parent_id}")
        self._deltas[delta.id] = delta
        if self._path:
            self._save()
        return delta

    def get(self, delta_id: str) -> Delta:
        return self._deltas[delta_id]

    def all(self) -> list[Delta]:
        return list(self._deltas.values())

    def by_subject(self, subject: str, kind: DeltaKind | None = None) -> list[Delta]:
        ds = (d for d in self._deltas.values() if d.subject == subject)
        if kind is not None:
            ds = (d for d in ds if d.kind == kind)
        return sorted(ds, key=lambda d: d.created_at)

    def leaves(self, subject: str, kind: DeltaKind | None = None) -> list[Delta]:
        """Deltas nothing else has responded to yet -- the open forks."""
        ds = self.by_subject(subject, kind)
        parented = {p for d in self.by_subject(subject) for p in d.parents}
        return [d for d in ds if d.id not in parented]

    def history(self, delta_id: str) -> list[Delta]:
        """Walk a delta's parent chain back to its root, oldest first."""
        chain: list[Delta] = []
        current = self.get(delta_id)
        seen = set()
        while True:
            if current.id in seen:
                raise ValueError(f"cycle detected at delta {current.id}")
            seen.add(current.id)
            chain.append(current)
            if not current.parents:
                break
            current = self.get(current.parents[0])
        return list(reversed(chain))

    def _save(self) -> None:
        assert self._path
        tmp_path = f"{self._path}.tmp"
        with open(tmp_path, "w") as f:
            json.dump([d.to_dict() for d in self._deltas.values()], f, indent=2)
        os.replace(tmp_path, self._path)

    def _load(self) -> None:
        assert self._path
        with open(self._path) as f:
            raw = json.load(f)
        for r in raw:
            delta = Delta.from_dict(r)
            self._deltas[delta.id] = delta
