"""An app-owned bare Git repository for a single UTF-8 research note.

No checkout, index, user repository, or arbitrary filesystem path is modified.
The caller must choose a private, dedicated repository path.
"""

import difflib
import json
import os
import re
import subprocess
from pathlib import Path


class HistoryError(Exception):
    """Base class for note-history errors."""


class InvalidInput(HistoryError):
    pass


class StaleHead(HistoryError):
    pass


class MergeConflict(HistoryError):
    pass


class StorageError(HistoryError):
    pass


class GitHistory:
    """Store notes and sequences on explicit Git branches with optimistic concurrency.

    The repository directory must either not exist or already be one created by
    this class. Initialisation is lazy; reads of a missing repository are empty.
    """

    MARKER = "editverse-note-history-v1\n"
    MAX_CONTENT = 65536
    MAX_MESSAGE = 200

    def __init__(self, path):
        self.path = Path(path).absolute()

    def _git(self, *args, data=None, allowed=(0,)):
        env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        env.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                    "GIT_NO_REPLACE_OBJECTS": "1", "GIT_TERMINAL_PROMPT": "0",
                    "GIT_AUTHOR_NAME": "EditVerse", "GIT_AUTHOR_EMAIL": "editverse@localhost",
                    "GIT_COMMITTER_NAME": "EditVerse", "GIT_COMMITTER_EMAIL": "editverse@localhost"})
        try:
            proc = subprocess.run(["git", "--git-dir", str(self.path),
                                   "-c", "core.hooksPath=" + os.devnull,
                                   "-c", "commit.gpgSign=false", *args],
                                  input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  env=env)
        except OSError as exc:
            raise StorageError("Git is unavailable.") from exc
        if proc.returncode not in allowed:
            raise StorageError("Git history is unavailable or invalid.")
        return proc

    def _exists(self):
        if not self.path.exists() and not self.path.is_symlink():
            return False
        try:
            marker = self.path / "editverse-owner"
            if (self.path.is_symlink() or not self.path.is_dir() or marker.is_symlink()
                    or marker.read_text(encoding="utf-8") != self.MARKER):
                raise StorageError("History path is not an app-owned repository.")
        except (OSError, UnicodeError) as exc:
            raise StorageError("History path is not an app-owned repository.") from exc
        return True

    def _initialise(self):
        if self._exists():
            return
        try:
            # mkdir is exclusive: never initialise, replace or clean up an existing path.
            self.path.mkdir(mode=0o700)
            template = self.path / "empty-template"
            template.mkdir(mode=0o700)
            self._git("init", "--bare", "--initial-branch=main", "--template=" + str(template))
            (self.path / "editverse-owner").write_text(self.MARKER, encoding="utf-8")
        except FileExistsError as exc:
            raise StorageError("History is being initialised; retry.") from exc
        except OSError as exc:
            raise StorageError("Cannot initialise Git history.") from exc

    def _ref(self, branch):
        # Deliberately narrower than Git's syntax: safe as a ref and in update-ref input.
        if (not isinstance(branch, str) or len(branch) > 200
                or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_-]*(?:/[A-Za-z0-9_][A-Za-z0-9_-]*)*", branch)):
            raise InvalidInput("Invalid branch name.")
        return "refs/heads/" + branch

    def _head(self, branch="main"):
        ref = self._ref(branch)
        result = self._git("show-ref", "--verify", "--quiet", ref, allowed=(0, 1))
        if result.returncode == 0:
            return self._git("rev-parse", "--verify", ref).stdout.decode("ascii").strip()
        # A malformed loose or packed ref must not be mistaken for an unborn branch.
        try:
            loose = self.path / ref
            packed = self.path / "packed-refs"
            if loose.exists() or loose.is_symlink() or (packed.exists() and any(
                    line.rstrip().endswith((" " + ref).encode())
                    for line in packed.read_bytes().splitlines())):
                raise StorageError("Git main ref is invalid.")
        except OSError as exc:
            raise StorageError("Git main ref is unavailable.") from exc
        if branch != "main":
            raise InvalidInput("Branch does not exist.")
        return None

    def branches(self):
        if not self._exists():
            return {"branches": []}
        raw = self._git("for-each-ref", "--format=%(refname:strip=2)%00%(objectname)",
                        "refs/heads/").stdout.decode("utf-8")
        return {"branches": [{"name": name, "head": head}
                             for name, head in (line.split("\0") for line in raw.splitlines())]}

    def create_branch(self, name, from_branch, expected_head):
        ref = self._ref(name)
        source = self._ref(from_branch)
        self._validate_head(expected_head)
        if not self._exists():
            raise InvalidInput("Source branch has no commits.")
        head = self._head(from_branch)
        if head != expected_head:
            raise StaleHead("History changed; reload before creating branch.")
        if head is None:
            raise InvalidInput("Source branch has no commits.")
        # Verify source and create destination in a single ref transaction.
        commands = f"start\nverify {source} {head}\ncreate {ref} {head}\nprepare\ncommit\n".encode()
        result = self._git("update-ref", "--stdin", data=commands, allowed=(0, 1, 128))
        if result.returncode:
            if self._head(from_branch) != head:
                raise StaleHead("History changed; reload before creating branch.")
            raise InvalidInput("Branch already exists or cannot be created.")
        return {"name": name, "head": head}

    def _content(self, oid):
        try:
            return self._git("show", oid + ":note.md").stdout.decode("utf-8")
        except UnicodeError as exc:
            raise StorageError("Stored note is not UTF-8.") from exc

    def read(self, branch="main"):
        self._ref(branch)
        if not self._exists():
            if branch != "main":
                raise InvalidInput("Branch does not exist.")
            return {"head": None, "content": "", "history": []}
        head = self._head(branch)
        return self._read_head(head)

    def _read_head(self, head):
        if head is None:
            return {"head": None, "content": "", "history": []}
        # The captured object ID makes this read coherent if another writer advances main.
        ids = self._git("rev-list", "--first-parent", "--max-count=50", head).stdout.decode("ascii").splitlines()
        history = []
        for oid in ids:
            raw = self._git("show", "-s", "--format=%s%x00%cI", oid).stdout
            try:
                message, timestamp = raw.decode("utf-8").rstrip("\n").split("\0", 1)
            except (UnicodeError, ValueError) as exc:
                raise StorageError("Invalid commit metadata.") from exc
            history.append({"commit": oid, "message": message, "timestamp": timestamp})
        return {"head": head, "content": self._content(head), "history": history}

    def _validate_head(self, expected_head):
        if expected_head is not None and (not isinstance(expected_head, str)
                                          or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", expected_head)):
            raise InvalidInput("Expected head must be a full Git object ID or null.")

    def _validate_message(self, message):
        try:
            encoded = message.encode("utf-8") if isinstance(message, str) else None
        except UnicodeError as exc:
            raise InvalidInput("Message must be UTF-8 text.") from exc
        if (encoded is None or not message.strip() or len(message) > self.MAX_MESSAGE
                or any(ord(c) < 32 or ord(c) == 127 for c in message)):
            raise InvalidInput("Commit message must be a single line of 1–200 characters.")
        return message.strip()

    def save(self, content, expected_head, message, branch="main"):
        try:
            encoded = content.encode("utf-8") if isinstance(content, str) else None
        except UnicodeError as exc:
            raise InvalidInput("Note must be UTF-8 text.") from exc
        if encoded is None or len(encoded) > self.MAX_CONTENT:
            raise InvalidInput("Note must be UTF-8 text of at most 65536 bytes.")
        message = self._validate_message(message)
        self._validate_head(expected_head)
        self._ref(branch)
        if branch != "main" and not self._exists():
            raise InvalidInput("Branch does not exist.")
        self._initialise()
        head = self._head(branch)
        if head != expected_head:
            raise StaleHead("Note changed; reload before saving.")
        if head is not None and self._content(head) == content:
            raise InvalidInput("Note is unchanged.")
        blob = self._git("hash-object", "-w", "--stdin", data=encoded).stdout.strip().decode("ascii")
        return self._commit_file(head, "note.md", blob, message, branch)

    def _commit_file(self, head, name, blob, message, branch="main"):
        # Preserve all entries from the captured parent, including future app files.
        entries = self._git("ls-tree", "-z", head).stdout.split(b"\0") if head else []
        entries = [entry for entry in entries if entry and entry.split(b"\t", 1)[1] != name.encode()]
        if blob is not None:
            entries.append(f"100644 blob {blob}\t{name}".encode())
        tree = self._git("mktree", "-z", data=b"\0".join(entries) + b"\0").stdout.strip().decode("ascii")
        args = ["commit-tree", tree]
        if head:
            args.extend(["-p", head])
        oid = self._git(*args, data=(message + "\n").encode("utf-8")).stdout.strip().decode("ascii")
        # update-ref is atomic and rejects concurrent writers without touching their work.
        old = head or "0" * len(oid)
        result = self._git("update-ref", self._ref(branch), oid, old, allowed=(0, 1, 128))
        if result.returncode:
            if self._head(branch) != head:
                raise StaleHead("Note changed; reload before saving.")
            raise StorageError("Could not update Git history.")
        return self._read_head(oid)

    def sequence_read(self, branch="main"):
        return self._sequence_state(self.read(branch))

    def _sequence_state(self, notes):
        state = self._sequence_at(notes["head"])
        return {"head": notes["head"], **state, "history": notes["history"]}

    def _sequence_at(self, commit):
        try:
            from . import hbb_sequence
        except ImportError:
            import hbb_sequence
        state = hbb_sequence.make_state([])
        if commit:
            result = self._git("cat-file", "-e", commit + ":sequence.json", allowed=(0, 1, 128))
            if result.returncode == 0:
                try:
                    stored = json.loads(self._git("show", commit + ":sequence.json").stdout)
                    state = hbb_sequence.make_state(stored["substitutions"])
                    # Reference identity and sequence data are durable; labels,
                    # links and disclaimers may be corrected without invalidating history.
                    identity = ("accession", "sequence_version", "sequence")
                    if (any(stored["reference"][key] != state["reference"][key] for key in identity)
                            or stored["sequence"] != state["sequence"]
                            or stored["substitutions"] != state["substitutions"]):
                        raise ValueError("Inconsistent sequence state")
                except (ValueError, TypeError, KeyError, InvalidInput) as exc:
                    raise StorageError("Invalid stored sequence state.") from exc
        return state

    def sequence_save(self, substitutions, expected_head, branch="main", message="Propose HBB sequence"):
        try:
            from . import hbb_sequence
        except ImportError:
            import hbb_sequence
        state = hbb_sequence.make_state(substitutions)
        self._validate_head(expected_head)
        message = self._validate_message(message)
        self._ref(branch)
        if branch != "main" and not self._exists():
            raise InvalidInput("Branch does not exist.")
        self._initialise()
        current = self.sequence_read(branch)
        head = current["head"]
        if head != expected_head:
            raise StaleHead("History changed; reload before saving.")
        if state["substitutions"] == current["substitutions"]:
            raise InvalidInput("Sequence is unchanged.")
        encoded = (json.dumps(state, indent=2, ensure_ascii=True) + "\n").encode()
        blob = self._git("hash-object", "-w", "--stdin", data=encoded).stdout.strip().decode("ascii")
        # A sequence-first history still has a note blob for the existing note API.
        if head is None:
            empty = self._git("hash-object", "-w", "--stdin", data=b"").stdout.strip().decode("ascii")
            tree = self._git("mktree", data=f"100644 blob {empty}\tnote.md\n100644 blob {blob}\tsequence.json\n".encode()).stdout.strip().decode("ascii")
            oid = self._git("commit-tree", tree, data=(message + "\n").encode()).stdout.strip().decode("ascii")
            result = self._git("update-ref", self._ref(branch), oid, "0" * len(oid), allowed=(0, 1, 128))
            if result.returncode:
                if self._head(branch) is not None:
                    raise StaleHead("History changed; reload before saving.")
                raise StorageError("Could not update Git history.")
            notes = self._read_head(oid)
        else:
            notes = self._commit_file(head, "sequence.json", blob, message, branch)
        return self._sequence_state(notes)

    def _reachable(self, commit, head):
        if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit):
            raise InvalidInput("Commits must be full Git object IDs.")
        if not head or len(commit) != len(head):
            raise InvalidInput("Commit is not reachable from history.")
        kind = self._git("cat-file", "-t", commit, allowed=(0, 1, 128))
        if kind.returncode or kind.stdout.strip() != b"commit":
            raise InvalidInput("Commit is not reachable from history.")
        reachable = self._git("merge-base", "--is-ancestor", commit, head, allowed=(0, 1, 128))
        if reachable.returncode == 128:
            raise StorageError("Git history is unavailable or invalid.")
        if reachable.returncode:
            raise InvalidInput("Commit is not reachable from history.")

    def sequence_rollback(self, target, expected_head, branch="main", message="Restore HBB sequence"):
        self._validate_head(expected_head)
        message = self._validate_message(message)
        current = self.sequence_read(branch)
        head = current["head"]
        if head != expected_head:
            raise StaleHead("History changed; reload before restoring.")
        self._reachable(target, head)
        # Validate historical state even if its tree predates sequence.json.
        self._sequence_at(target)
        entry = self._git("ls-tree", target, "--", "sequence.json").stdout
        blob = None
        if entry:
            blob = self._git("rev-parse", target + ":sequence.json").stdout.decode("ascii").strip()
        return self._sequence_state(self._commit_file(head, "sequence.json", blob, message, branch))

    def sequence_merge_preview(self, target_branch, source_branch):
        """Compute a three-way residue merge from captured immutable commit IDs."""
        self._ref(target_branch)
        self._ref(source_branch)
        if not self._exists():
            raise InvalidInput("Both branches must have commits.")
        target = self._head(target_branch)
        source = self._head(source_branch)
        if target is None or source is None:
            raise InvalidInput("Both branches must have commits.")
        result = self._git("merge-base", "--all", target, source, allowed=(0, 1))
        bases = result.stdout.decode("ascii").splitlines()
        if not bases:
            raise InvalidInput("Branches have no common ancestor.")
        if len(bases) != 1:
            raise InvalidInput("Branches have multiple merge bases; resolve manually.")
        base = bases[0]
        old = self._sequence_at(base)["sequence"]
        ours = self._sequence_at(target)["sequence"]
        theirs = self._sequence_at(source)["sequence"]
        base_note = self._content(base)
        target_note = self._content(target)
        source_note = self._content(source)
        notes_conflict = source_note != base_note and source_note != target_note
        try:
            from . import hbb_sequence
        except ImportError:
            import hbb_sequence
        substitutions, conflicts = [], []
        for position, (ancestor, target_value, source_value, reference) in enumerate(
                zip(old, ours, theirs, hbb_sequence.REFERENCE["sequence"]), 1):
            if target_value != ancestor and source_value != ancestor and target_value != source_value:
                conflicts.append({"position": position, "old": ancestor,
                                  "target": target_value, "source": source_value})
                continue
            merged = source_value if target_value == ancestor else target_value
            if merged != reference:
                substitutions.append({"position": position, "reference": reference, "alternate": merged})
        return {"base": base, "target": target, "source": source,
                "merged_substitutions": substitutions, "conflicts": conflicts,
                "notes_conflict": notes_conflict}

    def sequence_merge(self, target_branch, source_branch, expected_target_head,
                       expected_source_head, confirmed, message="Merge HBB sequence"):
        self._ref(target_branch)
        self._ref(source_branch)
        self._validate_head(expected_target_head)
        self._validate_head(expected_source_head)
        message = self._validate_message(message)
        if confirmed is not True:
            raise InvalidInput("Explicit merge confirmation is required.")
        preview = self.sequence_merge_preview(target_branch, source_branch)
        target, source = preview["target"], preview["source"]
        if target != expected_target_head or source != expected_source_head:
            raise StaleHead("Branches changed; preview the merge again.")
        if preview["notes_conflict"]:
            raise MergeConflict("Source note changes require manual resolution before merging.")
        if preview["conflicts"]:
            raise MergeConflict("Sequence conflicts require manual resolution.")

        target_ref, source_ref = self._ref(target_branch), self._ref(source_branch)
        # A source already reachable from the target contributes no new ancestry.
        if preview["base"] == source:
            commands = f"start\nverify {target_ref} {target}\n"
            if source_ref != target_ref:
                commands += f"verify {source_ref} {source}\n"
            commands += "prepare\ncommit\n"
            result = self._git("update-ref", "--stdin", data=commands.encode(), allowed=(0, 1, 128))
            if result.returncode:
                raise StaleHead("Branches changed; preview the merge again.")
            return {"status": "source_already_merged", **self._sequence_state(self._read_head(target))}

        try:
            from . import hbb_sequence
        except ImportError:
            import hbb_sequence
        state = hbb_sequence.make_state(preview["merged_substitutions"])
        encoded = (json.dumps(state, indent=2, ensure_ascii=True) + "\n").encode()
        blob = self._git("hash-object", "-w", "--stdin", data=encoded).stdout.strip().decode("ascii")
        entries = self._git("ls-tree", "-z", target).stdout.split(b"\0")
        entries = [entry for entry in entries if entry and entry.split(b"\t", 1)[1] != b"sequence.json"]
        entries.append(f"100644 blob {blob}\tsequence.json".encode())
        tree = self._git("mktree", "-z", data=b"\0".join(entries) + b"\0").stdout.strip().decode("ascii")
        oid = self._git("commit-tree", tree, "-p", target, "-p", source,
                        data=(message + "\n").encode()).stdout.strip().decode("ascii")
        commands = (f"start\nverify {source_ref} {source}\n"
                    f"update {target_ref} {oid} {target}\nprepare\ncommit\n").encode()
        result = self._git("update-ref", "--stdin", data=commands, allowed=(0, 1, 128))
        if result.returncode:
            raise StaleHead("Branches changed or refs could not be updated; preview again.")
        return {"status": "merged", **self._sequence_state(self._read_head(oid))}

    def compare(self, from_commit, to_commit, branch="main"):
        """Compare reachable commits or the immutable, non-Git reference baseline."""
        for commit in (from_commit, to_commit):
            if commit == "reference":
                continue
            if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit):
                raise InvalidInput("Commits must be full Git object IDs.")
        if not self._exists():
            raise InvalidInput("Commit is not reachable from history.")
        head = self._head(branch)
        if head is None:
            raise InvalidInput("Commit is not reachable from history.")
        for commit in (from_commit, to_commit):
            if commit == "reference":
                continue
            self._reachable(commit, head)

        old = self._sequence_at(None if from_commit == "reference" else from_commit)
        new = self._sequence_at(None if to_commit == "reference" else to_commit)
        changes = [{"position": index, "old": a, "new": b}
                   for index, (a, b) in enumerate(zip(old["sequence"], new["sequence"]), 1)
                   if a != b]
        def sequence_lines(sequence):
            return [sequence[index:index + 50] + "\n" for index in range(0, len(sequence), 50)]
        raw_sequence_diff = "".join(difflib.unified_diff(
            sequence_lines(old["sequence"]), sequence_lines(new["sequence"]),
            fromfile="from/protein-sequence", tofile="to/protein-sequence"))

        def patch(filename):
            if "reference" in (from_commit, to_commit):
                return ""
            try:
                return self._git("diff", "--no-ext-diff", "--no-textconv", "--no-renames",
                                 from_commit, to_commit, "--", filename).stdout.decode("utf-8")
            except UnicodeError as exc:
                raise StorageError("Git diff is not UTF-8.") from exc

        def endpoint(identifier, sequence):
            reference = identifier == "reference"
            return {"commit": identifier, "kind": "reference" if reference else "commit",
                    "sequence": sequence, "note": None if reference else self._content(identifier)}

        return {
            "from": endpoint(from_commit, old),
            "to": endpoint(to_commit, new),
            "patch_semantics": (
                "Unavailable: reference is a sequence baseline, not a Git commit or tree. "
                "It has no research note; no sequence or notes Git patch is implied."
                if "reference" in (from_commit, to_commit)
                else "Git diff between the selected commit trees."),
            "sequence": {"diff": patch("sequence.json"), "raw_diff": raw_sequence_diff, "changes": changes},
            "notes": {"diff": patch("note.md")},
        }

    def diff(self, commit, filename="note.md", branch="main"):
        if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit):
            raise InvalidInput("Commit must be a full Git object ID.")
        state = self.read(branch)
        ids = [item["commit"] for item in state["history"]]
        if commit not in ids:
            raise InvalidInput("Commit is not in the note history.")
        try:
            return self._git("diff-tree", "--root", "--no-commit-id", "-p", "--no-ext-diff",
                             "--no-textconv", commit, "--", filename).stdout.decode("utf-8")
        except UnicodeError as exc:
            raise StorageError("Git diff is not UTF-8.") from exc
