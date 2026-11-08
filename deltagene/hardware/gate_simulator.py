"""Software fallback for the sign-off gate when no Arduino/ESP32 is wired
up. Same interface as HardwareSignOffGate (see gate_bridge.py), so the
compliance agent and the rest of the pipeline never need to know which
one they're talking to.
"""
from __future__ import annotations

import os
import sys


class SimulatedSignOffGate:
    def __init__(self):
        self._armed_reason: str | None = None

    def is_connected(self) -> bool:
        # Not real hardware, but it always "works" -- there is nothing to
        # fail to connect to.
        return True

    def arm(self, reason: str) -> None:
        self._armed_reason = reason
        print(
            "\n"
            "+==================== GATE: BLOCKED ====================+\n"
            f"| reason: {reason[:48]:<48} |\n"
            "| a human sign-off is required to proceed.               |\n"
            "+==========================================================+\n"
        )

    def clear(self) -> None:
        self._armed_reason = None
        print(
            "\n"
            "+==================== GATE: APPROVED ====================+\n"
            "+==========================================================+\n"
        )

    def wait_for_signoff(self, timeout: float | None = None) -> bool:
        # Documented non-interactive contract: auto-approve for tests/CI
        # and for running the demo unattended.
        if os.environ.get("DELTAGENE_AUTO_APPROVE") == "1":
            return True

        if not sys.stdin.isatty():
            # No one to prompt -- fail closed rather than hang.
            return False

        prompt = "Approve as genetic counselor? [y/N]: "
        try:
            if timeout is None:
                answer = input(prompt)
                return answer.strip().lower() in ("y", "yes")

            # Best-effort timeout on POSIX ttys only; Windows / non-select
            # stdins just fall back to a blocking prompt.
            try:
                import select

                print(prompt, end="", flush=True)
                ready, _, _ = select.select([sys.stdin], [], [], timeout)
                if not ready:
                    print("\n(timed out waiting for sign-off)")
                    return False
                answer = sys.stdin.readline()
                return answer.strip().lower() in ("y", "yes")
            except (ImportError, OSError, ValueError):
                answer = input(prompt)
                return answer.strip().lower() in ("y", "yes")
        except (EOFError, KeyboardInterrupt):
            return False
