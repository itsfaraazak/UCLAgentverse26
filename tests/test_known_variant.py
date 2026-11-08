import copy
import os
import tempfile
import unittest
from unittest import mock

from backend import agent_plan, gene_data, hbb_sequence, known_variant
from backend.git_history import GitHistory, InvalidInput, StaleHead


RECORD = {
    "variant": {
        "id": "15333", "accession": "VCV000015333",
        "accession_version": "VCV000015333.184",
        "title": "NM_000518.5(HBB):c.20A>T (p.Glu7Val)",
        "url": "https://www.ncbi.nlm.nih.gov/clinvar/variation/15333/",
    },
    "provenance": {
        "provider": "NCBI ClinVar via E-utilities",
        "retrieved_at_utc": "2026-01-01T00:00:00+00:00",
        "request_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=15333&retmode=json&tool=EditVerse",
    },
}


class History:
    def __init__(self, substitutions=(), head="captured"):
        self.snapshot = {"head": head, **hbb_sequence.make_state(list(substitutions))}
        self.sequence_read = mock.Mock(side_effect=lambda: copy.deepcopy(self.snapshot))
        self.sequence_save = mock.Mock()


class KnownVariantTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(gene_data, "lookup_hbb_variant", return_value=copy.deepcopy(RECORD))
        self.lookup = patcher.start()
        self.addCleanup(patcher.stop)

    def test_plan_preserves_other_substitutions_and_never_saves(self):
        other = {"position": 2, "reference": "V", "alternate": "A"}
        history = History([other])
        plan = known_variant.propose(history)
        self.assertEqual(set(plan), {"base_head", "substitutions", "changes", "source", "details", "limitations"})
        self.assertEqual(plan["base_head"], "captured")
        self.assertEqual(plan["substitutions"], [other, {"position": 7, "reference": "E", "alternate": "V"}])
        self.assertEqual(plan["changes"], [{"position": 7, "reference": "E", "old": "E", "new": "V"}])
        self.assertEqual(plan["source"]["clinvar"], {
            "accession": RECORD["variant"]["accession"],
            "accession_version": RECORD["variant"]["accession_version"],
            "title": RECORD["variant"]["title"], "url": RECORD["variant"]["url"],
            "provenance": RECORD["provenance"],
        })
        self.assertIn("disease-associated", plan["details"])
        self.assertIn("not a treatment", plan["details"])
        self.assertIn("not an edit to a genome", plan["limitations"])
        history.sequence_read.assert_called_once_with()
        history.sequence_save.assert_not_called()
        self.lookup.assert_called_once_with("15333")

    def test_already_present_is_noop_not_reversion(self):
        variant = {"position": 7, "reference": "E", "alternate": "V"}
        history = History([variant])
        plan = known_variant.propose(history)
        self.assertEqual(plan["changes"], [])
        self.assertEqual(plan["substitutions"], [variant])
        history.sequence_save.assert_not_called()
        self.lookup.assert_called_once_with("15333")

    def test_existing_different_residue_is_explicitly_previewed_not_saved(self):
        history = History([{"position": 7, "reference": "E", "alternate": "K"}])
        plan = known_variant.propose(history)
        self.assertEqual(plan["changes"], [{"position": 7, "reference": "E", "old": "K", "new": "V"}])
        self.assertEqual(plan["substitutions"], [{"position": 7, "reference": "E", "alternate": "V"}])
        self.lookup.assert_called_once_with("15333")
        history.sequence_save.assert_not_called()

    def test_bad_source_fails_closed(self):
        for section, key, bad in [
            ("variant", "id", "1"), ("variant", "accession", "VCV000015334"),
            ("variant", "accession_version", None), ("variant", "accession_version", "VCV000015333.0"),
            ("variant", "title", "NM_000518.5(OTHER):c.20A>T (p.Glu7Val)"),
            ("variant", "title", "NM_000518.5(HBB):c.20A>T (p.Glu7Val); other"),
            ("variant", "url", "https://example.org/"),
            ("provenance", "provider", "other"),
            ("provenance", "retrieved_at_utc", "2026-01-01"),
            ("provenance", "request_url", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=clinvar&id=1&retmode=json"),
        ]:
            with self.subTest(section=section, key=key, bad=bad):
                record = copy.deepcopy(RECORD)
                record[section][key] = bad
                self.lookup.return_value = record
                with self.assertRaises(known_variant.SourceMismatch):
                    known_variant.propose(History())
        for record in (None, {}, {"variant": []}):
            self.lookup.return_value = record
            with self.assertRaises(known_variant.SourceMismatch):
                known_variant.propose(History())

    def test_unavailable_and_hbb_lookup_failure(self):
        self.lookup.side_effect = gene_data.GeneDataError("unavailable")
        with self.assertRaises(gene_data.GeneDataError):
            known_variant.propose(History())
        self.lookup.side_effect = ValueError("not HBB")
        with self.assertRaises(known_variant.SourceMismatch):
            known_variant.propose(History())

    def test_wrong_local_reference_fails_before_lookup(self):
        for key, value in [("accession", "other"), ("sequence_version", 3),
                           ("sequence", "MVHLTPA" + hbb_sequence.REFERENCE["sequence"][7:])]:
            with self.subTest(key=key), mock.patch.dict(hbb_sequence.REFERENCE, {key: value}):
                with self.assertRaises(known_variant.SourceMismatch):
                    known_variant.propose(History())
        self.lookup.assert_not_called()

    def test_branch_adapter_and_optimistic_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            history = GitHistory(os.path.join(tmp, "history.git"))
            initial = history.save("note", None, "initial")
            history.create_branch("research", "main", initial["head"])
            class Branch:
                def sequence_read(self):
                    return history.sequence_read("research")
            plan = known_variant.propose(Branch())
            self.assertEqual(plan["base_head"], initial["head"])
            self.assertEqual(history.sequence_read("research")["substitutions"], [])
            history.save("changed", initial["head"], "advance", branch="research")
            with self.assertRaises(StaleHead):
                history.sequence_save(plan["substitutions"], plan["base_head"], branch="research")
            self.assertEqual(history.sequence_read("main")["head"], initial["head"])

    def test_main_plan_compatible_with_approval_and_noop_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            history = GitHistory(os.path.join(tmp, "history.git"))
            plan = known_variant.propose(history)
            with self.assertRaises(InvalidInput):
                agent_plan.commit_plan(history, plan, approved=False)
            agent_plan.commit_plan(history, plan, approved=True)
            noop = known_variant.propose(history)
            with self.assertRaises(InvalidInput):
                agent_plan.commit_plan(history, noop, approved=True)


if __name__ == "__main__":
    unittest.main()
