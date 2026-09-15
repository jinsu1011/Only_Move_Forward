"""환경 설정. 비밀값은 web/backend/.env 에만 두고 프런트로 보내지 않는다."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent.parent


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file(BASE_DIR / ".env")

DATA_DIR = Path(os.environ.get("LF_DATA_DIR", PROJECT_ROOT / "data" / "local"))
DB_PATH = Path(os.environ.get("LF_DB_PATH", DATA_DIR / "license_fit.db"))
RULES_JSON = PROJECT_ROOT / "data" / "road-rule-research.json"

SESSION_DAYS = 7
COOKIE_SECURE = os.environ.get("LF_COOKIE_SECURE", "0") == "1"
ALLOWED_ORIGINS = {
    o.strip()
    for o in os.environ.get("LF_ALLOWED_ORIGINS", "http://localhost:5180,http://127.0.0.1:5180").split(",")
    if o.strip()
}

# 회사 제공 GPT: OpenAI 호환 엔드포인트 또는 Azure OpenAI
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "openai").lower()  # openai | azure
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4.1-mini")
LLM_API_VERSION = os.environ.get("LLM_API_VERSION", "2024-10-21")
LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "40"))


def llm_configured() -> bool:
    return bool(LLM_API_KEY)
