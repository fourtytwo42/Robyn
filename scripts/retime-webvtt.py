#!/usr/bin/env python3
"""Scale WebVTT cue times by a constant playback speed."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

STAMP = re.compile(r"(?P<hours>\d{2}):(?P<minutes>\d{2}):(?P<seconds>\d{2}\.\d{3})")


def scale_stamp(match: re.Match[str], speed: float) -> str:
    total = (
        int(match.group("hours")) * 3600
        + int(match.group("minutes")) * 60
        + float(match.group("seconds"))
    ) / speed
    millis = round(total * 1000)
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--speed", type=float, default=1.15)
    args = parser.parse_args()
    if args.speed <= 0:
        raise SystemExit("speed must be positive")
    text = args.source.read_text(encoding="utf-8")
    args.destination.write_text(
        STAMP.sub(lambda match: scale_stamp(match, args.speed), text),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
