#!/usr/bin/env python3
"""
Listen to me (اسمعني) - local launcher.

    python server.py                 # install what's missing, build if needed, start
    python server.py --port 8080     # another port
    python server.py --dev           # development mode (hot reload)
    python server.py --host 0.0.0.0  # reachable from other devices on your network
    python server.py --help

The app itself is a Next.js (Node.js) application. This script is a small,
dependency-free supervisor that:
  1. checks Node.js, npm and Python versions,
  2. installs the edge-tts Python package and the npm packages if missing,
  3. builds the production bundle when the sources changed,
  4. starts the server with THIS Python interpreter for speech synthesis,
  5. waits until it answers, prints the URL and opens the browser,
  6. stops the whole process tree cleanly on Ctrl+C.

Messages are ASCII on purpose so they display correctly in every Windows console.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parent
IS_WINDOWS = os.name == "nt"
MIN_NODE = (20, 9)
MIN_PYTHON = (3, 9)
STAMP_INSTALL = ROOT / "node_modules" / ".asmani-install-hash"
STAMP_BUILD = ROOT / ".next" / ".asmani-build-hash"
BUILD_INPUTS = ["src", "public", "scripts/edge_synth.py", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"]


# ----------------------------------------------------------------- output ---
def info(msg: str) -> None:
    print(f"[..] {msg}", flush=True)


def ok(msg: str) -> None:
    print(f"[OK] {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"[!]  {msg}", flush=True)


def fail(msg: str, hint: str | None = None) -> NoReturn:
    print(f"[X]  {msg}", flush=True)
    if hint:
        for line in hint.strip().splitlines():
            print(f"     {line}", flush=True)
    sys.exit(1)


# ---------------------------------------------------------------- helpers ---
def which(name: str) -> str | None:
    """Finds a program; on Windows npm is a .cmd shim, so look for that first."""
    if IS_WINDOWS:
        return shutil.which(name + ".cmd") or shutil.which(name)
    return shutil.which(name)


def run(cmd: list[str], **kw) -> int:
    """Runs a command in the project folder, streaming its output."""
    return subprocess.call(cmd, cwd=ROOT, **kw)


def version_tuple(text: str) -> tuple[int, ...]:
    digits = text.strip().lstrip("v").split(".")
    out = []
    for d in digits[:3]:
        num = "".join(ch for ch in d if ch.isdigit())
        out.append(int(num or 0))
    return tuple(out)


# Copied from node_modules by scripts/copy-vendor-assets.mjs; not source.
GENERATED = (ROOT / "public" / "pdf.worker.min.mjs", ROOT / "public" / "ocr")


def is_generated(f: Path) -> bool:
    return any(f == g or g in f.parents for g in GENERATED)


def hash_paths(paths: list[str]) -> str:
    """Cheap change detector: hashes file paths, sizes and modification times."""
    h = hashlib.sha256()
    for rel in paths:
        p = ROOT / rel
        files = [p] if p.is_file() else sorted(x for x in p.rglob("*") if x.is_file()) if p.is_dir() else []
        for f in files:
            if is_generated(f):
                continue
            st = f.stat()
            h.update(f"{f.relative_to(ROOT)}|{st.st_size}|{int(st.st_mtime)}".encode())
    return h.hexdigest()


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host if host != "0.0.0.0" else "", port))
            return True
        except OSError:
            return False


# ----------------------------------------------------------------- checks ---
def check_python() -> None:
    if sys.version_info < MIN_PYTHON:
        fail(f"Python {'.'.join(map(str, MIN_PYTHON))}+ is required (this is {sys.version.split()[0]}).", "Download it from https://www.python.org/downloads/")
    ok(f"Python {sys.version.split()[0]} ({sys.executable})")


def check_node() -> tuple[str, str]:
    node = which("node")
    npm = which("npm")
    if not node or not npm:
        fail(
            "Node.js is not installed (or not on PATH).",
            "Install the LTS version from https://nodejs.org, then open a NEW terminal\nand run: python server.py",
        )
    version = subprocess.run([node, "--version"], capture_output=True, text=True).stdout
    if version_tuple(version)[:2] < MIN_NODE:
        fail(f"Node.js {MIN_NODE[0]}.{MIN_NODE[1]}+ is required (found {version.strip()}).", "Update from https://nodejs.org")
    ok(f"Node.js {version.strip()}")
    return node, npm


def ensure_edge_tts(allow_install: bool) -> None:
    if importlib.util.find_spec("edge_tts"):
        ok("edge-tts (speech engine) is installed")
        return
    if not allow_install:
        fail("The edge-tts Python package is missing.", f"Install it with:\n  {sys.executable} -m pip install -r requirements.txt")
    info("Installing the edge-tts speech engine (needs internet)...")
    code = run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt"])
    if code != 0:
        info("Retrying with --user ...")
        code = run([sys.executable, "-m", "pip", "install", "--user", "--disable-pip-version-check", "-r", "requirements.txt"])
    if code != 0:
        fail("Could not install edge-tts.", f"Check your internet connection, then run:\n  {sys.executable} -m pip install -r requirements.txt")
    importlib.invalidate_caches()
    ok("edge-tts installed")


def check_ffmpeg() -> None:
    if shutil.which("ffmpeg"):
        ok("ffmpeg found (M4A and MP4 video export enabled)")
    else:
        warn("ffmpeg not found: MP3 works; M4A/MP4 export is disabled.")
        warn("  Windows: winget install Gyan.FFmpeg   macOS: brew install ffmpeg   Linux: sudo apt install ffmpeg")


def ensure_node_modules(npm: str, allow_install: bool) -> None:
    wanted = hash_paths(["package.json", "package-lock.json"])
    if (ROOT / "node_modules").is_dir() and STAMP_INSTALL.exists() and STAMP_INSTALL.read_text().strip() == wanted:
        ok("Website packages are up to date")
        return
    if not allow_install:
        fail("Website packages are missing or outdated.", "Run: npm install")
    # 'npm ci' gives an exact install but deletes node_modules first, which fails
    # (EPERM on Windows) while another copy of the app has files open. Use it only
    # for a fresh install; update an existing install in place with 'npm install'.
    fresh = not (ROOT / "node_modules").is_dir()
    use_ci = fresh and (ROOT / "package-lock.json").exists()
    info("Installing website packages (first run takes a few minutes)..." if fresh else "Updating website packages...")
    code = run([npm, "ci" if use_ci else "install", "--no-audit", "--no-fund"])
    if code != 0 and use_ci:
        warn("'npm ci' failed; trying 'npm install' ...")
        code = run([npm, "install", "--no-audit", "--no-fund"])
    if code != 0:
        fail("npm install failed.", "Check your internet connection and try again.\nIf it keeps failing, delete the node_modules folder and retry.")
    STAMP_INSTALL.write_text(hash_paths(["package.json", "package-lock.json"]))
    ok("Website packages installed")


def ensure_build(npm: str, force: bool) -> None:
    wanted = hash_paths(BUILD_INPUTS)
    built = (ROOT / ".next" / "BUILD_ID").exists() and STAMP_BUILD.exists() and STAMP_BUILD.read_text().strip() == wanted
    if built and not force:
        ok("Production build is up to date")
        return
    info("Building the website (about a minute)...")
    if run([npm, "run", "build"]) != 0:
        fail("The build failed. See the messages above.", "You can still try development mode:  python server.py --dev")
    STAMP_BUILD.write_text(hash_paths(BUILD_INPUTS))
    ok("Build complete")


# ------------------------------------------------------------------ serve ---
def start_server(node: str, args: argparse.Namespace) -> subprocess.Popen:
    env = os.environ.copy()
    env["PYTHON_BIN"] = sys.executable  # the interpreter that has edge-tts
    env.setdefault("NEXT_TELEMETRY_DISABLED", "1")
    env["PORT"] = str(args.port)
    next_bin = str(ROOT / "node_modules" / "next" / "dist" / "bin" / "next")
    cmd = [node, next_bin, "dev" if args.dev else "start", "-p", str(args.port), "-H", args.host]
    kwargs: dict = {"cwd": ROOT, "env": env}
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(cmd, **kwargs)


def stop_server(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    info("Stopping the server...")
    try:
        if IS_WINDOWS:
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, OSError):
        pass
    ok("Stopped")


def wait_until_ready(proc: subprocess.Popen, url: str, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    json.loads(r.read().decode() or "{}")
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Start Listen to me (اسمعني) on your computer.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 3000)), help="port to listen on (default 3000)")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"), help="interface to bind (default 127.0.0.1; use 0.0.0.0 for your LAN)")
    parser.add_argument("--dev", action="store_true", help="development mode with hot reload (no build step)")
    parser.add_argument("--rebuild", action="store_true", help="force a fresh production build")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    parser.add_argument("--no-install", action="store_true", help="never install packages automatically")
    parser.add_argument("--check", action="store_true", help="only check the environment, then exit")
    args = parser.parse_args()

    os.chdir(ROOT)
    print("\n  Listen to me - local server\n  ---------------------------\n", flush=True)
    check_python()
    node, npm = check_node()
    ensure_edge_tts(allow_install=not args.no_install)
    check_ffmpeg()
    if args.check:
        ok("Environment looks good.")
        return
    ensure_node_modules(npm, allow_install=not args.no_install)
    # PDF and OCR engine files served from public/ (no-op when already in place).
    if run([node, str(ROOT / "scripts" / "copy-vendor-assets.mjs")]) != 0:
        warn("Could not copy the PDF/OCR engine files; PDF import may not work. Try: npm install")
    if not args.dev:
        ensure_build(npm, force=args.rebuild)

    requested = args.port
    while not port_free(args.host, args.port):
        args.port += 1
        if args.port > requested + 20:
            fail(f"Ports {requested}-{args.port} are all busy.", "Choose another one:  python server.py --port 8080")
    if args.port != requested:
        warn(f"Port {requested} is busy; using {args.port} instead.")

    proc = start_server(node, args)

    def handle_signal(_sig, _frame):
        stop_server(proc)
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, handle_signal)  # type: ignore[attr-defined]

    browse_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{'localhost' if browse_host == '127.0.0.1' else browse_host}:{args.port}"
    info("Starting...")
    if not wait_until_ready(proc, f"http://{browse_host}:{args.port}/api/health", timeout=180 if args.dev else 60):
        stop_server(proc)
        fail("The server did not start. See the messages above.", "Try:  python server.py --rebuild   or   python server.py --dev")

    print(f"\n  Ready:  {url}", flush=True)
    if args.host in ("0.0.0.0", "::"):
        print("  Also reachable from other devices on your network at this computer's IP address.", flush=True)
    print("  Press Ctrl+C to stop.\n", flush=True)
    if not args.no_browser:
        webbrowser.open(url)

    try:
        code = proc.wait()
    except KeyboardInterrupt:
        stop_server(proc)
        return
    if code not in (0, None):
        fail(f"The server exited with code {code}.")


if __name__ == "__main__":
    main()
