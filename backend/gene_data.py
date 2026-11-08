"""Live human HBB research overview from NCBI Gene and ClinVar.

HTTP integration: call get_gene_research(symbol="HBB", max_variants=5) and
JSON-encode the returned dict. Map ValueError to HTTP 400 and GeneDataError to
HTTP 502/503; do not expose exception causes to clients. Calls are synchronous,
make up to three requests, and have no cache. Requests are spaced within this
process, but other processes using the same IP also count toward NCBI limits.
Do not accept patient data or free-text queries through this interface.
"""

import json
import os
import threading
import time
from datetime import datetime, timezone
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen


_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
_TIMEOUT = 8
_MAX_BYTES = 1024 * 1024
_request_lock = threading.Lock()
_last_request = 0.0


class GeneDataError(Exception):
    """A public source was unavailable or returned an unusable response."""


def _request(endpoint, params):
    global _last_request
    params = {**params, "tool": "EditVerse"}
    url = _BASE + endpoint + "?" + urlencode(params)
    contact = os.environ.get("NCBI_EMAIL")
    request_url = url + ("&" + urlencode({"email": contact}) if contact else "")
    try:
        # Coordinate callers within this server process to respect NCBI's
        # unauthenticated request rate. Other processes sharing an IP count too.
        with _request_lock:
            delay = 0.4 - (time.monotonic() - _last_request)
            if delay > 0:
                time.sleep(delay)
            _last_request = time.monotonic()
            with urlopen(request_url, timeout=_TIMEOUT) as response:
                data = response.read(_MAX_BYTES + 1)
        if len(data) > _MAX_BYTES:
            raise GeneDataError("NCBI response exceeded the size limit")
        result = json.loads(data)
        if not isinstance(result, dict) or "error" in result:
            raise GeneDataError("NCBI returned an error response")
        return result, url
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        raise GeneDataError("NCBI request failed or returned invalid JSON") from exc


def _variant(uid, record):
    classification = record.get("germline_classification") or {}
    return {
        "id": uid,
        "accession": record["accession"],
        "accession_version": record.get("accession_version") or None,
        "title": record["title"],
        "germline_classification": classification.get("description") or None,
        "review_status": classification.get("review_status") or None,
        "last_evaluated": classification.get("last_evaluated") or None,
        "url": "https://www.ncbi.nlm.nih.gov/clinvar/variation/" + uid + "/",
    }


def lookup_hbb_variant(variation_id):
    """Look up one ClinVar variation ID associated with human HBB (Gene ID 3043).

    Accepts only a decimal ID string of at most 12 digits. ValueError means
    invalid or out-of-scope ID; GeneDataError means source failure or an
    unavailable record (NCBI does not always distinguish a missing record).
    The caller may JSON-encode the result; it contains no patient information.
    """
    if (not isinstance(variation_id, str) or not variation_id.isascii()
            or not variation_id.isdigit() or len(variation_id) > 12
            or int(variation_id) == 0):
        raise ValueError("variation_id must be a positive decimal ClinVar ID")
    uid = str(int(variation_id))
    data, request_url = _request(
        "esummary.fcgi", {"db": "clinvar", "id": uid, "retmode": "json"}
    )
    try:
        result = data["result"]
        if uid not in result:
            if result.get("uids") == []:
                raise ValueError("ClinVar variation not found")
            raise GeneDataError("NCBI returned an incomplete or unexpected response")
        record = result[uid]
        genes = record["genes"]
        if not isinstance(genes, list):
            raise TypeError("invalid genes")
        if not any(str(gene.get("geneid")) == "3043" for gene in genes):
            raise ValueError("ClinVar variation is not associated with HBB")
        return {
            "variant": _variant(uid, record),
            "provenance": {
                "provider": "NCBI ClinVar via E-utilities",
                "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
                "request_url": request_url,
            },
            "limitations": [
                "Research only; not for diagnosis, treatment, or patient-specific interpretation.",
                "HBB association is based on ClinVar's gene list and may include multi-gene records.",
                "Germline classifications are submitted assertions, may conflict or change, and require review of the original record and evidence.",
                "One variation record is not a consensus about an allele or all related records; ClinVar may include haplotypes and other complex records.",
                "A missing germline classification is not a benign classification.",
            ],
        }
    except (KeyError, TypeError, AttributeError) as exc:
        raise GeneDataError("NCBI returned an incomplete or unexpected response") from exc


def get_gene_research(symbol="HBB", max_variants=5):
    """Return a JSON-serializable HBB overview; never accepts patient details.

    Only the human official symbol HBB is supported, case-insensitively.
    max_variants is an integer from 1 to 10. Results are a relevance-sorted,
    non-exhaustive ClinVar sample, not diagnostic or treatment guidance.
    ValueError indicates invalid input; GeneDataError indicates source failure.
    """
    if not isinstance(symbol, str) or symbol.strip().upper() != "HBB":
        raise ValueError("Only the human gene symbol HBB is supported")
    if type(max_variants) is not int or not 1 <= max_variants <= 10:
        raise ValueError("max_variants must be an integer between 1 and 10")

    gene_data, gene_url = _request(
        "esummary.fcgi", {"db": "gene", "id": "3043", "retmode": "json"}
    )
    search_data, search_url = _request(
        "esearch.fcgi",
        {"db": "clinvar", "term": "HBB[gene]", "retmode": "json",
         "retmax": max_variants, "sort": "relevance"},
    )
    try:
        gene = gene_data["result"]["3043"]
        if gene["name"] != "HBB" or gene["organism"]["taxid"] != 9606:
            raise ValueError("unexpected gene identity")
        search = search_data["esearchresult"]
        count = int(search["count"])
        ids = search["idlist"]
        if (count < 0 or not isinstance(ids, list) or len(ids) > max_variants
                or len(ids) > count or any(not isinstance(i, str) or not i.isdigit() for i in ids)
                or len(set(ids)) != len(ids)):
            raise ValueError("unexpected search result")
        variants = []
        summary_url = None
        if ids:
            summary_data, summary_url = _request(
                "esummary.fcgi",
                {"db": "clinvar", "id": ",".join(ids), "retmode": "json"},
            )
            records = summary_data["result"]
            for uid in ids:
                record = records[uid]
                variants.append(_variant(uid, record))
        return {
            "gene": {
                "symbol": gene["name"], "gene_id": "3043",
                "organism": gene["organism"]["scientificname"],
                "description": gene["description"], "summary": gene.get("summary") or None,
                "url": "https://www.ncbi.nlm.nih.gov/gene/3043",
            },
            "clinvar": {
                "query": "HBB[gene]", "total_matching_records": count,
                "returned_records": len(variants), "sort": "relevance",
                "variants": variants,
            },
            "provenance": {
                "provider": "NCBI E-utilities",
                "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
                "gene_request_url": gene_url, "clinvar_search_url": search_url,
                "clinvar_summary_url": summary_url,
            },
            "limitations": [
                "Research overview only; not for diagnosis, treatment, or patient-specific interpretation.",
                "ClinVar results are a relevance-sorted sample, not a complete or representative variant catalogue; records and rankings change.",
                "ClinVar classifications are submitted assertions, may conflict or change, and require review of the original records and evidence.",
                "Individual records are not consensus about an allele or all related records; ClinVar may include haplotypes and other complex records.",
                "Gene associations can include records spanning multiple genes. Missing germline classification is not a benign classification.",
            ],
        }
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise GeneDataError("NCBI returned an incomplete or unexpected response") from exc
