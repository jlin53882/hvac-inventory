# -*- coding: utf-8 -*-
"""相容入口：統一交給 single-instance launcher，避免 --reload 留下孤兒 worker。"""
from pathlib import Path
import subprocess
import sys


if __name__ == "__main__":
    launcher = Path(__file__).resolve().parent / "scripts" / "start-server.ps1"
    raise SystemExit(subprocess.call([
        "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", str(launcher), *sys.argv[1:],
    ]))
