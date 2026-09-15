import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="lf-test-")
os.environ["LF_DB_PATH"] = str(Path(_tmp) / "test.db")
os.environ["LLM_API_KEY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
