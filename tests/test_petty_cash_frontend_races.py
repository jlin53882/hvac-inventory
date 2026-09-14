import subprocess
from pathlib import Path


ROOT = Path(__file__).parents[1]
HARNESS = ROOT / "tests" / "petty_cash_frontend_races.js"


def test_petty_cash_frontend_race_and_single_flight_contracts():
    result = subprocess.run(
        ["node", str(HARNESS)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert result.returncode == 0, (result.stdout, result.stderr)
    assert "PASS" in result.stdout
