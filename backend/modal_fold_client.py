"""Invoke the configured Modal function; the input sequence arrives on stdin."""

import json
import sys


def main():
    import modal

    sequence = sys.stdin.read(148)
    result = modal.Function.from_name("hbb-esmfold", "fold_hbb").remote(sequence)
    sys.stdout.write(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Provider messages may contain request details or credentials.
        sys.stderr.write("Modal prediction failed.\n")
        sys.exit(1)
