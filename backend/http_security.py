"""HTTP boundary checks for the loopback-only development server."""

import re


def valid_host(headers, port):
    """Reject DNS rebinding and ambiguous Host headers on every request."""
    hosts = headers.get_all("Host", [])
    return len(hosts) == 1 and hosts[0].lower() in {
        f"127.0.0.1:{port}", f"localhost:{port}"
    }


def valid_origin(headers, host):
    origins = headers.get_all("Origin", [])
    return not origins or (len(origins) == 1 and origins[0] == "http://" + host)


def body_length(headers, maximum):
    """Return a safe length or an HTTP status for invalid framing."""
    if headers.get_all("Transfer-Encoding", []):
        return None, 400
    lengths = headers.get_all("Content-Length", [])
    if len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]):
        return None, 411
    # Avoid parsing arbitrarily long decimal strings.
    if len(lengths[0]) > 10 or int(lengths[0]) > maximum:
        return None, 413
    return int(lengths[0]), None
