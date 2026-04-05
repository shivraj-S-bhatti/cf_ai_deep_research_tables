#!/usr/bin/env python3
"""
Write a .txt from a .ipynb: cell sources plus outputs already stored in the file.

By default this does NOT run the notebook (no LLM/API cost). Run all cells in Jupyter,
save the .ipynb, then run this script.

Examples:
  .venv/bin/python export_notebook_to_txt.py refactored-app-logic.ipynb
  .venv/bin/python export_notebook_to_txt.py refactored-app-logic.ipynb -o out.txt
  .venv/bin/python export_notebook_to_txt.py foo.ipynb --execute   # rare; needs nbclient
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import nbformat
except ImportError:
    print("Install: .venv/bin/python -m pip install nbformat", file=sys.stderr)
    sys.exit(1)


def format_output(out: dict) -> str:
    otype = out.get("output_type", "")
    if otype == "stream":
        return "".join(out.get("text", []))
    if otype in ("execute_result", "display_data"):
        data = out.get("data") or {}
        if "text/plain" in data:
            tp = data["text/plain"]
            return tp if isinstance(tp, str) else "".join(tp)
        keys = [k for k in data if k != "application/javascript"]
        if keys:
            return f"[display_data: {', '.join(keys)}]\n"
        return ""
    if otype == "error":
        tb = out.get("traceback")
        if tb:
            return "\n".join(tb) if isinstance(tb, list) else str(tb)
        return f"{out.get('ename', 'Error')}: {out.get('evalue', '')}\n"
    return ""


def cell_to_lines(cell: dict, index: int) -> list[str]:
    lines: list[str] = []
    ctype = cell.get("cell_type", "unknown")
    src = "".join(cell.get("source", []))
    lines.append("")
    lines.append("-" * 72)
    lines.append(f"Cell {index} ({ctype})")
    lines.append("-" * 72)
    lines.append(src.rstrip())
    if ctype == "code":
        outs = cell.get("outputs") or []
        ec = cell.get("execution_count")
        if ec is not None:
            lines.append("")
            lines.append(f"# execution_count: {ec}")
        lines.append("")
        lines.append("--- OUTPUT ---")
        if not outs:
            lines.append("(no saved output in .ipynb — run cells in Jupyter and save, then re-export)")
        else:
            for j, o in enumerate(outs, 1):
                block = format_output(o).rstrip()
                if len(outs) > 1 and block:
                    lines.append(f"[output {j} | {o.get('output_type', '?')}]")
                if block:
                    lines.append(block)
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export Jupyter notebook to plain text (sources + outputs on disk).",
    )
    parser.add_argument(
        "notebook",
        type=Path,
        help="Path to .ipynb (relative to cwd or absolute)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output .txt path (default: same name as notebook with .txt)",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Run the notebook before export (costly; needs: pip install nbclient)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=900,
        help="With --execute: timeout in seconds (default: 900)",
    )
    parser.add_argument(
        "--kernel",
        default=None,
        help="With --execute: kernel name (default: JUPYTER_KERNEL env or agentic-insights-dashboard, else python3)",
    )
    args = parser.parse_args()

    notebook_path = args.notebook.resolve()
    if not notebook_path.is_file():
        print(f"Not found: {notebook_path}", file=sys.stderr)
        sys.exit(1)

    out_path = args.output.resolve() if args.output else notebook_path.with_suffix(".txt")

    nb = nbformat.read(notebook_path, as_version=4)
    execution_note = ""

    if args.execute:
        try:
            from nbclient import execute as nb_execute
        except ImportError:
            print("Install: .venv/bin/python -m pip install nbclient", file=sys.stderr)
            sys.exit(1)

        import os

        cwd = str(notebook_path.parent)
        kernel = args.kernel or os.environ.get(
            "JUPYTER_KERNEL",
            "agentic-insights-dashboard",
        )
        try:
            nb_execute(
                nb,
                cwd=cwd,
                timeout=args.timeout,
                kernel_name=kernel,
                allow_errors=True,
            )
        except Exception as e:
            if kernel != "python3":
                try:
                    nb_execute(
                        nb,
                        cwd=cwd,
                        timeout=args.timeout,
                        kernel_name="python3",
                        allow_errors=True,
                    )
                    execution_note = (
                        f"Note: kernel '{kernel}' failed ({e}); retried with python3.\n"
                    )
                except Exception as e2:
                    execution_note = (
                        f"Execution failed (exporting notebook state as-is): {e2}\n"
                        f"(First attempt with kernel {kernel!r}: {e})\n"
                    )
            else:
                execution_note = f"Execution failed (exporting notebook state as-is): {e}\n"

    header_lines = [
        f"Exported from: {notebook_path.name}",
        f"Source path: {notebook_path}",
    ]
    if args.execute:
        header_lines.append(
            "Includes: outputs after --execute (and any execution note below).",
        )
    else:
        header_lines.append(
            "Mode: serialize only (outputs must already be saved in the .ipynb).",
        )
    if execution_note:
        header_lines.append(execution_note.rstrip())
    header_lines.append("=" * 72)

    all_lines = header_lines
    for i, cell in enumerate(nb.get("cells", []), 1):
        all_lines.extend(cell_to_lines(cell, i))
    all_lines.append("")
    all_lines.append("=" * 72)

    out_path.write_text("\n".join(all_lines), encoding="utf-8")
    print(f"Wrote {out_path} ({out_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
