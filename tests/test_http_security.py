import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from backend import server


class LocalHTTPBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.old_store = server.STORE
        server.STORE = server.Store()
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.host = f"127.0.0.1:{self.http.server_port}"

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        server.STORE.db.close()
        server.STORE = self.old_store

    def request(self, method, path, headers=(), body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=3)
        conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        for name, value in headers:
            conn.putheader(name, value)
        conn.endheaders(body)
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        conn.close()
        return result

    def test_host_checked_for_static_and_api_including_duplicates(self):
        for path in ("/", "/api/state", "/api/export"):
            for hosts in ([], [("Host", "attacker.example")],
                          [("Host", self.host), ("Host", self.host)],
                          [("Host", "localhost:1")]):
                with self.subTest(path=path, hosts=hosts):
                    self.assertEqual(self.request("GET", path, hosts)[0], 403)
        self.assertEqual(self.request("GET", "/api/state", [("Host", self.host)])[0], 200)
        self.assertEqual(self.request("GET", "/", [("Host", f"localhost:{self.http.server_port}")])[0], 200)

    def test_security_headers_and_no_directory_listing(self):
        for path in ("/", "/api/state", "/missing"):
            _, headers, _ = self.request("GET", path, [("Host", self.host)])
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(headers["X-Frame-Options"], "DENY")
            self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
            self.assertEqual(headers["Cache-Control"], "no-store")

    def test_public_gene_and_variant_endpoints(self):
        headers = [("Host", self.host)]
        with patch.object(server.gene_data, "get_gene_research", return_value={"gene": {"symbol": "HBB"}}):
            status, _, body = self.request("GET", "/api/gene", headers)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["gene"]["symbol"], "HBB")
        with patch.object(server.gene_data, "lookup_hbb_variant", return_value={"variant": {"id": "123"}}) as lookup:
            status, _, body = self.request("GET", "/api/variant?id=123", headers)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["variant"]["id"], "123")
            lookup.assert_called_once_with("123")
        self.assertEqual(self.request("GET", "/api/variant?id=1&id=2", headers)[0], 400)
        with patch.object(server.gene_data, "get_gene_research", side_effect=server.gene_data.GeneDataError):
            self.assertEqual(self.request("GET", "/api/gene", headers)[0], 502)

    def test_molecular_assets_are_local_and_keep_csp(self):
        for path in ("/molecule.js", "/vendor/3Dmol-min.js", "/structures/2hhb.pdb"):
            with self.subTest(path=path):
                status, headers, body = self.request("GET", path, [("Host", self.host)])
                self.assertEqual(status, 200)
                self.assertTrue(body)
                self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
                self.assertNotIn("unsafe-eval", headers["Content-Security-Policy"])

    def test_git_notes_round_trip_and_stale_write(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(server, "NOTES", server.git_history.GitHistory(Path(directory) / "notes.git")):
            headers = [("Host", self.host)]
            status, _, body = self.request("GET", "/api/notes", headers)
            self.assertEqual(status, 200)
            self.assertIsNone(json.loads(body)["head"])
            payload = json.dumps({"content": "Public record VCV123", "head": None, "message": "Review"}).encode()
            post_headers = headers + [("Content-Type", "application/json"), ("Content-Length", str(len(payload)))]
            status, _, body = self.request("POST", "/api/notes", post_headers, payload)
            self.assertEqual(status, 200)
            head = json.loads(body)["head"]
            status, _, body = self.request("GET", "/api/notes/diff?commit=" + head, headers)
            self.assertEqual(status, 200)
            self.assertIn("+Public record VCV123", json.loads(body)["diff"])
            self.assertEqual(self.request("POST", "/api/notes", post_headers, payload)[0], 409)

    def test_origin_and_request_framing(self):
        body = json.dumps({"text": "Review governance", "draft_revision": 0}).encode()
        common = [("Host", self.host), ("Content-Type", "application/json")]
        length = [("Content-Length", str(len(body)))]
        for extra in ([("Origin", "http://evil.example")],
                      [("Origin", "https://" + self.host)],
                      [("Origin", "http://" + self.host), ("Origin", "http://" + self.host)]):
            self.assertEqual(self.request("PUT", "/api/draft", common + length + extra, body)[0], 403)
        for extra, expected in (([], 411), ([("Content-Length", "-1")], 411),
                                (length + length, 411),
                                ([("Content-Length", "8193")], 413),
                                (length + [("Transfer-Encoding", "chunked")], 400)):
            self.assertEqual(self.request("PUT", "/api/draft", common + extra, body)[0], expected)
        self.assertEqual(self.request("PUT", "/api/draft",
                                     common + length + [("Origin", "http://" + self.host)], body)[0], 200)


if __name__ == "__main__":
    unittest.main()
