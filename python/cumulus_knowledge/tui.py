from __future__ import annotations

import subprocess
import sys

from .operations import (
    compare_invoice_to_bank_draw,
    detect_schedule_shipping_risk,
    extract_operations_entities,
)


def main() -> None:
    if "--ops-review" in sys.argv:
        path = sys.argv[sys.argv.index("--ops-review") + 1] if sys.argv[-1] != "--ops-review" else "."
        entities = extract_operations_entities(path)
        invoice_issues = compare_invoice_to_bank_draw(entities)
        shipping_risks = detect_schedule_shipping_risk(entities)
        print("Cumulus Operations Review")
        print(f"entities: {len(entities)}")
        print(f"invoice/payment issues: {len(invoice_issues)}")
        print(f"shipping/schedule risks: {len(shipping_risks)}")
        for item in [*invoice_issues, *shipping_risks][:12]:
            print(f"- {item}")
        return
    try:
        subprocess.run(["cumulus", "knowledge", *sys.argv[1:]], check=True)
    except FileNotFoundError:
        print("cls-knowledge binary was not found. Build it with `cargo build --release`.", file=sys.stderr)
        raise SystemExit(1)
    except subprocess.CalledProcessError as exc:
        print({"ok": False, "error": str(exc)}, file=sys.stderr)
        raise SystemExit(exc.returncode)
