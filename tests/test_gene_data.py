import io
import json
import unittest
from unittest.mock import patch
from urllib.error import URLError

from backend import gene_data


GENE = {"result": {"3043": {"name": "HBB", "description": "beta",
                             "organism": {"taxid": 9606, "scientificname": "Homo sapiens"}}}}
SEARCH = {"esearchresult": {"count": "2", "idlist": ["123"]}}
RECORD = {"accession": "VCV000000123", "accession_version": "VCV000000123.1", "title": "example record",
          "genes": [{"geneid": "3043"}],
          "germline_classification": {"description": "Uncertain significance",
                                      "review_status": "criteria provided"}}
SUMMARY = {"result": {"uids": ["123"], "123": RECORD}}


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class GeneDataTests(unittest.TestCase):
    def test_workflow_fetches_and_attributes_live_records(self):
        calls = []

        def fetch(url, timeout):
            calls.append((url, timeout))
            return Response(json.dumps([GENE, SEARCH, SUMMARY][len(calls) - 1]).encode())

        with patch.object(gene_data, "_last_request", 0.0), \
             patch.object(gene_data, "urlopen", side_effect=fetch), \
             patch.object(gene_data.time, "sleep") as sleep:
            result = gene_data.get_gene_research(" hbb ", 1)
        self.assertEqual(result["gene"]["symbol"], "HBB")
        self.assertEqual(result["clinvar"]["total_matching_records"], 2)
        self.assertEqual(result["clinvar"]["variants"][0]["accession"], "VCV000000123")
        self.assertIn("HBB%5Bgene%5D", calls[1][0])
        self.assertTrue(all(timeout == 8 for _, timeout in calls))
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(result["provenance"]["clinvar_summary_url"], calls[2][0])
        json.dumps(result)

    def test_lookup_validates_association_and_attributes_source(self):
        with patch.object(gene_data, "_request", return_value=(SUMMARY, "source")):
            result = gene_data.lookup_hbb_variant("000123")
        self.assertEqual(result["variant"]["id"], "123")
        self.assertEqual(result["variant"]["accession_version"], "VCV000000123.1")
        self.assertEqual(result["variant"]["review_status"], "criteria provided")
        self.assertEqual(result["provenance"]["request_url"], "source")
        other = {"result": {"123": dict(RECORD, genes=[{"geneid": "1"}])}}
        with patch.object(gene_data, "_request", return_value=(other, "source")):
            with self.assertRaises(ValueError):
                gene_data.lookup_hbb_variant("123")

    def test_invalid_input_never_reaches_network(self):
        with patch.object(gene_data, "urlopen") as fetch:
            for value in ("BRCA1", "", None, "HBB patient"):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    gene_data.get_gene_research(value)
            for value in (0, 11, True, "1"):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    gene_data.get_gene_research(max_variants=value)
            for value in ("", "-1", "１２３", "123;BRCA1", "0", "1" * 13, 123):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    gene_data.lookup_hbb_variant(value)
            fetch.assert_not_called()

    def test_empty_search_and_missing_classification(self):
        empty = {"esearchresult": {"count": "0", "idlist": []}}
        with patch.object(gene_data, "_request", side_effect=[(GENE, "gene"), (empty, "search")]), \
             patch.object(gene_data.time, "sleep"):
            result = gene_data.get_gene_research()
        self.assertEqual(result["clinvar"]["variants"], [])
        self.assertIsNone(result["provenance"]["clinvar_summary_url"])
        record = dict(RECORD, germline_classification={})
        with patch.object(gene_data, "_request", return_value=({"result": {"123": record}}, "source")):
            self.assertIsNone(gene_data.lookup_hbb_variant("123")["variant"]["germline_classification"])

    def test_failure_is_explicit_and_no_partial_result(self):
        with patch.object(gene_data, "urlopen", side_effect=URLError("offline")):
            with self.assertRaises(gene_data.GeneDataError):
                gene_data.lookup_hbb_variant("123")
        with patch.object(gene_data, "urlopen", return_value=Response(b"not json")):
            with self.assertRaises(gene_data.GeneDataError):
                gene_data.lookup_hbb_variant("123")
        with patch.object(gene_data, "urlopen", return_value=Response(b"x" * (gene_data._MAX_BYTES + 1))):
            with self.assertRaises(gene_data.GeneDataError):
                gene_data.lookup_hbb_variant("123")
        with patch.object(gene_data, "_request", return_value=({"result": {"123": {"error": "cannot get document summary"}}}, "source")):
            with self.assertRaises(gene_data.GeneDataError):
                gene_data.lookup_hbb_variant("123")


if __name__ == "__main__":
    unittest.main()
