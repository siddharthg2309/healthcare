#!/usr/bin/env python3
"""Reject tracked/staged files that match this repository's ignore rules."""

import argparse
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true")
    args = parser.parse_args()
    command = (
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
        if args.staged
        else ["git", "ls-files", "-z"]
    )
    paths = subprocess.run(command, capture_output=True, check=True).stdout
    if not paths:
        return 0

    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-z", "--stdin"],
        input=paths,
        capture_output=True,
        check=False,
    )
    if result.returncode not in (0, 1):
        print("Could not verify ignore rules; refusing to continue.", file=sys.stderr)
        return 1
    blocked = [path for path in result.stdout.split(b"\0") if path]
    if blocked:
        print("Tracked files match ignore rules; remove them from staging/tracking:", file=sys.stderr)
        for path in blocked:
            print(f"  {path.decode('utf-8', errors='replace')!r}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
