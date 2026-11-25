"""Local read-aloud with Piper voices.

Free neural voices, one small model per language and quality, synthesised on the
CPU by Piper's own runtime inside a warm worker process. The engine is a one-time
download of about 65 MB and the voice stays loaded between sentences, so audio
for a sentence is ready in a fraction of its speaking time. Nothing is sent
anywhere and nothing needs a browser.
"""
from __future__ import annotations

import atexit
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from .config import DATA

ROOT = DATA / "tts"
VOICES = ROOT / "voices"
RUNTIME = ROOT / "runtime"
ENGINE_SITE = RUNTIME / "py"
ENGINE_MARK = RUNTIME / "build.txt"
SPEECH = ROOT / "speech"
CATALOG_FILE = ROOT / "catalog.json"
ENGINE_LOG = ROOT / "piper.log"
WORKER = Path(__file__).with_name("tts_worker.py")

CATALOG_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json"
MODEL_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
ENGINE_PACKAGE = "piper-tts==1.8.0"
ENGINE_VERSION = "1.8.0"
CATALOG_VERSION = 2
CATALOG_DAYS = 14
IDLE_SECONDS = 420
MAX_TEXT = 4000

# Piper can synthesise these phoneme sets out of the box. The rest need extra
# language packs (Chinese, Japanese, Thai need large models of their own), so the
# picker says so instead of downloading 60 MB that cannot be spoken.
SUPPORTED_PHONEMES = {"espeak", "text", "hebrew"}
UNSUPPORTED = frozenset({
    "ja_JP-hi_fi_captain-medium",
    "lt_LT-ingute-medium",
    "lt_LT-reginute1-medium",
    "th_TH-tsync2-medium",
    "zh_CN-chaowen-medium",
    "zh_CN-xiao_ya-medium",
})

QUALITY = {
    "x_low": ("Fastest", 16000),
    "low": ("Small", 16000),
    "medium": ("Balanced", 22050),
    "high": ("Detailed", 22050),
}
QUALITY_ORDER = {"high": 0, "medium": 1, "low": 2, "x_low": 3}


class TTSError(RuntimeError):
    """A message the reader can do something about."""


# ------------------------------------------------------------------ files --
def _read_json(path: Path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)
    os.replace(temp, path)


def _pretty(name: str) -> str:
    words = [word for word in re.split(r"[_\-]+", str(name)) if word]
    return " ".join(word[:1].upper() + word[1:] for word in words) or "Voice"


def _lang_label(lang: dict) -> str:
    name = lang.get("name_english") or lang.get("code") or "Unknown"
    country = lang.get("country_english") or ""
    if country and country.casefold() not in name.casefold():
        return "%s (%s)" % (name, country)
    return name


# ---------------------------------------------------------------- catalog --
_catalog_lock = threading.Lock()
_catalog = None


def _build_catalog(raw: dict) -> dict:
    voices, langs = [], {}
    for key, item in raw.items():
        if not isinstance(item, dict):
            continue
        files = item.get("files") or {}
        onnx = next((name for name in files if str(name).endswith(".onnx")), "")
        if not onnx:
            continue
        lang = item.get("language") or {}
        quality = str(item.get("quality") or "medium")
        label, rate = QUALITY.get(quality, ("Standard", 22050))
        code = str(lang.get("code") or "")
        voices.append({
            "id": key,
            "name": _pretty(item.get("name") or key),
            "lang": code,
            "langName": _lang_label(lang),
            "native": str(lang.get("name_native") or ""),
            "quality": quality,
            "qualityName": label,
            "rate": rate,
            "size": int((files.get(onnx) or {}).get("size_bytes") or 0),
            "speakers": int(item.get("num_speakers") or 1),
            "path": onnx,
            "supported": key not in UNSUPPORTED,
        })
        entry = langs.setdefault(code, {"code": code, "name": _lang_label(lang),
                                        "native": str(lang.get("name_native") or ""), "count": 0})
        entry["count"] += 1
    voices.sort(key=lambda v: (v["langName"].casefold(), v["name"].casefold(),
                               QUALITY_ORDER.get(v["quality"], 9)))
    return {
        "v": CATALOG_VERSION,
        "voices": voices,
        "languages": sorted(langs.values(), key=lambda l: l["name"].casefold()),
        "updated": int(time.time()),
        "source": "rhasspy/piper-voices",
    }


def catalog_info() -> dict | None:
    global _catalog
    with _catalog_lock:
        if _catalog is None:
            data = _read_json(CATALOG_FILE)
            _catalog = data if isinstance(data, dict) and data.get("v") == CATALOG_VERSION else None
        return _catalog


def _download_catalog() -> dict:
    try:
        request = urllib.request.Request(CATALOG_URL, headers={"User-Agent": "LNReader"})
        with urllib.request.urlopen(request, timeout=30) as answer:
            raw = json.loads(answer.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError, OSError) as exc:
        raise TTSError("Could not reach the voice catalogue: %s" % exc) from exc
    data = _build_catalog(raw)
    if not data["voices"]:
        raise TTSError("The voice catalogue was empty")
    _write_json(CATALOG_FILE, data)
    global _catalog
    with _catalog_lock:
        _catalog = data
    return data


def ensure_catalog(force: bool = False) -> dict:
    data = catalog_info()
    fresh = bool(data) and not force and time.time() - int(data.get("updated") or 0) < CATALOG_DAYS * 86400
    if fresh:
        return data
    try:
        return _download_catalog()
    except TTSError:
        if data and not force:
            return data
        raise


# ----------------------------------------------------------------- engine --
def _engine_ready() -> bool:
    return (ENGINE_SITE / "piper" / "__init__.py").is_file()


def engine_info() -> dict:
    ready = _engine_ready()
    return {"installed": ready, "path": str(ENGINE_SITE) if ready else "",
            "version": ENGINE_VERSION, "job": job_info("engine")}


# ------------------------------------------------------------------ jobs --
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def job_info(key: str) -> dict | None:
    with _jobs_lock:
        job = _jobs.get(key)
        return dict(job) if job else None


def jobs_snapshot() -> list[dict]:
    now = time.time()
    with _jobs_lock:
        for key, job in list(_jobs.items()):
            done = job["state"] != "running"
            if done and now - float(job.get("finished") or now) > 300:
                _jobs.pop(key, None)
        return [dict(job) for job in _jobs.values()]


def _start_job(kind: str, key: str, work, unit: str = "bytes") -> dict:
    with _jobs_lock:
        running = _jobs.get(key)
        if running and running["state"] == "running":
            return dict(running)
        job = {"id": key, "kind": kind, "state": "running", "got": 0,
               "total": 100 if unit == "percent" else 0, "unit": unit,
               "note": "", "error": "", "started": time.time()}
        _jobs[key] = job

    def run():
        try:
            work(job)
        except TTSError as exc:
            with _jobs_lock:
                job["state"], job["error"], job["finished"] = "failed", str(exc), time.time()
        except Exception as exc:
            with _jobs_lock:
                job["state"] = "failed"
                job["error"] = "Something went wrong: %s" % exc
                job["finished"] = time.time()
        else:
            with _jobs_lock:
                job["state"], job["finished"] = "done", time.time()

    threading.Thread(target=run, name="tts-" + kind, daemon=True).start()
    return dict(job)


# -------------------------------------------------------------- downloads --
def _fetch(url: str, target: Path, job: dict | None = None, chunk: int = 1 << 20) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_suffix(target.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    request = urllib.request.Request(url, headers={"User-Agent": "LNReader"})
    if have:
        request.add_header("Range", "bytes=%d-" % have)
    try:
        with urllib.request.urlopen(request, timeout=45) as answer:
            if have and answer.status != 206:
                have = 0
            length = int(answer.headers.get("Content-Length") or 0)
            if job is not None:
                with _jobs_lock:
                    job["total"] = max(int(job.get("total") or 0), have + length)
                    job["got"] = max(int(job.get("got") or 0), have)
            mode = "ab" if have else "wb"
            with open(part, mode) as out:
                while True:
                    block = answer.read(chunk)
                    if not block:
                        break
                    out.write(block)
                    if job is not None:
                        with _jobs_lock:
                            job["got"] = int(job.get("got") or 0) + len(block)
            if length and part.stat().st_size != have + length:
                raise TTSError("The download stopped early")
    except urllib.error.HTTPError as exc:
        if not (exc.code == 416 and have):
            raise TTSError("Download failed (%s)" % exc.code) from exc
    except urllib.error.URLError as exc:
        raise TTSError("Download failed: %s" % exc.reason) from exc
    os.replace(part, target)


def _engine_note(line: str) -> str:
    line = line.strip()
    for prefix in ("Downloading ", "Collecting ", "Using cached "):
        if not line.startswith(prefix):
            continue
        name = line[len(prefix):].split(" (")[0].split(" from ")[0]
        word = re.split(r"[<>=!~\s]", name.split("-")[0])[0].replace("_", " ").strip()
        if word:
            return word[:1].upper() + word[1:]
    return "Speech engine"


def _run_engine_install(job: dict) -> None:
    """Install Piper's runtime into its own folder with the app's Python."""
    if _engine_ready():
        with _jobs_lock:
            job["got"], job["total"] = 100, 100
        return
    RUNTIME.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(ENGINE_SITE, ignore_errors=True)
    for stale in (ROOT / "piper.zip", RUNTIME / "piper"):
        try:
            if stale.is_dir():
                shutil.rmtree(stale, ignore_errors=True)
            else:
                stale.unlink(missing_ok=True)
        except OSError:
            pass
    command = [sys.executable, "-m", "pip", "install", "--no-input",
               "--disable-pip-version-check", "--no-warn-script-location",
               "--target", str(ENGINE_SITE), ENGINE_PACKAGE]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
    try:
        proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace", bufsize=1,
                                cwd=str(ROOT), env=env, creationflags=flags)
    except OSError as exc:
        raise TTSError("Could not start the engine installer: %s" % exc) from exc
    tail: list[str] = []
    step = 0
    for line in proc.stdout or []:
        line = line.rstrip()
        if not line:
            continue
        tail.append(line)
        del tail[:-6]
        if line.startswith(("Downloading ", "Collecting ", "Using cached ")):
            step += 1
            with _jobs_lock:
                job["got"] = min(78, 4 + step * 9)
                job["note"] = _engine_note(line)
        elif line.startswith("Installing collected packages"):
            with _jobs_lock:
                job["got"], job["note"] = 86, "Installing"
    code = proc.wait()
    if code != 0:
        shutil.rmtree(ENGINE_SITE, ignore_errors=True)
        reason = next((line for line in reversed(tail) if "ERROR" in line.upper()), tail[-1] if tail else "")
        raise TTSError("The speech engine could not be installed%s" % (": " + reason[:180] if reason else ""))
    if not _engine_ready():
        raise TTSError("The speech engine did not install correctly")
    with _jobs_lock:
        job["got"], job["note"] = 94, "Starting"
    ENGINE_MARK.write_text(ENGINE_VERSION, encoding="utf-8")
    with _jobs_lock:
        job["got"], job["total"] = 100, 100


def start_engine_install() -> dict:
    if engine_info()["installed"]:
        return engine_info()
    return _start_job("engine", "engine", _run_engine_install, unit="percent")


def _voice_dir(voice_id: str) -> Path:
    return VOICES / voice_id


def installed_voices() -> list[dict]:
    data = catalog_info() or {"voices": []}
    known = {voice["id"]: voice for voice in data.get("voices", [])}
    out = []
    if not VOICES.is_dir():
        return out
    for folder in sorted(VOICES.iterdir()):
        if not folder.is_dir():
            continue
        meta = _read_json(folder / "voice.json") or {}
        onnx = next((path for path in folder.glob("*.onnx")), None)
        if not onnx:
            continue
        voice = dict(known.get(folder.name) or {})
        voice.update({key: value for key, value in meta.items() if value is not None})
        voice.update({"id": folder.name, "size": onnx.stat().st_size,
                      "installed": True, "file": str(onnx)})
        quality = voice.get("quality") or "medium"
        voice.setdefault("name", _pretty(folder.name))
        voice.setdefault("langName", "Unknown")
        voice.setdefault("quality", quality)
        voice.setdefault("qualityName", QUALITY.get(quality, ("Balanced", 22050))[0])
        voice.setdefault("rate", QUALITY.get(quality, ("", 22050))[1])
        voice.setdefault("native", "")
        voice.setdefault("lang", "")
        voice.setdefault("supported", True)
        out.append(voice)
    out.sort(key=lambda v: (v["langName"].casefold(), v["name"].casefold()))
    return out


def _run_voice_install(job: dict, voice: dict) -> None:
    folder = _voice_dir(voice["id"])
    folder.mkdir(parents=True, exist_ok=True)
    onnx_name = Path(voice["path"]).name
    targets = [(voice["path"], folder / onnx_name),
               (voice["path"] + ".json", folder / (onnx_name + ".json"))]
    expected = int(voice.get("size") or 0)
    json_next = targets[1]
    _fetch(MODEL_URL + json_next[0] + "?download=true", json_next[1], None)
    config = _read_json(json_next[1]) or {}
    phonemes = str(config.get("phoneme_type") or "espeak")
    if phonemes not in SUPPORTED_PHONEMES or not config.get("phoneme_id_map"):
        shutil.rmtree(folder, ignore_errors=True)
        raise TTSError("%s needs a language model this reader does not carry yet. "
                       "Pick another voice for %s." % (voice["name"], voice["langName"]))
    with _jobs_lock:
        job["got"], job["total"] = 0, expected
    _fetch(MODEL_URL + targets[0][0] + "?download=true", targets[0][1], job)
    onnx = folder / onnx_name
    if expected and onnx.stat().st_size != expected:
        raise TTSError("The voice download was incomplete")
    _write_json(folder / "voice.json", {
        "id": voice["id"], "name": voice["name"], "lang": voice["lang"],
        "langName": voice["langName"], "native": voice.get("native", ""),
        "quality": voice["quality"], "qualityName": voice["qualityName"],
        "rate": voice.get("rate", 22050), "size": expected,
        "installed": int(time.time()),
    })


def download_voice(voice_id: str) -> dict:
    data = catalog_info() or ensure_catalog()
    voice = next((item for item in data["voices"] if item["id"] == voice_id), None)
    if not voice:
        raise TTSError("That voice is not in the catalogue")
    if not voice.get("supported", True):
        raise TTSError("%s needs a language model this reader does not carry yet. "
                       "Pick another voice for %s." % (voice["name"], voice["langName"]))
    if _voice_dir(voice_id).is_dir():
        return {"job": None, "voice": voice}
    job = _start_job("voice", voice_id, lambda running: _run_voice_install(running, voice))
    return {"job": job, "voice": voice}


def remove_voice(voice_id: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_.\-]+", voice_id or ""):
        raise TTSError("That voice name looks wrong")
    folder = _voice_dir(voice_id)
    if not folder.is_dir():
        raise TTSError("That voice is already gone")
    ENGINE.forget(voice_id)
    shutil.rmtree(folder, ignore_errors=True)
    return {"removed": voice_id}


# ----------------------------------------------------------------- engine --
class Engine:
    """One warm piper process: a sentence in, a WAV back, model already loaded."""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.proc = None
        self.lines: queue.Queue = queue.Queue()
        self.voice = ""
        self.speed = 1.0
        self.used = 0.0
        self.counter = 0
        self.log = None
        self.watch = None
        self.ready = False

    def _close(self) -> None:
        proc, self.proc = self.proc, None
        self.voice = ""
        self.ready = False
        self.lines = queue.Queue()
        if proc and proc.poll() is None:
            try:
                proc.stdin.close()
            except Exception:
                pass
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        if self.log:
            try:
                self.log.close()
            except Exception:
                pass
            self.log = None

    def stop(self) -> None:
        with self.lock:
            self._close()

    def forget(self, voice_id: str) -> None:
        with self.lock:
            if self.voice == voice_id:
                self._close()

    def _log_tail(self) -> str:
        try:
            text = ENGINE_LOG.read_text("utf-8", "replace").strip().splitlines()[-3:]
        except OSError:
            return ""
        return " ".join(line.strip() for line in text)[-300:]

    def _start(self, voice: dict, speed: float) -> None:
        if not _engine_ready():
            raise TTSError("The speech engine is not installed yet")
        self._close()
        ROOT.mkdir(parents=True, exist_ok=True)
        try:
            if ENGINE_LOG.exists() and ENGINE_LOG.stat().st_size > 262144:
                ENGINE_LOG.unlink()
        except OSError:
            pass
        self.log = open(ENGINE_LOG, "ab", buffering=0)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1",
                   PYTHONDONTWRITEBYTECODE="1")
        cmd = [sys.executable, str(WORKER), str(ENGINE_SITE)]
        try:
            proc = subprocess.Popen(cmd, cwd=str(ROOT), stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=self.log,
                                    bufsize=0, creationflags=flags, env=env)
        except OSError as exc:
            raise TTSError("Could not start the speech engine: %s" % exc) from exc
        self.proc = proc
        self.speed = speed
        self.used = time.time()
        self.lines = queue.Queue()
        lines = self.lines

        def read():
            try:
                for line in proc.stdout:
                    lines.put(line.decode("utf-8", "replace").strip())
            except Exception:
                pass
            lines.put("")

        threading.Thread(target=read, name="tts-reader", daemon=True).start()
        self._touch_watch()
        hello = self._wait(60)
        if not hello or not hello.get("ready"):
            message = (hello or {}).get("error") or self._log_tail() or "The speech engine stopped"
            self._close()
            raise TTSError(message)
        self._send({"cmd": "load", "voice": str(voice["file"]), "speed": speed}, 120)
        self.voice = voice["id"]

    def _wait(self, timeout: float) -> dict | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                line = self.lines.get(timeout=0.2)
            except queue.Empty:
                if self.proc is None or self.proc.poll() is not None:
                    return None
                continue
            if not line:
                return None
            try:
                return json.loads(line)
            except ValueError:
                continue
        return None

    def _send(self, payload: dict, timeout: float = 120) -> dict:
        proc = self.proc
        if proc is None or proc.poll() is not None:
            raise TTSError("The speech engine stopped")
        try:
            proc.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
            proc.stdin.flush()
        except (OSError, ValueError) as exc:
            self._close()
            raise TTSError("The speech engine stopped") from exc
        answer = self._wait(timeout)
        self.used = time.time()
        if answer is None:
            tail = self._log_tail()
            self._close()
            raise TTSError(tail or "The speech engine stopped")
        if not answer.get("ok"):
            if answer.get("fatal"):
                self._close()
            raise TTSError(str(answer.get("error") or "The voice could not speak"))
        return answer

    def _touch_watch(self) -> None:
        if self.watch and self.watch.is_alive():
            return
        self.watch = threading.Thread(target=self._idle_watch, name="tts-idle", daemon=True)
        self.watch.start()

    def _idle_watch(self) -> None:
        while True:
            time.sleep(30)
            with self.lock:
                if not self.proc:
                    return
                if time.time() - self.used > IDLE_SECONDS:
                    self._close()
                    return

    def _ensure(self, voice: dict, speed: float) -> None:
        if self.proc and self.proc.poll() is None and self.voice == voice["id"]:
            self.used = time.time()
            return
        self._start(voice, speed)

    def say(self, text: str, voice: dict, speed: float) -> bytes:
        text = (text or "").strip()[:MAX_TEXT]
        if not text:
            raise TTSError("Nothing to read")
        with self.lock:
            self._ensure(voice, speed)
            SPEECH.mkdir(parents=True, exist_ok=True)
            self.counter += 1
            out = SPEECH / ("%d.wav" % self.counter)
            self._send({"cmd": "say", "voice": str(voice["file"]), "speed": speed,
                        "text": text, "out": str(out)})
            try:
                audio = out.read_bytes()
            except OSError as exc:
                raise TTSError("Could not read the audio") from exc
            finally:
                out.unlink(missing_ok=True)
            if not audio.startswith(b"RIFF"):
                raise TTSError("The speech engine returned no audio")
            self.ready = True
            return audio


ENGINE = Engine()
atexit.register(ENGINE.stop)


def _voice(voice_id: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_.\-]+", voice_id or ""):
        raise TTSError("That voice name looks wrong")
    voice = next((item for item in installed_voices() if item["id"] == voice_id), None)
    if not voice:
        raise TTSError("That voice is not installed")
    return voice


def warm(voice_id: str, speed: float = 1.0) -> dict:
    voice = _voice(voice_id)
    if not engine_info()["installed"]:
        raise TTSError("The speech engine is not installed yet")
    with ENGINE.lock:
        ENGINE._ensure(voice, max(0.5, min(2.0, float(speed or 1))))
        if not ENGINE.ready:
            # The first sentence pays for espeak-ng and onnxruntime startup.
            # Do it now, while nobody is waiting, so play starts instantly.
            ENGINE.say("Ready.", voice, max(0.5, min(2.0, float(speed or 1))))
    return {"ok": True, "ready": True}


def speak(voice_id: str, text: str, speed: float = 1.0) -> bytes:
    voice = _voice(voice_id)
    if not engine_info()["installed"]:
        raise TTSError("The speech engine is not installed yet")
    return ENGINE.say(text, voice, max(0.5, min(2.0, float(speed or 1))))


def status() -> dict:
    data = catalog_info()
    return {
        "engine": engine_info(),
        "installed": installed_voices(),
        "jobs": jobs_snapshot(),
        "catalog": None if data is None else {
            "count": len(data["voices"]),
            "languages": data["languages"],
            "updated": data["updated"],
        },
    }


def open_catalog() -> dict:
    data = ensure_catalog()
    start_engine_install()
    return {**status(), "voices": data["voices"]}

