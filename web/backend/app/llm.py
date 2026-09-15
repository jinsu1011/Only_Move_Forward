"""회사 제공 GPT(OpenAI 호환 / Azure OpenAI) 호출과 응답 검증.

AI 는 정답을 결정하지 않는다. 서버가 넣어 준 근거(검수 정답·조문 요약·저장된 기록)만
설명하고, 응답의 인용·수치는 서버가 다시 검사한다. 검사를 통과하지 못하면 노출하지 않는다.
"""
from __future__ import annotations

import json
import re

import httpx

from . import config

EXPLANATION_PROMPT_VERSION = "explain-1.0.0"
REPORT_PROMPT_VERSION = "report-1.0.0"


class LlmUnavailable(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def chat_json(system: str, user: dict) -> tuple[dict, str]:
    if not config.llm_configured():
        raise LlmUnavailable("LLM_NOT_CONFIGURED")
    if config.LLM_PROVIDER == "azure":
        url = f"{config.LLM_BASE_URL.rstrip('/')}/openai/deployments/{config.LLM_MODEL}/chat/completions?api-version={config.LLM_API_VERSION}"
        headers = {"api-key": config.LLM_API_KEY}
    else:
        url = f"{config.LLM_BASE_URL.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {config.LLM_API_KEY}"}
    body = {
        "model": config.LLM_MODEL,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ],
    }
    try:
        r = httpx.post(url, json=body, headers=headers, timeout=config.LLM_TIMEOUT)
        if r.status_code == 400 and "temperature" in r.text:
            body.pop("temperature")
            r = httpx.post(url, json=body, headers=headers, timeout=config.LLM_TIMEOUT)
    except httpx.TimeoutException as exc:
        raise LlmUnavailable("LLM_TIMEOUT") from exc
    except httpx.HTTPError as exc:
        raise LlmUnavailable("LLM_NETWORK_ERROR") from exc
    if r.status_code in (401, 403):
        raise LlmUnavailable("LLM_AUTH_FAILED")
    if r.status_code == 429:
        raise LlmUnavailable("LLM_RATE_LIMITED")
    if r.status_code >= 400:
        raise LlmUnavailable(f"LLM_HTTP_{r.status_code}")
    try:
        payload = r.json()
        content = payload["choices"][0]["message"]["content"]
        return json.loads(content), payload.get("model", config.LLM_MODEL)
    except (KeyError, IndexError, ValueError) as exc:
        raise LlmUnavailable("LLM_BAD_RESPONSE") from exc


def _text(value, limit: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("empty text")
    return value.strip()[:limit]


# ---------- 오답 해설 ----------
EXPLANATION_SYSTEM = """너는 한국 운전면허 학과시험 학습 도우미다.
규칙:
1. 정답은 입력의 correct_options 로 이미 확정되어 있다. 정답을 바꾸거나 의심하지 마라.
2. 입력의 evidence(조문 요약)와 explanation(검수 해설)에 있는 내용만 근거로 설명한다. 없는 법 조항·수치·예외를 만들지 마라.
3. 학습자의 선택(selected_options)이 왜 틀렸거나 맞았는지 쉬운 한국어로 설명한다.
4. 반드시 JSON 한 개만 출력한다:
{"summary": "한 문장 핵심", "why_selected_wrong": "내 선택이 틀린(또는 맞은) 이유", "key_rule": "기억할 규칙", "memory_tip": "짧은 암기 팁", "citation_chunk_ids": ["근거로 쓴 evidence id"]}"""


def validate_explanation(out: dict, allowed_chunks: set[str]) -> dict:
    cites = out.get("citation_chunk_ids")
    if not isinstance(cites, list) or not cites or not set(cites) <= allowed_chunks:
        raise ValueError("citation outside evidence")
    return {
        "summary": _text(out.get("summary"), 200),
        "why_selected_wrong": _text(out.get("why_selected_wrong"), 600),
        "key_rule": _text(out.get("key_rule"), 300),
        "memory_tip": _text(out.get("memory_tip"), 160),
        "citation_chunk_ids": sorted(set(cites)),
    }


# ---------- 통합 보고서 ----------
REPORT_SYSTEM = """너는 운전면허 준비생의 학습 코치다. 입력 JSON 은 서버가 실제 저장 기록에서 계산한 통계다.
규칙:
1. 입력에 없는 수치를 쓰지 마라. 수치를 쓸 때는 입력의 값을 그대로 쓴다.
2. unmeasured 목록의 행동(거울·사각지대 확인, 방향지시등, 반응시간, 시선 등)은 측정되지 않았으므로 평가하거나 추정하지 마라.
3. 주행 판정은 연습용 시뮬레이션이며 공식 채점이 아님을 전제로 말한다. 합격·불합격을 예측하지 마라.
4. evidence_ids 에 있는 id 만 근거로 인용한다.
5. 반드시 JSON 한 개만 출력한다:
{"headline": "40자 이내 한 줄", "summary": "2~3문장 요약",
 "focus_areas": [{"title": "", "reason": "", "evidence_ids": [""]}],
 "next_steps": [{"title": "", "detail": "", "target": "WRITTEN 또는 DRIVE", "ref": "카테고리 id 또는 시나리오 code"}]}
focus_areas 와 next_steps 는 각각 최대 3개."""

_NUM = re.compile(r"\d+(?:\.\d+)?")


def _numbers_in(obj) -> set[str]:
    found: set[str] = set()
    if isinstance(obj, dict):
        for v in obj.values():
            found |= _numbers_in(v)
    elif isinstance(obj, list):
        for v in obj:
            found |= _numbers_in(v)
    elif isinstance(obj, bool):
        pass
    elif isinstance(obj, (int, float)):
        found.add(_norm_num(str(obj)))
    elif isinstance(obj, str):
        found |= {_norm_num(n) for n in _NUM.findall(obj)}
    return found


def _norm_num(n: str) -> str:
    if "." in n:
        n = n.rstrip("0").rstrip(".")
    return n


def validate_report(out: dict, stats: dict) -> dict:
    allowed_ids = set(stats["evidence_ids"])
    allowed_refs = set(stats["allowed_refs"])
    allowed_nums = _numbers_in(stats) | {"1", "2", "3"}
    focus = []
    for f in (out.get("focus_areas") or [])[:3]:
        ids = f.get("evidence_ids") or []
        if not isinstance(ids, list) or not ids or not set(ids) <= allowed_ids:
            raise ValueError("evidence outside snapshot")
        focus.append({"title": _text(f.get("title"), 60), "reason": _text(f.get("reason"), 300), "evidence_ids": ids})
    steps = []
    for s in (out.get("next_steps") or [])[:3]:
        target = s.get("target")
        ref = s.get("ref")
        if target not in ("WRITTEN", "DRIVE") or ref not in allowed_refs:
            raise ValueError("invalid next step target")
        steps.append({"title": _text(s.get("title"), 60), "detail": _text(s.get("detail"), 300), "target": target, "ref": ref})
    result = {
        "headline": _text(out.get("headline"), 60),
        "summary": _text(out.get("summary"), 500),
        "focus_areas": focus,
        "next_steps": steps,
    }
    if not focus:
        raise ValueError("no focus areas")
    used = _numbers_in(result)
    unknown = used - allowed_nums
    if unknown:
        raise ValueError(f"unverified numbers: {sorted(unknown)}")
    return result
