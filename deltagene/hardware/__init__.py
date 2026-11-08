"""Physical human-in-the-loop sign-off gate.

The compliance agent must not finalize a classification that crosses a
clinically actionable threshold (see agents/compliance_agent.py) without
an explicit human sign-off. We make that tangible for the live demo with
a physical gate from the hackathon's hardware kit: an LED that turns red
when a classification is blocked pending review, and a push-button a
human must physically press to approve it. If no board is attached
(e.g. while developing away from the venue), `get_gate()` transparently
falls back to a terminal-prompt simulator with the identical interface,
so the rest of the pipeline never has to know which one it's talking to.

Interface every gate implementation provides:

    gate.arm(reason: str) -> None
        Put the gate into the blocked/red state and show `reason`.
    gate.wait_for_signoff(timeout: float | None = None) -> bool
        Block until a human approves (button press / typed "y") or the
        optional timeout elapses. Returns True iff approved.
    gate.clear() -> None
        Put the gate into the approved/green state.
"""
from __future__ import annotations


def get_gate(port: str | None = None):
    """Return a live hardware gate if a board is found, else the
    software simulator. Never raises for "no hardware attached" -- that
    is the expected case whenever the Arduino/ESP32 isn't plugged in."""
    try:
        from .gate_bridge import HardwareSignOffGate

        gate = HardwareSignOffGate(port=port)
        if gate.is_connected():
            return gate
    except Exception:
        pass
    from .gate_simulator import SimulatedSignOffGate

    return SimulatedSignOffGate()
