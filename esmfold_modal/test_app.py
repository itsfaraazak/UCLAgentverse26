"""Offline tests; no Modal account, model download, or GPU required."""

import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch


class FakeImage:
    @classmethod
    def debian_slim(cls, **kwargs):
        return cls()

    def pip_install(self, *args):
        return self


class FakeApp:
    def __init__(self, *args, **kwargs):
        pass

    def function(self, **kwargs):
        return lambda fn: fn

    def local_entrypoint(self):
        return lambda fn: fn


fake_modal = types.SimpleNamespace(Image=FakeImage, App=FakeApp)
spec = importlib.util.spec_from_file_location("hbb_fold_app", pathlib.Path(__file__).with_name("app.py"))
app = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"modal": fake_modal}):
    spec.loader.exec_module(app)


class ValidationTest(unittest.TestCase):
    def test_any_147_standard_amino_acids(self):
        self.assertEqual(app.validate_sequence("A" * 147), "A" * 147)
        self.assertEqual(app.validate_sequence("ACDEFGHIKLMNPQRSTVWY" * 7 + "ACDEFGH"),
                         "ACDEFGHIKLMNPQRSTVWY" * 7 + "ACDEFGH")

    def test_reject_invalid_input(self):
        for sequence in ("A" * 146, "A" * 148, "A" * 146 + "X",
                         "A" * 146 + "a", "A" * 146 + "\n", None, 147):
            with self.subTest(sequence=sequence):
                with self.assertRaises(ValueError):
                    app.validate_sequence(sequence)

    def test_invalid_sequence_does_not_import_model(self):
        with self.assertRaises(ValueError):
            app.fold_hbb("invalid")


if __name__ == "__main__":
    unittest.main()
