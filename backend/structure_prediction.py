"""Remote single-chain ESMFold prediction.

Provider retention terms are unknown. Availability is not guaranteed; even
valid sequences can time out upstream.
"""

import http.client
import json
import math
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path

try:
    from . import hbb_sequence
except ImportError:
    import hbb_sequence

URL = "https://api.esmatlas.com/foldSequence/v1/pdb/"
TIMEOUT_SECONDS = 60  # Overall caller deadline and individual socket-operation timeout.
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_IN_FLIGHT = 2
_slots = threading.BoundedSemaphore(MAX_IN_FLIGHT)
_RESIDUES = dict(zip(
    ("ALA", "CYS", "ASP", "GLU", "PHE", "GLY", "HIS", "ILE", "LYS", "LEU",
     "MET", "ASN", "PRO", "GLN", "ARG", "SER", "THR", "VAL", "TRP", "TYR"),
    "ACDEFGHIKLMNPQRSTVWY"))
MODAL_MODEL_REVISION = "75a3841ee059df2bf4d56688166c8fb459ddd97a"
MODAL_TIMEOUT_SECONDS = 720
MODAL_QUEUE_TIMEOUT_SECONDS = 720
MODAL_MAX_CALLERS = 32


class PredictionError(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_sequence(sequence):
    if (not isinstance(sequence, str) or len(sequence) != 147
            or not set(sequence) <= hbb_sequence.AMINO_ACIDS):
        raise PredictionError("Invalid saved sequence.", 400)


def provider_name():
    provider = os.environ.get("EDITVERSE_FOLD_PROVIDER", "atlas")
    if provider == "atlas":
        return "ESM Metagenomic Atlas"
    if provider == "modal":
        return "Modal"
    raise PredictionError("Unknown prediction provider configuration.", 503)


def validate_pdb(data, sequence):
    """Reject malformed coordinates and anything other than the requested chain."""
    try:
        text = data.decode("ascii")
        if any(ord(c) < 32 and c not in "\r\n" for c in text):
            raise ValueError
        residues = {}
        atoms = {}
        ca_coordinates = {}
        chain = None
        models = 0
        for line in text.splitlines():
            record = line[:6].strip()
            if record == "MODEL":
                models += 1
                if models > 1 or residues:
                    raise ValueError
            if record == "HETATM":
                raise ValueError
            if record != "ATOM":
                continue
            if len(line) < 54 or line[16] != " ":
                raise ValueError
            atom, name, atom_chain = line[12:16].strip(), line[17:20], line[21]
            if not atom or name not in _RESIDUES:
                raise ValueError
            key = int(line[22:26])
            if line[26] != " ":
                raise ValueError
            if chain is None:
                chain = atom_chain
            if chain != atom_chain:
                raise ValueError
            if key in residues and residues[key] != name:
                raise ValueError
            residues[key] = name
            coordinates = tuple(float(line[i:i + 8]) for i in (30, 38, 46))
            if not all(math.isfinite(value) for value in coordinates):
                raise ValueError
            names = atoms.setdefault(key, set())
            if atom in names:
                raise ValueError
            names.add(atom)
            if atom == "CA":
                ca_coordinates[key] = coordinates
        if (list(residues) != list(range(1, 148))
                or any(not {"N", "CA", "C", "O"} <= atoms[key] for key in residues)):
            raise ValueError
        if "".join(_RESIDUES[name] for name in residues.values()) != sequence:
            raise ValueError
        points = [ca_coordinates[key] for key in residues]
        # Only reject essentially coincident adjacent CAs, not unusual conformations.
        if any(math.dist(a, b) < 0.1 for a, b in zip(points, points[1:])):
            raise ValueError
        return text
    except (ValueError, UnicodeDecodeError, TypeError, OverflowError):
        raise PredictionError("Prediction provider returned an invalid structure.", 502) from None


def predict(sequence):
    validate_sequence(sequence)
    provider = provider_name()
    if provider == "Modal":
        return _modal_scheduler.predict(sequence)
    if not _slots.acquire(blocking=False):
        raise PredictionError("Prediction capacity is busy.", 429)
    done = threading.Event()
    result = []

    def run():
        try:
            result.append((True, _request(sequence)))
        except PredictionError as exc:
            result.append((False, exc))
        except Exception:
            result.append((False, PredictionError("Prediction provider is unavailable.", 502)))
        finally:
            _slots.release()
            done.set()

    try:
        threading.Thread(target=run, daemon=True).start()
    except Exception:
        _slots.release()
        raise PredictionError("Prediction provider is unavailable.", 502) from None
    if not done.wait(TIMEOUT_SECONDS):
        # The worker retains its slot until the underlying network operation ends.
        raise PredictionError("Prediction provider timed out.", 504)
    ok, value = result[0]
    if not ok:
        raise value
    return value


class _ModalJob:
    def __init__(self, key):
        self.key = key
        self.callers = 0
        self.started = False
        self.started_at = None
        self.deadline = None
        self.result = None


class _ModalScheduler:
    """FIFO admission for distinct jobs; completed results are never cached."""

    def __init__(self):
        self.condition = threading.Condition()
        self.jobs = {}
        self.queue = deque()
        self.active = 0
        self.callers = 0

    def predict(self, sequence):
        queue_deadline = time.monotonic() + MODAL_QUEUE_TIMEOUT_SECONDS
        key = (sequence, "facebook/esmfold_v1", MODAL_MODEL_REVISION)
        with self.condition:
            if self.callers >= MODAL_MAX_CALLERS:
                raise PredictionError("Prediction capacity is busy.", 429)
            job = self.jobs.get(key)
            if job is None:
                job = _ModalJob(key)
                self.jobs[key] = job
                self.queue.append(job)
            job.callers += 1
            self.callers += 1
            self.condition.notify_all()
            try:
                while True:
                    if job.started_at is not None and job.started_at >= queue_deadline:
                        raise PredictionError("Prediction provider timed out.", 504)
                    remaining = (job.deadline if job.started else queue_deadline) - time.monotonic()
                    if remaining <= 0:
                        raise PredictionError("Prediction provider timed out.", 504)
                    if job.result is not None:
                        ok, value = job.result
                        if not ok:
                            raise PredictionError(*value)
                        return value
                    if (not job.started and self.queue[0] is job
                            and self.active < MAX_IN_FLIGHT):
                        started_at = time.monotonic()
                        if started_at >= queue_deadline:
                            raise PredictionError("Prediction provider timed out.", 504)
                        self.queue.popleft()
                        job.started = True
                        job.started_at = started_at
                        job.deadline = job.started_at + MODAL_TIMEOUT_SECONDS
                        self.active += 1
                        try:
                            threading.Thread(target=self._run, args=(job,), daemon=True).start()
                        except Exception:
                            self.active -= 1
                            job.result = (False, ("Prediction provider is unavailable.", 502))
                        self.condition.notify_all()
                        continue
                    self.condition.wait(remaining)
            finally:
                self.callers -= 1
                job.callers -= 1
                if not job.started and job.callers == 0:
                    self.queue.remove(job)
                    self.jobs.pop(job.key, None)
                elif job.result is not None and job.callers == 0:
                    self.jobs.pop(job.key, None)
                self.condition.notify_all()

    def _run(self, job):
        try:
            result = (True, _modal_request(job.key[0]))
        except PredictionError as exc:
            result = (False, (str(exc), exc.status))
        except BaseException:
            result = (False, ("Prediction provider is unavailable.", 502))
        with self.condition:
            job.result = result
            self.active -= 1
            if job.callers == 0:
                self.jobs.pop(job.key, None)
            self.condition.notify_all()


_modal_scheduler = _ModalScheduler()


def _modal_request(sequence):
    client = Path(__file__).with_name("modal_fold_client.py")
    # The child needs Modal authentication and basic process settings, not the
    # server's unrelated provider credentials (for example, GEMINI_API_KEY).
    allowed = ("PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL",
               "XDG_CACHE_HOME", "UV_CACHE_DIR", "SSL_CERT_FILE",
               "REQUESTS_CA_BUNDLE", "MODAL_CONFIG_PATH", "MODAL_PROFILE",
               "MODAL_ENVIRONMENT", "MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET")
    child_env = {key: os.environ[key] for key in allowed if key in os.environ}
    child_env["UV_NO_PROGRESS"] = "1"
    try:
        completed = subprocess.run(
            ["uv", "run", "--no-project", "--with", "modal==1.6.3", "python", str(client)],
            input=sequence, text=True, capture_output=True, timeout=MODAL_TIMEOUT_SECONDS, check=False,
            env=child_env,
        )
        if completed.returncode or len(completed.stdout) > MAX_RESPONSE_BYTES:
            raise PredictionError("Modal prediction failed. Check authentication and deployment.", 502)
        result = json.loads(completed.stdout)
        provenance = result["provenance"]
        scores = result["plddt_ca"]
        if (provenance["model"] != "facebook/esmfold_v1"
                or provenance["revision"] != MODAL_MODEL_REVISION
                or not isinstance(scores, list) or len(scores) != len(sequence)
                or any(isinstance(score, bool) or not isinstance(score, (int, float))
                       or not math.isfinite(score) or not 0 <= score <= 100 for score in scores)):
            raise ValueError
        return validate_pdb(result["pdb"].encode("ascii"), sequence)
    except subprocess.TimeoutExpired:
        raise PredictionError("Modal prediction timed out.", 504) from None
    except (OSError, ValueError, KeyError, TypeError, UnicodeError):
        raise PredictionError("Modal prediction failed or returned invalid output.", 502) from None


def _request(sequence):
    request = urllib.request.Request(URL, data=sequence.encode("ascii"), method="POST",
                                     headers={"Content-Type": "text/plain", "Accept": "text/plain"})
    # Never forward sequence to redirects or a proxy inherited from the environment.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise PredictionError("Prediction provider returned an HTTP error.", 502)
            data = response.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                raise PredictionError("Prediction provider response is too large.", 502)
    except urllib.error.HTTPError as exc:
        code = exc.code
        exc.close()
        if code in (408, 504):
            raise PredictionError("Prediction provider timed out.", 504) from None
        if code == 429:
            raise PredictionError("Prediction provider is rate limiting requests.", 503) from None
        raise PredictionError("Prediction provider returned an HTTP error.", 502) from None
    except (TimeoutError, socket.timeout):
        raise PredictionError("Prediction provider timed out.", 504) from None
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise PredictionError("Prediction provider timed out.", 504) from None
        raise PredictionError("Prediction provider is unavailable.", 502) from None
    except (OSError, http.client.HTTPException):
        raise PredictionError("Prediction provider is unavailable.", 502) from None
    return validate_pdb(data, sequence)
