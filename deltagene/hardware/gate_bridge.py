"""Hardware-backed sign-off gate: talks to an Arduino Uno Q / ESP32 running
deltagene/hardware/firmware/sign_off_gate.ino over USB serial.

Dependency: pyserial (``pip install pyserial``). Import is optional --
if pyserial isn't installed, this module still imports fine and
``is_connected()`` simply reports False so ``get_gate()`` falls back to
the software simulator.

Wire protocol (newline-terminated ASCII, 115200 baud):
    host -> board   "ARM:<reason text>\n"   turn on red / blocked LED
    host -> board   "CLEAR\n"               turn on green / approved LED
    board -> host   "BUTTON:PRESSED\n"      human pressed the approve button
    board -> host   "BUTTON:DECLINED\n"     (optional) explicit decline
"""
from __future__ import annotations

import time

try:
    import serial  # type: ignore
    import serial.tools.list_ports  # type: ignore

    _HAVE_PYSERIAL = True
except ImportError:  # pyserial not installed -- hardware gate just stays unavailable
    serial = None  # type: ignore
    _HAVE_PYSERIAL = False

_BAUD_RATE = 115200
_OPEN_TIMEOUT_S = 2.0
_LIKELY_PORT_HINTS = ("ttyusb", "ttyacm", "usbserial", "usbmodem", "wchusbserial")


def _autodetect_port() -> str | None:
    if not _HAVE_PYSERIAL:
        return None
    try:
        ports = list(serial.tools.list_ports.comports())
    except Exception:
        return None
    for p in ports:
        device = (p.device or "").lower()
        description = (p.description or "").lower()
        if any(hint in device or hint in description for hint in _LIKELY_PORT_HINTS):
            return p.device
    # Fall back to the first port at all, if any -- better to try and fail
    # fast than to refuse a board that doesn't match our naming guesses.
    return ports[0].device if ports else None


class HardwareSignOffGate:
    """Physical LED + push-button sign-off gate over serial."""

    def __init__(self, port: str | None = None, baud: int = _BAUD_RATE):
        self._conn = None
        if not _HAVE_PYSERIAL:
            return
        resolved_port = port or _autodetect_port()
        if not resolved_port:
            return
        try:
            self._conn = serial.Serial(resolved_port, baud, timeout=_OPEN_TIMEOUT_S)
            # Most boards reset on serial open; give the firmware a moment
            # to boot before we start sending it commands.
            time.sleep(2.0)
        except Exception:
            self._conn = None

    def is_connected(self) -> bool:
        return self._conn is not None and getattr(self._conn, "is_open", False)

    def arm(self, reason: str) -> None:
        self._send(f"ARM:{reason}".replace("\n", " ").replace("\r", " "))

    def clear(self) -> None:
        self._send("CLEAR")

    def wait_for_signoff(self, timeout: float | None = None) -> bool:
        if not self.is_connected():
            return False
        deadline = None if timeout is None else time.monotonic() + timeout
        try:
            while True:
                if deadline is not None and time.monotonic() >= deadline:
                    return False
                line = self._conn.readline().decode("utf-8", errors="ignore").strip()
                if line == "BUTTON:PRESSED":
                    return True
                if line == "BUTTON:DECLINED":
                    return False
                # empty line == readline() timeout with nothing received;
                # loop again until our own deadline (if any) is hit.
        except Exception:
            return False

    def _send(self, line: str) -> None:
        if not self.is_connected():
            return
        try:
            self._conn.write((line + "\n").encode("utf-8"))
            self._conn.flush()
        except Exception:
            # A disconnect mid-demo should degrade gracefully, not crash
            # the classification pipeline.
            self._conn = None
