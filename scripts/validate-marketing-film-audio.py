#!/usr/bin/env python3
"""Reject clipped or static-corrupted marketing-film audio."""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import tempfile
import wave
from array import array
from pathlib import Path


def run(*args: str) -> str:
    completed = subprocess.run(args, check=True, capture_output=True, text=True)
    return completed.stdout + completed.stderr


def decode(source: Path, output: Path) -> None:
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(output))


def inspect_pcm(path: Path) -> tuple[float, float, float]:
    with wave.open(str(path), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise SystemExit(f"unsupported validation PCM format: {path}")
        rate = audio.getframerate()
        samples = array("h", audio.readframes(audio.getnframes()))
    if not samples:
        raise SystemExit(f"empty audio: {path}")
    peak = max(abs(value) for value in samples) / 32768.0
    peak_db = 20 * math.log10(max(peak, 1e-12))
    crossings = sum((a < 0) != (b < 0) for a, b in zip(samples, samples[1:]))
    crossing_rate = crossings / max(len(samples) - 1, 1)
    duration = len(samples) / rate
    return duration, peak_db, crossing_rate


def high_pass_mean(path: Path) -> float:
    output = run("ffmpeg", "-hide_banner", "-i", str(path), "-af",
                 "highpass=f=8000,volumedetect", "-f", "null", "-")
    match = re.search(r"mean_volume:\s*(-?\d+(?:\.\d+)?) dB", output)
    if not match:
        raise SystemExit(f"could not measure high-frequency energy: {path}")
    return float(match.group(1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--min-duration", type=float, default=176.0)
    parser.add_argument("--max-duration", type=float, default=178.0)
    parser.add_argument("--max-peak-db", type=float, default=-0.35)
    parser.add_argument("--max-zero-crossing-rate", type=float, default=0.12)
    parser.add_argument("--max-high-pass-mean-db", type=float, default=-28.0)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="robyn-audio-check-") as work:
        pcm = Path(work) / "decoded.wav"
        decode(args.source, pcm)
        duration, peak_db, crossing_rate = inspect_pcm(pcm)
        high_pass_db = high_pass_mean(pcm)

    metrics = {
        "source": str(args.source),
        "durationSeconds": round(duration, 6),
        "peakDb": round(peak_db, 3),
        "zeroCrossingRate": round(crossing_rate, 6),
        "highPassMeanDb": round(high_pass_db, 3),
    }
    print(json.dumps(metrics, sort_keys=True))
    failures = []
    if not args.min_duration <= duration <= args.max_duration:
        failures.append("duration")
    if peak_db > args.max_peak_db:
        failures.append("peak")
    if crossing_rate > args.max_zero_crossing_rate:
        failures.append("zero-crossing-rate")
    if high_pass_db > args.max_high_pass_mean_db:
        failures.append("high-frequency-energy")
    if failures:
        raise SystemExit("audio quality gate failed: " + ", ".join(failures))


if __name__ == "__main__":
    main()
