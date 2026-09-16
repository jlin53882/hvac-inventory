from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
START_BAT = ROOT / "start.bat"
MONITOR_PS1 = ROOT / "scripts" / "monitor.ps1"
SERVER_START = ROOT / "server_start.py"
MAIN_PY = ROOT / "main.py"
LAUNCHER_PS1 = ROOT / "scripts" / "start-server.ps1"
SERVER_DOC = ROOT / "docs" / "伺服器日誌維護文件.md"
EXTERNAL_DOC = ROOT / "docs" / "外網維護文件.md"


def test_start_launcher_exists_and_owns_single_instance():
    source = LAUNCHER_PS1.read_text(encoding="utf-8")
    assert "System.Threading.Mutex" in source
    assert "Get-NetTCPConnection" in source
    assert "[switch]$Restart" in source
    assert "--port" in source and "Port" in source
    assert "Start-Process" in source
    assert "-PassThru" in source
    assert "function Wait-ServerReady" in source

    release = source.index("ReleaseMutex")
    wait_process = source.index("Wait-Process")
    assert release < wait_process


def test_manual_start_uses_guarded_launcher_instead_of_raw_uvicorn():
    source = START_BAT.read_text(encoding="utf-8")
    assert "scripts\\start-server.ps1" in source
    assert "-NoProfile" in source
    assert "-ExecutionPolicy" in source
    assert 'python.exe" -m uvicorn' not in source


def test_legacy_python_entries_delegate_to_guarded_launcher():
    server_start = SERVER_START.read_text(encoding="utf-8")
    main = MAIN_PY.read_text(encoding="utf-8")
    assert "scripts" in server_start and "start-server.ps1" in server_start
    assert "scripts" in main and "start-server.ps1" in main
    assert "reload=True" not in server_start
    assert "uvicorn.run" not in main


def test_monitor_restarts_through_guarded_launcher():
    source = MONITOR_PS1.read_text(encoding="utf-8")
    assert "$STARTPS1" in source
    assert "hvac-inventory-monitor" in source
    assert "start-server.ps1" in source
    assert "-Restart" in source
    assert 'Start-Process cmd -ArgumentList "/c", "start"' not in source


def test_maintenance_docs_describe_single_instance_recovery():
    server_doc = SERVER_DOC.read_text(encoding="utf-8")
    external_doc = EXTERNAL_DOC.read_text(encoding="utf-8")
    combined = server_doc + "\n" + external_doc
    assert "single-instance" in combined
    assert "start-server.ps1" in combined
    assert "孤兒" in combined
    assert "InventorySvc" in combined
