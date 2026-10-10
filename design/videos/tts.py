"""Generates the Arabic voice-over lines for a tutorial video with edge-tts (Iraqi neural voices).

Usage (from the project root, after `node design/videos/make.mjs <name>` has written vo/<name>/script.json):
    pip install edge-tts
    python design/videos/tts.py register   # or protect / explainer
    node design/videos/make.mjs register   # re-mixes with the voice, ducks the music under it

Writes vo/<name>/NN.mp3 (one per scene) and warns when a line runs longer than its scene.
Voice: ar-IQ-RanaNeural for the tutorials, ar-IQ-BasselNeural for the explainer.
Note: on 2026-10-10 Microsoft's endpoint answered 403 from this machine, so no voice files exist yet.
"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts

name = sys.argv[1]
voice = "ar-IQ-BasselNeural" if name == "explainer" else "ar-IQ-RanaNeural"
folder = Path(__file__).parent / "vo" / name
lines = json.loads((folder / "script.json").read_text(encoding="utf-8"))


async def main() -> None:
    for i, line in enumerate(lines):
        if not line["text"]:
            continue
        out = folder / f"{i:02d}.mp3"
        await edge_tts.Communicate(line["text"], voice, rate="+4%").save(str(out))
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
            capture_output=True, text=True, check=True,
        )
        length = float(probe.stdout.strip())
        room = line["len"] - 0.6
        print(f"{out.name}: {length:.1f}s / {room:.1f}s{'  <-- too long, shorten the line' if length > room else ''}")


asyncio.run(main())
