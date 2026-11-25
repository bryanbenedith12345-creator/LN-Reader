"""Warm Piper worker: JSON lines in, one WAV out per sentence.

Launched by :mod:`app.lnreader.tts` as a child process with the engine folder
first on ``sys.path``. The voice model stays loaded between sentences, so the
cost of a sentence is only the model itself - a fraction of its audio length.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import traceback
import wave

MAX_TEXT = 4000
_SPACES = re.compile(r"\s+")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean(text: str) -> str:
    text = _CONTROL.sub(" ", str(text or ""))
    text = _SPACES.sub(" ", text).strip()
    return text[:MAX_TEXT]


def _reply(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _fail(message: str) -> None:
    _reply({"ok": False, "error": message[:400] or "The voice could not speak"})


class Speaker:
    """One loaded voice, reused until another one is asked for."""

    def __init__(self) -> None:
        self.voice = None
        self.path = ""
        self.speed = 1.0

    def load(self, path: str, speed: float) -> None:
        from piper import PiperVoice

        if self.voice is None or path != self.path:
            self.voice = PiperVoice.load(path, path + ".json")
            self.path = path
        self.speed = speed

    def say(self, text: str, out: str, speed: float) -> dict:
        from piper.config import SynthesisConfig

        started = time.perf_counter()
        config = SynthesisConfig(length_scale=1.0 / max(0.5, min(2.0, speed)))
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        with wave.open(out, "wb") as handle:
            self.voice.synthesize_wav(text, handle, syn_config=config)
        frames = 0
        try:
            with wave.open(out, "rb") as handle:
                frames = handle.getnframes()
                rate = handle.getframerate() or 22050
        except (OSError, EOFError, wave.Error):
            rate = 22050
        return {"ms": int((time.perf_counter() - started) * 1000),
                "dur": round(frames / float(rate or 22050), 2),
                "bytes": os.path.getsize(out)}


def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    site = argv[1] if len(argv) > 1 else ""
    if site and os.path.isdir(site):
        sys.path.insert(0, site)
    try:
        import piper  # noqa: F401  (loads onnxruntime once)
    except Exception as exc:  # pragma: no cover - environment problem
        _reply({"ok": False, "fatal": True,
                "error": "The speech engine could not start: %s" % exc})
        return 2
    speaker = Speaker()
    _reply({"ok": True, "ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            _fail("The reader sent something the engine did not understand")
            continue
        command = str(request.get("cmd") or "say")
        if command == "quit":
            break
        try:
            speed = float(request.get("speed") or 1.0)
        except (TypeError, ValueError):
            speed = 1.0
        speed = max(0.5, min(2.0, speed))
        try:
            if command == "load":
                started = time.perf_counter()
                speaker.load(str(request.get("voice") or ""), speed)
                _reply({"ok": True, "ms": int((time.perf_counter() - started) * 1000)})
                continue
            text = _clean(request.get("text") or "")
            out = str(request.get("out") or "")
            if not text:
                _fail("Nothing to read")
                continue
            if not out:
                _fail("The reader did not say where to save the audio")
                continue
            if speaker.voice is None or speaker.path != str(request.get("voice") or speaker.path):
                speaker.load(str(request.get("voice") or speaker.path), speed)
            info = speaker.say(text, out, speed)
            if info["bytes"] <= 44:
                try:
                    os.unlink(out)
                except OSError:
                    pass
                _fail("That line has nothing a voice can say")
                continue
            _reply({"ok": True, **info})
        except Exception as exc:  # keep serving the next sentence
            traceback.print_exc(file=sys.stderr)
            _fail(str(exc) or exc.__class__.__name__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
