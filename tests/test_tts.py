"""Piper voice catalogue, installed packs, downloads and jobs."""
from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


def _raw(key, name, code, quality, size=1000, speakers=1, country="", lang="English"):
    return {
        "key": key, "name": name, "quality": quality, "num_speakers": speakers,
        "language": {"code": code, "name_english": lang, "name_native": lang,
                     "country_english": country},
        "files": {key + ".onnx": {"size_bytes": size, "md5_digest": "x"},
                  key + ".onnx.json": {"size_bytes": 40, "md5_digest": "y"}},
    }


RAW = {
    "en_US-lessac-medium": _raw("en_US-lessac-medium", "lessac", "en_US", "medium", 63201294, country="United States"),
    "en_US-lessac-high": _raw("en_US-lessac-high", "lessac", "en_US", "high", 108000000, country="United States"),
    "fr_FR-siwis-low": _raw("fr_FR-siwis-low", "siwis", "fr_FR", "low", 28000000, country="France", lang="French"),
    "en_GB-alba-x_low": _raw("en_GB-alba-x_low", "alba", "en_GB", "x_low", 20000000, speakers=8, country="Great Britain"),
}


def test_catalog_normalises_entries(library):
    from lnreader import tts

    data = tts._build_catalog(RAW)
    voice = next(item for item in data["voices"] if item["id"] == "en_US-lessac-medium")
    assert voice["name"] == "Lessac"
    assert voice["langName"] == "English (United States)"
    assert voice["qualityName"] == "Balanced"
    assert voice["rate"] == 22050
    assert voice["size"] == 63201294
    assert voice["path"] == "en_US-lessac-medium.onnx"
    assert voice["speakers"] == 1


def test_catalog_sorts_by_language_then_quality(library):
    from lnreader import tts

    ids = [item["id"] for item in tts._build_catalog(RAW)["voices"]]
    assert ids == ["en_GB-alba-x_low", "en_US-lessac-high", "en_US-lessac-medium", "fr_FR-siwis-low"]


def test_catalog_counts_languages(library):
    from lnreader import tts

    langs = {item["code"]: item for item in tts._build_catalog(RAW)["languages"]}
    assert langs["en_US"]["count"] == 2
    assert langs["en_GB"]["name"] == "English (Great Britain)"
    assert langs["fr_FR"]["name"] == "French (France)"


def test_quality_names_and_rates(library):
    from lnreader import tts

    assert tts.QUALITY["x_low"] == ("Fastest", 16000)
    assert tts.QUALITY["high"][1] == 22050
    assert tts._pretty("en_US-lessac_medium") == "En US Lessac Medium"


def _install(root, voice_id, raw_key, name="Lessac"):
    folder = root / voice_id
    folder.mkdir(parents=True)
    (folder / (voice_id + ".onnx")).write_bytes(b"RIFF" + b"0" * 40)
    (folder / "voice.json").write_text(json.dumps({
        "id": voice_id, "name": name, "lang": "en_US",
        "langName": "English (United States)", "quality": "medium",
        "qualityName": "Balanced", "rate": 22050, "size": 44,
    }), "utf-8")
    return folder


def test_installed_voices_reads_folders(library, monkeypatch):
    from lnreader import tts

    monkeypatch.setattr(tts, "catalog_info", lambda: tts._build_catalog(RAW))
    _install(tts.VOICES, "en_US-lessac-medium", "en_US-lessac-medium")
    (tts.VOICES / "broken").mkdir()
    (tts.VOICES / "broken" / "notes.txt").write_text("junk", "utf-8")
    found = tts.installed_voices()
    assert [item["id"] for item in found] == ["en_US-lessac-medium"]
    assert found[0]["name"] == "Lessac"
    assert found[0]["installed"] is True
    assert found[0]["size"] == 44
    assert found[0]["file"].endswith(".onnx")


def test_remove_voice_deletes_the_folder(library):
    from lnreader import tts

    folder = _install(tts.VOICES, "en_US-lessac-medium", "en_US-lessac-medium")
    assert tts.remove_voice("en_US-lessac-medium") == {"removed": "en_US-lessac-medium"}
    assert not folder.exists()
    with pytest.raises(tts.TTSError):
        tts.remove_voice("en_US-lessac-medium")


def test_remove_voice_rejects_odd_names(library):
    from lnreader import tts

    for name in ["../escape", "a/b", "", "voice name"]:
        with pytest.raises(tts.TTSError):
            tts.remove_voice(name)


def test_speak_needs_an_installed_voice(library):
    from lnreader import tts

    with pytest.raises(tts.TTSError):
        tts.speak("en_US-lessac-medium", "hello")


def test_engine_reports_missing(library):
    from lnreader import tts

    info = tts.engine_info()
    assert info["installed"] is False
    assert info["version"] == tts.ENGINE_VERSION


def _wait(key, timeout=5.0):
    from lnreader import tts

    deadline = time.time() + timeout
    while time.time() < deadline:
        job = tts.job_info(key)
        if job and job["state"] != "running":
            return job
        time.sleep(0.01)
    return tts.job_info(key)


def test_job_runs_and_finishes(library):
    from lnreader import tts

    ran = []
    tts._start_job("voice", "demo", lambda job: ran.append(job["id"]))
    job = _wait("demo")
    assert ran == ["demo"]
    assert job["state"] == "done"
    assert job["error"] == ""


def test_job_reports_failure_message(library):
    from lnreader import tts

    def work(job):
        raise tts.TTSError("no network")

    tts._start_job("voice", "demo", work)
    job = _wait("demo")
    assert job["state"] == "failed"
    assert job["error"] == "no network"


def test_job_is_not_started_twice(library):
    from lnreader import tts

    gate, started = threading.Event(), []

    def work(job):
        started.append(1)
        gate.wait(3)

    tts._start_job("voice", "demo", work)
    tts._start_job("voice", "demo", work)
    gate.set()
    _wait("demo")
    assert started == [1]


class _Range(BaseHTTPRequestHandler):
    payload = bytes(range(256)) * 8

    def do_GET(self):
        span = self.headers.get("Range") or ""
        start = int(span.split("=")[-1].split("-")[0]) if span else 0
        body = self.payload[start:]
        self.send_response(206 if span else 200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def test_fetch_resumes_a_partial_file(library):
    from lnreader import tts

    server = ThreadingHTTPServer(("127.0.0.1", 0), _Range)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        target = library.DATA / "voice.onnx"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.with_suffix(".onnx.part").write_bytes(_Range.payload[:600])
        job = {"id": "demo", "state": "running", "got": 600, "total": 2048}
        tts._fetch("http://127.0.0.1:%d/voice.onnx" % server.server_port, target, job)
        assert target.read_bytes() == _Range.payload
        assert job["got"] == len(_Range.payload)
        assert job["total"] == len(_Range.payload)
        assert not target.with_suffix(".onnx.part").exists()
    finally:
        server.shutdown()
        server.server_close()

# ---------------------------------------------------------------- engine --
STUB_PIPER = '''
class PiperVoice:
    @staticmethod
    def load(path, config_path=None, **kwargs):
        return PiperVoice()

    def synthesize_wav(self, text, wav_file, syn_config=None):
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(22050)
        wav_file.writeframes(b"\\x00\\x00" * (len(text) * 20))
'''


def _stub_site(tmp_path):
    site = tmp_path / "site"
    pkg = site / "piper"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("from .voice import PiperVoice\n", "utf-8")
    (pkg / "voice.py").write_text(STUB_PIPER, "utf-8")
    (pkg / "config.py").write_text(
        "class SynthesisConfig:\n"
        "    def __init__(self, length_scale=1.0, **kwargs):\n"
        "        self.length_scale = length_scale\n", "utf-8")
    return site


def test_catalog_marks_voices_the_engine_cannot_speak(library):
    from lnreader import tts

    raw = {
        "en_US-lessac-medium": _raw("en_US-lessac-medium", "lessac", "en_US", "medium"),
        "zh_CN-xiao_ya-medium": _raw("zh_CN-xiao_ya-medium", "xiao_ya", "zh_CN", "medium", lang="Chinese"),
    }
    data = tts._build_catalog(raw)
    flags = {item["id"]: item["supported"] for item in data["voices"]}
    assert flags == {"en_US-lessac-medium": True, "zh_CN-xiao_ya-medium": False}
    assert data["v"] == tts.CATALOG_VERSION


def test_engine_reports_installed_engine(library):
    from lnreader import tts

    pkg = tts.ENGINE_SITE / "piper"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("", "utf-8")
    info = tts.engine_info()
    assert info["installed"] is True
    assert info["version"] == "1.8.0"


def test_engine_install_runs_pip_into_its_own_folder(library, monkeypatch):
    from lnreader import tts

    seen, ready = {}, {"calls": 0}

    def fake_ready():
        ready["calls"] += 1
        return ready["calls"] > 1

    class FakePopen:
        def __init__(self, command, **kwargs):
            seen["command"] = command
            self.returncode = 0
            self.stdout = iter([
                "Collecting piper-tts==1.8.0\n",
                "Downloading piper_tts-1.8.0-cp39-abi3-win_amd64.whl (34.1 MB)\n",
                "Installing collected packages: piper-tts\n",
                "Successfully installed piper-tts-1.8.0\n",
            ])

        def wait(self):
            return 0

    monkeypatch.setattr(tts, "_engine_ready", fake_ready)
    monkeypatch.setattr(tts.subprocess, "Popen", FakePopen)
    job = {"id": "engine", "state": "running", "got": 0, "total": 100, "unit": "percent",
           "note": "", "error": "", "started": time.time()}
    tts._run_engine_install(job)
    command = seen["command"]
    assert command[1:3] == ["-m", "pip"]
    assert "--target" in command and str(tts.ENGINE_SITE) in command
    assert command[-1] == "piper-tts==1.8.0"
    assert job["got"] == 100


def test_engine_speaks_through_the_worker(library, tmp_path, monkeypatch):
    from lnreader import tts

    site = _stub_site(tmp_path)
    monkeypatch.setattr(tts, "ENGINE_SITE", site)
    onnx = tmp_path / "stub.onnx"
    onnx.write_bytes(b"x")
    try:
        audio = tts.ENGINE.say("Hello there, reader.", {"id": "stub", "file": str(onnx)}, 1.0)
    finally:
        tts.ENGINE.stop()
    assert audio.startswith(b"RIFF")
    assert len(audio) > 44


def test_voice_install_refuses_foreign_phonemes(library, monkeypatch):
    from lnreader import tts

    def fake_fetch(url, target, job=None, chunk=1 << 20):
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.name.endswith(".json"):
            target.write_text(json.dumps({"phoneme_type": "pinyin", "phoneme_id_map": {}}), "utf-8")
        else:
            target.write_bytes(b"RIFF" + b"0" * 40)

    monkeypatch.setattr(tts, "_fetch", fake_fetch)
    voice = {"id": "zh_CN-xiao_ya-medium", "name": "Xiao Ya", "lang": "zh_CN",
             "langName": "Chinese", "quality": "medium", "qualityName": "Balanced",
             "rate": 22050, "size": 44, "path": "zh_CN/xiao_ya/medium/zh_CN-xiao_ya-medium.onnx"}
    job = {"id": voice["id"], "state": "running", "got": 0, "total": 44, "unit": "bytes",
           "note": "", "error": "", "started": time.time()}
    with pytest.raises(tts.TTSError) as err:
        tts._run_voice_install(job, voice)
    assert "does not carry" in str(err.value)
    assert not (tts.VOICES / voice["id"]).exists()


def test_download_refuses_unsupported_voice(library, monkeypatch):
    from lnreader import tts

    data = tts._build_catalog({"ja_JP-hi_fi_captain-medium": _raw(
        "ja_JP-hi_fi_captain-medium", "hi_fi_captain", "ja_JP", "medium", lang="Japanese")})
    monkeypatch.setattr(tts, "catalog_info", lambda: data)
    with pytest.raises(tts.TTSError):
        tts.download_voice("ja_JP-hi_fi_captain-medium")

