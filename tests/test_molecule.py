import hashlib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MolecularAssetsTests(unittest.TestCase):
    def test_structure_provenance_and_chains(self):
        data = (ROOT / "web/structures/2hhb.pdb").read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(),
                         "d04b447c1177616e37d39e5af23b44d6aa85b5de74ed7ead84e1f0f5ff1fd40d")
        lines = data.decode("ascii").splitlines()
        self.assertTrue(any("1.74 ANGSTROMS" in line for line in lines))
        self.assertTrue(any("6726807" in line for line in lines))
        chains = {line[21] for line in lines if line.startswith("ATOM  ")}
        self.assertEqual(chains, {"A", "B", "C", "D"})
        self.assertTrue(any(line.startswith("HETATM") and line[17:20] == "HEM" for line in lines))


if __name__ == "__main__":
    unittest.main()
