#!/usr/bin/env python3
"""Backward-compatible wrapper: pre-refactor-app-logic.ipynb → .txt"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
script = DIR / "export_notebook_to_txt.py"
nb = DIR / "pre-refactor-app-logic.ipynb"
subprocess.check_call([sys.executable, str(script), str(nb)], cwd=str(DIR))
