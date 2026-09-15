"""전진만할게요 API (/api/v1). 제출 명세 api/design.yml 과 같은 경로·필드를 쓴다."""
from __future__ import annotations

import hashlib
import json
import random
import re
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from . import config, llm
from .db import connect, init_db, jdumps, jloads, new_id, now_iso, tx
from .errors import ApiError
from .reports import EVENT_LABELS, build_stats, rule_based_narrative, session_event_rows
from .security import (
    check_csrf,
    create_session,
    hash_password,
    login_limiter,
    revoke_session,
    rotate_csrf,
    session_user,
    verify_password,
)
from .seed import EVENT_MAP
from .sim import DISQUALIFY_CODES, SIM_VERSION, TICK_HZ, replay


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="전진만할게요 API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.exception_handler(ApiError)
async def _api_error(_req: Request, exc: ApiError):
    body = {"error": {"code": exc.code, "message": exc.message}}
    if exc.details is not None:
        body["error"]["details"] = exc.details
    return JSONResponse(body, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def _validation_error(_req: Request, exc: RequestValidationError):
    details = [{"field": ".".join(str(p) for p in e["loc"][1:]), "reason": e["msg"]} for e in exc.errors()]
    return JSONResponse(
        {"error": {"code": "VALIDATION_ERROR", "message": "입력값을 확인해 주세요.", "details": details}}, status_code=400
    )


def get_db():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def csrf_guard(request: Request):
    check_csrf(request)


def current_user(request: Request, conn=Depends(get_db)):
    return session_user(conn, request)


# ---------------- 공통: 재시도 중복 방지 ----------------
_KEY_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def _body_hash(body) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def idem_replay(conn, user_id: str, route: str, key: str | None, body) -> JSONResponse | None:
    if key is None:
        return None
    if not _KEY_RE.match(key):
        raise ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 형식이 올바르지 않습니다.")
    row = conn.execute(
        "SELECT body_hash,status_code,response FROM idempotency_keys WHERE user_id=? AND route=? AND request_key=?",
        (user_id, route, key),
    ).fetchone()
    if not row:
        return None
    if row["body_hash"] != _body_hash(body):
        raise ApiError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 키로 다른 내용이 전송되었습니다.")
    return JSONResponse(json.loads(row["response"]), status_code=row["status_code"], headers={"Idempotent-Replayed": "true"})


def idem_store(conn, user_id: str, route: str, key: str | None, body, status: int, response) -> None:
    if key is None:
        return
    conn.execute(
        "INSERT OR IGNORE INTO idempotency_keys(id,user_id,route,request_key,body_hash,status_code,response,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (new_id(), user_id, route, key, _body_hash(body), status, jdumps(response), now_iso()),
    )


def public_user(u) -> dict:
    return {
        "id": u["id"],
        "email": u["email"],
        "nickname": u["nickname"],
        "license_type": u["license_type"],
        "created_at": u["created_at"],
    }


# ---------------- 헬스·인증 ----------------
@app.get("/api/v1/health")
def health():
    return {"status": "ok", "sim_version": SIM_VERSION, "llm_configured": config.llm_configured(), "llm_model": config.LLM_MODEL if config.llm_configured() else None}


@app.get("/api/v1/auth/csrf")
def csrf_token(response: Response):
    return {"csrf_token": rotate_csrf(response)}


LicenseType = Literal["CLASS1_ORDINARY", "CLASS2_ORDINARY"]


class SignupIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=72)
    nickname: str = Field(min_length=2, max_length=20)
    license_type: LicenseType

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("이메일 형식이 아닙니다")
        return v

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
            raise ValueError("영문과 숫자를 함께 포함해야 합니다")
        return v

    @field_validator("nickname")
    @classmethod
    def _nick(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("2자 이상 입력해 주세요")
        return v


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=72)


@app.post("/api/v1/auth/signup", status_code=201, dependencies=[Depends(csrf_guard)])
def signup(body: SignupIn, response: Response, conn=Depends(get_db)):
    if conn.execute("SELECT 1 FROM users WHERE email=?", (body.email,)).fetchone():
        raise ApiError(409, "EMAIL_TAKEN", "이미 가입된 이메일입니다.")
    uid = new_id()
    with tx(conn):
        conn.execute(
            "INSERT INTO users(id,email,password_hash,nickname,license_type,created_at) VALUES(?,?,?,?,?,?)",
            (uid, body.email, hash_password(body.password), body.nickname, body.license_type, now_iso()),
        )
        create_session(conn, uid, response)
    return public_user(conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())


@app.post("/api/v1/auth/login", dependencies=[Depends(csrf_guard)])
def login(body: LoginIn, request: Request, response: Response, conn=Depends(get_db)):
    key = f"{body.email.strip().lower()}|{request.client.host if request.client else ''}"
    login_limiter.check(key)
    user = conn.execute("SELECT * FROM users WHERE email=?", (body.email.strip().lower(),)).fetchone()
    if not user or not verify_password(body.password, user["password_hash"]):
        login_limiter.fail(key)
        raise ApiError(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 맞지 않습니다.")
    login_limiter.reset(key)
    with tx(conn):
        create_session(conn, user["id"], response)
    return public_user(user)


@app.post("/api/v1/auth/logout", status_code=204, dependencies=[Depends(csrf_guard)])
def logout(request: Request, conn=Depends(get_db)):
    response = Response(status_code=204)
    with tx(conn):
        revoke_session(conn, request, response)
    return response


@app.get("/api/v1/me")
def me(user=Depends(current_user)):
    return public_user(user)


# ---------------- 안내·대시보드 ----------------
@app.get("/api/v1/guide")
def guide(conn=Depends(get_db)):
    steps = conn.execute(
        "SELECT g.step_order,g.title,g.content,s.title AS source_title,s.url,s.retrieved_at FROM guide_steps g "
        "JOIN official_sources s ON s.id=g.source_id ORDER BY g.step_order"
    ).fetchall()
    sources = conn.execute("SELECT id,title,publisher,url,version,effective_from,retrieved_at,review_status FROM official_sources").fetchall()
    counts = conn.execute(
        "SELECT support, kind, COUNT(*) AS n FROM official_scoring_rules GROUP BY support, kind"
    ).fetchall()
    return {
        "steps": [{"order": s["step_order"], "title": s["title"], "content": s["content"]} for s in steps],
        "sources": [dict(s) for s in sources],
        "road_rule_support": [dict(c) for c in counts],
        "notice": "공식 시험·실차교육을 대체하지 않는 학습 보조 서비스입니다. 세부 조건은 공식 원문을 확인하세요.",
    }


@app.get("/api/v1/dashboard")
def dashboard(user=Depends(current_user), conn=Depends(get_db)):
    uid = user["id"]
    w = conn.execute(
        "SELECT COUNT(*) AS n, SUM(correct_count) AS c, SUM(question_count) AS t FROM written_attempts WHERE user_id=? AND status='SUBMITTED'",
        (uid,),
    ).fetchone()
    recent_w = conn.execute(
        "SELECT id,score,max_score,correct_count,question_count,submitted_at FROM written_attempts WHERE user_id=? AND status='SUBMITTED' ORDER BY submitted_at DESC LIMIT 6",
        (uid,),
    ).fetchall()
    in_progress = conn.execute(
        "SELECT id,question_count,started_at FROM written_attempts WHERE user_id=? AND status='IN_PROGRESS' ORDER BY started_at DESC LIMIT 1",
        (uid,),
    ).fetchone()
    d = conn.execute(
        "SELECT COUNT(*) AS n, SUM(status='COMPLETED') AS done, SUM(status='DISQUALIFIED') AS dq FROM training_sessions WHERE user_id=? AND status!='RUNNING' AND status!='ABORTED'",
        (uid,),
    ).fetchone()
    recent_d = conn.execute(
        "SELECT ts.id,ts.status,ts.ended_at,ts.reference_deduction,ts.input_mode,s.title,s.kind,"
        "(SELECT COUNT(*) FROM driving_events de WHERE de.session_id=ts.id AND de.event_code NOT IN ('STAGE_CLEAR','COURSE_COMPLETE')) AS event_count "
        "FROM training_sessions ts JOIN scenarios s ON s.id=ts.scenario_id WHERE ts.user_id=? AND ts.status NOT IN ('RUNNING','ABORTED') ORDER BY ts.ended_at DESC LIMIT 6",
        (uid,),
    ).fetchall()
    report = conn.execute(
        "SELECT id,status,created_at FROM ai_jobs WHERE user_id=? AND kind='REPORT' ORDER BY created_at DESC LIMIT 1", (uid,)
    ).fetchone()
    return {
        "user": public_user(user),
        "written": {
            "submitted_count": w["n"],
            "correct_total": w["c"] or 0,
            "answer_total": w["t"] or 0,
            "recent": [dict(r) for r in recent_w],
            "in_progress": dict(in_progress) if in_progress else None,
        },
        "driving": {
            "session_count": d["n"],
            "completed_count": d["done"] or 0,
            "disqualified_count": d["dq"] or 0,
            "recent": [dict(r) for r in recent_d],
        },
        "latest_report": dict(report) if report else None,
        "llm_configured": config.llm_configured(),
    }


# ---------------- 필기 ----------------
@app.get("/api/v1/written/catalog")
def written_catalog(user=Depends(current_user), conn=Depends(get_db)):
    rows = conn.execute(
        "SELECT c.id,c.name_ko,COUNT(q.id) AS n FROM categories c LEFT JOIN questions q ON q.category_id=c.id "
        "AND q.review_status IN ('SELF_REVIEWED','APPROVED') AND q.license_scope IN ('ALL',?) "
        "WHERE c.domain='WRITTEN' GROUP BY c.id ORDER BY c.sort_order",
        (user["license_type"],),
    ).fetchall()
    return {
        "license_type": user["license_type"],
        "categories": [{"id": r["id"], "name": r["name_ko"], "question_count": r["n"]} for r in rows],
        "total_questions": sum(r["n"] for r in rows),
        "modes": [
            {"mode": "PRACTICE", "available": True, "label": "주제별 연습"},
            {"mode": "MOCK_EXAM", "available": False, "label": "실전 모의고사", "reason": "공식 문제은행 이용 조건·정답 검수 전이라 비활성"},
        ],
        "data_notice": "자체 제작 연습 문항입니다. 공식 문제은행 문항이 아니며, 조문 근거와 시행 버전은 계속 대조 중입니다.",
    }


class AttemptCreateIn(BaseModel):
    mode: Literal["PRACTICE"] = "PRACTICE"
    category_ids: list[str] = Field(default_factory=list, max_length=10)
    question_count: int = Field(ge=1, le=40)


def _attempt_detail(conn, attempt, reveal: bool = False) -> dict:
    qrows = conn.execute(
        "SELECT aq.id AS aq_id, aq.position, q.*, c.name_ko AS category_name, wa.id AS answer_id FROM attempt_questions aq "
        "JOIN questions q ON q.id=aq.question_id JOIN categories c ON c.id=q.category_id "
        "LEFT JOIN written_answers wa ON wa.attempt_question_id=aq.id WHERE aq.attempt_id=? ORDER BY aq.position",
        (attempt["id"],),
    ).fetchall()
    questions = []
    answered = 0
    for q in qrows:
        opts = conn.execute(
            "SELECT id,position,content,is_correct FROM question_options WHERE question_id=? ORDER BY position", (q["id"],)
        ).fetchall()
        selected = []
        if q["answer_id"]:
            selected = [
                r["option_id"]
                for r in conn.execute(
                    "SELECT s.option_id FROM answer_selections s JOIN question_options o ON o.id=s.option_id WHERE s.answer_id=? ORDER BY o.position",
                    (q["answer_id"],),
                ).fetchall()
            ]
        if selected:
            answered += 1
        questions.append(
            {
                "attempt_question_id": q["aq_id"],
                "position": q["position"],
                "question_id": q["id"],
                "code": q["code"],
                "category": {"id": q["category_id"], "name": q["category_name"]},
                "kind": q["kind"],
                "review_status": q["review_status"],
                "prompt": q["prompt"],
                "media_url": q["media_url"],
                "points": q["points"],
                "required_selections": q["required_selections"],
                "options": [
                    {"id": o["id"], "position": o["position"], "content": o["content"], **({"is_correct": bool(o["is_correct"])} if reveal else {})}
                    for o in opts
                ],
                "selected_option_ids": selected,
            }
        )
    return {
        "id": attempt["id"],
        "mode": attempt["mode"],
        "status": attempt["status"],
        "license_type": attempt["license_type"],
        "question_count": attempt["question_count"],
        "answered_count": answered,
        "max_score": attempt["max_score"],
        "started_at": attempt["started_at"],
        "submitted_at": attempt["submitted_at"],
        "questions": questions,
    }


def _owned_attempt(conn, attempt_id: str, user_id: str):
    a = conn.execute("SELECT * FROM written_attempts WHERE id=? AND user_id=?", (attempt_id, user_id)).fetchone()
    if not a:
        raise ApiError(404, "ATTEMPT_NOT_FOUND", "필기 시도를 찾을 수 없습니다.")
    return a


@app.post("/api/v1/written/attempts", status_code=201, dependencies=[Depends(csrf_guard)])
def create_attempt(
    body: AttemptCreateIn,
    user=Depends(current_user),
    conn=Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    route = "POST /written/attempts"
    replayed = idem_replay(conn, user["id"], route, idempotency_key, body.model_dump())
    if replayed:
        return replayed
    valid = {r["id"] for r in conn.execute("SELECT id FROM categories WHERE domain='WRITTEN'").fetchall()}
    if set(body.category_ids) - valid:
        raise ApiError(400, "INVALID_CATEGORY", "존재하지 않는 주제가 포함되어 있습니다.")
    params: list = [user["license_type"]]
    where = "q.review_status IN ('SELF_REVIEWED','APPROVED') AND q.kind IN ('OFFICIAL','PRACTICE') AND q.license_scope IN ('ALL',?)"
    if body.category_ids:
        where += f" AND q.category_id IN ({','.join('?' * len(body.category_ids))})"
        params += body.category_ids
    pool = conn.execute(f"SELECT q.id,q.points FROM questions q WHERE {where}", params).fetchall()
    if not pool:
        raise ApiError(409, "NO_REVIEWED_QUESTIONS", "선택한 주제에 검수된 문항이 없습니다.")
    picked = random.sample(list(pool), min(body.question_count, len(pool)))
    aid = new_id()
    with tx(conn):
        conn.execute(
            "INSERT INTO written_attempts(id,user_id,license_type,mode,status,question_count,max_score,started_at) VALUES(?,?,?,?,'IN_PROGRESS',?,?,?)",
            (aid, user["id"], user["license_type"], body.mode, len(picked), sum(p["points"] for p in picked), now_iso()),
        )
        for i, q in enumerate(picked, start=1):
            conn.execute(
                "INSERT INTO attempt_questions(id,attempt_id,question_id,position) VALUES(?,?,?,?)", (new_id(), aid, q["id"], i)
            )
        result = _attempt_detail(conn, conn.execute("SELECT * FROM written_attempts WHERE id=?", (aid,)).fetchone())
        idem_store(conn, user["id"], route, idempotency_key, body.model_dump(), 201, result)
    return result


@app.get("/api/v1/written/attempts")
def list_attempts(limit: int = Query(20, ge=1, le=50), user=Depends(current_user), conn=Depends(get_db)):
    rows = conn.execute(
        "SELECT id,mode,status,question_count,max_score,score,correct_count,started_at,submitted_at FROM written_attempts WHERE user_id=? ORDER BY started_at DESC LIMIT ?",
        (user["id"], limit),
    ).fetchall()
    return {"items": [dict(r) for r in rows]}


@app.get("/api/v1/written/attempts/{attempt_id}")
def get_attempt(attempt_id: str, user=Depends(current_user), conn=Depends(get_db)):
    a = _owned_attempt(conn, attempt_id, user["id"])
    return _attempt_detail(conn, a, reveal=False)


class AnswerIn(BaseModel):
    option_ids: list[str] = Field(max_length=2)


@app.put("/api/v1/written/attempts/{attempt_id}/answers/{question_id}", dependencies=[Depends(csrf_guard)])
def save_answer(attempt_id: str, question_id: str, body: AnswerIn, user=Depends(current_user), conn=Depends(get_db)):
    a = _owned_attempt(conn, attempt_id, user["id"])
    if a["status"] != "IN_PROGRESS":
        raise ApiError(409, "ATTEMPT_ALREADY_SUBMITTED", "이미 제출한 시도입니다.")
    aq = conn.execute(
        "SELECT aq.id, q.required_selections FROM attempt_questions aq JOIN questions q ON q.id=aq.question_id WHERE aq.attempt_id=? AND aq.question_id=?",
        (attempt_id, question_id),
    ).fetchone()
    if not aq:
        raise ApiError(404, "QUESTION_NOT_IN_ATTEMPT", "이 시도에 포함된 문항이 아닙니다.")
    ids = list(dict.fromkeys(body.option_ids))
    if len(ids) > aq["required_selections"]:
        raise ApiError(400, "TOO_MANY_SELECTIONS", f"이 문항은 {aq['required_selections']}개까지 선택할 수 있습니다.")
    if ids:
        valid = conn.execute(
            f"SELECT COUNT(*) AS n FROM question_options WHERE question_id=? AND id IN ({','.join('?' * len(ids))})",
            [question_id, *ids],
        ).fetchone()["n"]
        if valid != len(ids):
            raise ApiError(400, "INVALID_OPTION", "문항에 속하지 않은 보기입니다.")
    ts = now_iso()
    with tx(conn):
        row = conn.execute("SELECT id FROM written_answers WHERE attempt_question_id=?", (aq["id"],)).fetchone()
        if row:
            ans_id = row["id"]
            conn.execute("UPDATE written_answers SET updated_at=? WHERE id=?", (ts, ans_id))
            conn.execute("DELETE FROM answer_selections WHERE answer_id=?", (ans_id,))
        else:
            ans_id = new_id()
            conn.execute("INSERT INTO written_answers(id,attempt_question_id,updated_at) VALUES(?,?,?)", (ans_id, aq["id"], ts))
        for oid in ids:
            conn.execute("INSERT INTO answer_selections(answer_id,option_id) VALUES(?,?)", (ans_id, oid))
    return {"attempt_id": attempt_id, "question_id": question_id, "selected_option_ids": ids, "updated_at": ts}


def _written_result(conn, attempt) -> dict:
    rows = conn.execute(
        "SELECT wa.id AS answer_id, wa.is_correct, wa.earned_points, aq.position, q.id AS question_id, q.prompt, q.points, "
        "c.id AS category_id, c.name_ko AS category_name FROM attempt_questions aq JOIN written_answers wa ON wa.attempt_question_id=aq.id "
        "JOIN questions q ON q.id=aq.question_id JOIN categories c ON c.id=q.category_id WHERE aq.attempt_id=? ORDER BY aq.position",
        (attempt["id"],),
    ).fetchall()
    by_cat: dict[str, dict] = {}
    for r in rows:
        c = by_cat.setdefault(r["category_id"], {"category_id": r["category_id"], "name": r["category_name"], "correct": 0, "total": 0})
        c["total"] += 1
        c["correct"] += int(r["is_correct"])
    return {
        "attempt_id": attempt["id"],
        "mode": attempt["mode"],
        "status": attempt["status"],
        "score": attempt["score"],
        "max_score": attempt["max_score"],
        "correct_count": attempt["correct_count"],
        "question_count": attempt["question_count"],
        "submitted_at": attempt["submitted_at"],
        "outcome": "PRACTICE_NO_PASS_JUDGEMENT",
        "outcome_notice": "연습 모드는 공식 합격 판정을 하지 않습니다. 실제 학과시험은 1종 보통 70점·2종 보통 60점 이상 합격입니다.",
        "by_category": list(by_cat.values()),
        "items": [
            {
                "answer_id": r["answer_id"],
                "position": r["position"],
                "question_id": r["question_id"],
                "prompt": r["prompt"],
                "category": {"id": r["category_id"], "name": r["category_name"]},
                "is_correct": bool(r["is_correct"]),
                "earned_points": r["earned_points"],
                "points": r["points"],
            }
            for r in rows
        ],
    }


@app.post("/api/v1/written/attempts/{attempt_id}/submit", dependencies=[Depends(csrf_guard)])
def submit_attempt(attempt_id: str, user=Depends(current_user), conn=Depends(get_db)):
    a = _owned_attempt(conn, attempt_id, user["id"])
    if a["status"] == "SUBMITTED":
        return _written_result(conn, a)
    if a["status"] != "IN_PROGRESS":
        raise ApiError(409, "ATTEMPT_NOT_ACTIVE", "제출할 수 없는 시도입니다.")
    ts = now_iso()
    with tx(conn):
        aqs = conn.execute(
            "SELECT aq.id, aq.question_id, q.points FROM attempt_questions aq JOIN questions q ON q.id=aq.question_id WHERE aq.attempt_id=?",
            (attempt_id,),
        ).fetchall()
        score = 0
        correct_count = 0
        for aq in aqs:
            ans = conn.execute("SELECT id FROM written_answers WHERE attempt_question_id=?", (aq["id"],)).fetchone()
            ans_id = ans["id"] if ans else new_id()
            if not ans:
                conn.execute("INSERT INTO written_answers(id,attempt_question_id,updated_at) VALUES(?,?,?)", (ans_id, aq["id"], ts))
            selected = {r["option_id"] for r in conn.execute("SELECT option_id FROM answer_selections WHERE answer_id=?", (ans_id,)).fetchall()}
            correct = {r["id"] for r in conn.execute("SELECT id FROM question_options WHERE question_id=? AND is_correct=1", (aq["question_id"],)).fetchall()}
            ok = selected == correct
            earned = aq["points"] if ok else 0
            score += earned
            correct_count += int(ok)
            conn.execute("UPDATE written_answers SET is_correct=?, earned_points=? WHERE id=?", (int(ok), earned, ans_id))
        conn.execute(
            "UPDATE written_attempts SET status='SUBMITTED', submitted_at=?, score=?, correct_count=? WHERE id=?",
            (ts, score, correct_count, attempt_id),
        )
    return _written_result(conn, conn.execute("SELECT * FROM written_attempts WHERE id=?", (attempt_id,)).fetchone())


@app.get("/api/v1/written/attempts/{attempt_id}/result")
def attempt_result(attempt_id: str, user=Depends(current_user), conn=Depends(get_db)):
    a = _owned_attempt(conn, attempt_id, user["id"])
    if a["status"] != "SUBMITTED":
        raise ApiError(409, "ATTEMPT_NOT_SUBMITTED", "제출 후에 결과를 볼 수 있습니다.")
    return _written_result(conn, a)


def _latest_ai(conn, user_id: str, answer_id: str):
    row = conn.execute(
        "SELECT * FROM ai_jobs WHERE user_id=? AND kind='EXPLANATION' AND answer_id=? ORDER BY created_at DESC LIMIT 1",
        (user_id, answer_id),
    ).fetchone()
    return _ai_job_out(conn, row) if row else None


@app.get("/api/v1/written/answers/{answer_id}")
def answer_review(answer_id: str, user=Depends(current_user), conn=Depends(get_db)):
    row = conn.execute(
        "SELECT wa.*, aq.attempt_id, aq.position, wat.status AS attempt_status, q.id AS qid, q.prompt, q.explanation, q.points, q.required_selections, "
        "q.kind, q.review_status, q.code, c.id AS category_id, c.name_ko AS category_name, sc.id AS chunk_id, sc.locator, sc.content AS chunk_content, "
        "os.title AS source_title, os.url AS source_url, os.retrieved_at "
        "FROM written_answers wa JOIN attempt_questions aq ON aq.id=wa.attempt_question_id JOIN written_attempts wat ON wat.id=aq.attempt_id "
        "JOIN questions q ON q.id=aq.question_id JOIN categories c ON c.id=q.category_id JOIN source_chunks sc ON sc.id=q.chunk_id "
        "JOIN official_sources os ON os.id=sc.source_id WHERE wa.id=? AND wat.user_id=?",
        (answer_id, user["id"]),
    ).fetchone()
    if not row:
        raise ApiError(404, "ANSWER_NOT_FOUND", "답안을 찾을 수 없습니다.")
    if row["attempt_status"] != "SUBMITTED":
        raise ApiError(409, "ATTEMPT_NOT_SUBMITTED", "제출 후에 정답과 해설을 볼 수 있습니다.")
    opts = conn.execute("SELECT id,position,content,is_correct FROM question_options WHERE question_id=? ORDER BY position", (row["qid"],)).fetchall()
    selected = [r["option_id"] for r in conn.execute("SELECT option_id FROM answer_selections WHERE answer_id=?", (answer_id,)).fetchall()]
    siblings = conn.execute(
        "SELECT wa.id FROM attempt_questions aq JOIN written_answers wa ON wa.attempt_question_id=aq.id WHERE aq.attempt_id=? ORDER BY aq.position",
        (row["attempt_id"],),
    ).fetchall()
    ids = [s["id"] for s in siblings]
    idx = ids.index(answer_id)
    return {
        "answer_id": answer_id,
        "attempt_id": row["attempt_id"],
        "position": row["position"],
        "is_correct": bool(row["is_correct"]),
        "earned_points": row["earned_points"],
        "selected_option_ids": selected,
        "correct_option_ids": [o["id"] for o in opts if o["is_correct"]],
        "question": {
            "id": row["qid"],
            "code": row["code"],
            "prompt": row["prompt"],
            "points": row["points"],
            "required_selections": row["required_selections"],
            "kind": row["kind"],
            "review_status": row["review_status"],
            "category": {"id": row["category_id"], "name": row["category_name"]},
            "options": [{"id": o["id"], "position": o["position"], "content": o["content"], "is_correct": bool(o["is_correct"])} for o in opts],
            "explanation": row["explanation"],
        },
        "evidence": {
            "chunk_id": row["chunk_id"],
            "locator": row["locator"],
            "content": row["chunk_content"],
            "source_title": row["source_title"],
            "source_url": row["source_url"],
            "retrieved_at": row["retrieved_at"],
        },
        "prev_answer_id": ids[idx - 1] if idx > 0 else None,
        "next_answer_id": ids[idx + 1] if idx + 1 < len(ids) else None,
        "latest_ai_job": _latest_ai(conn, user["id"], answer_id),
    }


# ---------------- 주행 시나리오·규칙 ----------------
@app.get("/api/v1/scenarios")
def list_scenarios(kind: Literal["FUNCTION", "ROAD"] | None = None, user=Depends(current_user), conn=Depends(get_db)):
    q = "SELECT s.*, (SELECT COUNT(DISTINCT rule_id) FROM scenario_rules sr WHERE sr.scenario_id=s.id) AS rule_count FROM scenarios s WHERE s.is_active=1"
    params: list = []
    if kind:
        q += " AND s.kind=?"
        params.append(kind)
    rows = conn.execute(q + " ORDER BY s.kind", params).fetchall()
    items = []
    for r in rows:
        d = jloads(r["definition"])
        items.append(
            {
                "id": r["id"], "code": r["code"], "version": r["version"], "kind": r["kind"], "title": r["title"],
                "summary": r["summary"], "sim_version": r["sim_version"], "length_m": d["length_m"],
                "time_limit_s": d["time_limit_s"], "practice_rule_count": r["rule_count"],
                "features": {
                    "signals": len(d["signals"]), "school_zones": len(d["school_zones"]), "crosswalks": len(d["crosswalks"]), "stages": len(d["stages"]),
                },
            }
        )
    return {"items": items}


def _scenario(conn, scenario_id: str):
    s = conn.execute("SELECT * FROM scenarios WHERE id=? AND is_active=1", (scenario_id,)).fetchone()
    if not s:
        raise ApiError(404, "SCENARIO_NOT_FOUND", "코스를 찾을 수 없습니다.")
    return s


@app.get("/api/v1/scenarios/{scenario_id}")
def scenario_detail(scenario_id: str, user=Depends(current_user), conn=Depends(get_db)):
    s = _scenario(conn, scenario_id)
    rules = conn.execute(
        "SELECT r.code,r.name_ko,r.kind,r.deduction_points,r.support,r.method,r.limitations,r.locator, GROUP_CONCAT(sr.event_code) AS events "
        "FROM scenario_rules sr JOIN official_scoring_rules r ON r.id=sr.rule_id WHERE sr.scenario_id=? GROUP BY r.id ORDER BY r.code",
        (scenario_id,),
    ).fetchall()
    return {
        "id": s["id"], "code": s["code"], "version": s["version"], "kind": s["kind"], "title": s["title"], "summary": s["summary"],
        "sim_version": s["sim_version"], "definition": jloads(s["definition"]),
        "practice_rules": [
            {**{k: r[k] for k in ("code", "name_ko", "kind", "deduction_points", "support", "method", "limitations", "locator")},
             "event_codes": r["events"].split(","), "event_labels": [EVENT_LABELS[e] for e in r["events"].split(",")]}
            for r in rules
        ],
        "scoring_notice": "연습용 판정입니다. 공식 채점과 같은 방식으로 검증된 자동 채점(A) 항목은 아직 없습니다.",
    }


@app.get("/api/v1/scoring-rules")
def scoring_rules(user=Depends(current_user), conn=Depends(get_db)):
    rows = conn.execute(
        "SELECT r.code,r.name_ko,r.kind,r.deduction_points,r.support,r.method,r.limitations,r.locator,r.auto_scoring_enabled,"
        "s.title AS source_title,s.url AS source_url,s.version AS source_version,s.effective_from FROM official_scoring_rules r "
        "JOIN official_sources s ON s.id=r.source_id ORDER BY r.code"
    ).fetchall()
    return {"items": [{**dict(r), "auto_scoring_enabled": bool(r["auto_scoring_enabled"])} for r in rows]}


# ---------------- 주행 세션 ----------------
class CalibrationIn(BaseModel):
    center_deg: float = Field(ge=-90, le=90)
    invert: bool
    enter_deg: float = Field(ge=5, le=30)
    exit_deg: float = Field(ge=2, le=29)
    smoothing_ms: int = Field(default=0, ge=0, le=1000)
    dwell_ms: int = Field(default=0, ge=0, le=1000)
    stable_spread_deg: float = Field(ge=0, le=10)
    left_confirmed: bool
    right_confirmed: bool
    sample_hz: float | None = Field(default=None, ge=0, le=500)
    firmware_format: Literal["WME", "ROLL_PITCH", "ROLL"]
    steering_axis: Literal["ROLL", "PITCH"] = "ROLL"

    @field_validator("right_confirmed")
    @classmethod
    def _confirmed(cls, v, info):
        if not v or not info.data.get("left_confirmed"):
            raise ValueError("좌우 확인이 끝난 보정값만 사용할 수 있습니다")
        return v


class SessionCreateIn(BaseModel):
    scenario_id: str
    input_mode: Literal["KEYBOARD", "SENSOR"]
    calibration: CalibrationIn | None = None


def _session_summary(conn, row) -> dict:
    s = conn.execute("SELECT id,code,version,kind,title FROM scenarios WHERE id=?", (row["scenario_id"],)).fetchone()
    return {
        "id": row["id"],
        "scenario": dict(s),
        "input_mode": row["input_mode"],
        "calibration": jloads(row["calibration_snapshot"]),
        "status": row["status"],
        "verification_status": row["verification_status"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "end_reason": row["end_reason"],
    }


@app.post("/api/v1/training/sessions", status_code=201, dependencies=[Depends(csrf_guard)])
def create_session_route(
    body: SessionCreateIn,
    user=Depends(current_user),
    conn=Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    route = "POST /training/sessions"
    replayed = idem_replay(conn, user["id"], route, idempotency_key, body.model_dump())
    if replayed:
        return replayed
    _scenario(conn, body.scenario_id)
    if (body.input_mode == "SENSOR") != (body.calibration is not None):
        raise ApiError(400, "CALIBRATION_MISMATCH", "센서 모드에는 보정값이 필요하고, 키보드 모드에는 보정값을 보내지 않습니다.")
    if body.calibration and body.calibration.exit_deg >= body.calibration.enter_deg:
        raise ApiError(400, "INVALID_HYSTERESIS", "복귀 각도는 진입 각도보다 작아야 합니다.")
    sid = new_id()
    with tx(conn):
        # 같은 사용자의 이전 RUNNING 세션은 새 시도로 대체되며 기록은 남긴다
        conn.execute(
            "UPDATE training_sessions SET status='ABORTED', ended_at=?, end_reason='SUPERSEDED', verification_status='NOT_APPLICABLE' WHERE user_id=? AND status='RUNNING'",
            (now_iso(), user["id"]),
        )
        conn.execute(
            "INSERT INTO training_sessions(id,user_id,scenario_id,input_mode,calibration_snapshot,status,verification_status,started_at) VALUES(?,?,?,?,?,'RUNNING','PENDING',?)",
            (sid, user["id"], body.scenario_id, body.input_mode, jdumps(body.calibration.model_dump()) if body.calibration else None, now_iso()),
        )
        out = _session_summary(conn, conn.execute("SELECT * FROM training_sessions WHERE id=?", (sid,)).fetchone())
        idem_store(conn, user["id"], route, idempotency_key, body.model_dump(), 201, out)
    return out


def _owned_session(conn, session_id: str, user_id: str):
    row = conn.execute("SELECT * FROM training_sessions WHERE id=? AND user_id=?", (session_id, user_id)).fetchone()
    if not row:
        raise ApiError(404, "SESSION_NOT_FOUND", "주행 기록을 찾을 수 없습니다.")
    return row


class ClientEvent(BaseModel):
    code: str = Field(max_length=40)
    tick: int = Field(ge=0)


class CompleteIn(BaseModel):
    total_ticks: int = Field(ge=1, le=TICK_HZ * 600)
    inputs: list[list[int]] = Field(max_length=20000)
    client_events: list[ClientEvent] = Field(default_factory=list, max_length=200)
    end_reason: Literal["TERMINAL_EVENT", "USER_END"]
    pause_count: int = Field(default=0, ge=0, le=1000)


def _training_result(conn, row) -> dict:
    out = _session_summary(conn, row)
    events = session_event_rows(conn, row["id"])
    ticks = row["total_ticks"] or 0
    out.update(
        {
            "total_ticks": ticks,
            "duration_s": round(ticks / TICK_HZ, 1),
            "distance_m": row["distance_m"],
            "max_speed_kmh": row["max_speed_kmh"],
            "pause_count": row["pause_count"],
            "reference_deduction": row["reference_deduction"],
            "official_scoring": False,
            "events": events,
            "scoring_notice": "연습용 판정입니다. 참고 감점은 별표26 해당 항목의 공식 감점값을 표시한 것이며 공식 채점 결과가 아닙니다.",
            "unmeasured": ["거울·사각지대 확인", "방향지시등", "시선·반응 시간", "좌석안전띠·기어·주차브레이크"],
        }
    )
    return out


@app.post("/api/v1/training/sessions/{session_id}/complete", dependencies=[Depends(csrf_guard)])
def complete_session(session_id: str, body: CompleteIn, user=Depends(current_user), conn=Depends(get_db)):
    row = _owned_session(conn, session_id, user["id"])
    in_hash = _body_hash({"t": body.total_ticks, "i": body.inputs})
    if row["status"] != "RUNNING":
        if row["input_hash"] == in_hash:
            return _training_result(conn, row)
        raise ApiError(409, "SESSION_ALREADY_ENDED", "이미 종료된 주행입니다.")
    prev_tick = -1
    for item in body.inputs:
        if len(item) != 3 or item[1] not in (-1, 0, 1) or item[2] not in (-1, 0, 1) or not (prev_tick <= item[0] < body.total_ticks):
            raise ApiError(400, "INVALID_INPUT_LOG", "입력 기록 형식이 올바르지 않습니다.")
        prev_tick = item[0]
    scen = conn.execute("SELECT * FROM scenarios WHERE id=?", (row["scenario_id"],)).fetchone()
    definition = jloads(scen["definition"])
    if body.total_ticks > definition["time_limit_s"] * TICK_HZ + 1:
        raise ApiError(413, "INPUT_LOG_TOO_LONG", "제한 시간을 넘는 입력 기록입니다.")
    sim = replay(definition, body.inputs, body.total_ticks)

    server_pairs = [(e["code"], e["tick"]) for e in sim.events]
    client_pairs = [(e.code, e.tick) for e in body.client_events]
    verified = len(server_pairs) == len(client_pairs) and all(
        sc == cc and abs(st - ct) <= 2 for (sc, st), (cc, ct) in zip(server_pairs, client_pairs)
    )
    # 사건은 누적 기록한다. 완주했더라도 실격 해당 사건이 하나라도 있으면 DISQUALIFIED(실격 사유 포함).
    has_dq = any(e["code"] in DISQUALIFY_CODES for e in sim.events)
    if sim.end_code == "COURSE_COMPLETE":
        status = "DISQUALIFIED" if has_dq else "COMPLETED"
    else:
        status = "INCOMPLETE"

    rules = {
        r["code"]: r
        for r in conn.execute("SELECT id,code,kind,deduction_points FROM official_scoring_rules").fetchall()
    }
    deduction = 0
    with tx(conn):
        for e in sim.events:
            rule_code, category = EVENT_MAP.get(e["code"], (None, "DRV_BASIC"))
            if scen["kind"] != "ROAD":
                rule_code = None
            rule = rules.get(rule_code) if rule_code else None
            if rule and rule["kind"] == "DEDUCTION":
                deduction += rule["deduction_points"]
            conn.execute(
                "INSERT INTO driving_events(id,session_id,seq,event_code,rule_id,category_id,tick,s_m,speed_kmh,is_terminal,evidence) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (new_id(), session_id, e["seq"], e["code"], rule["id"] if rule else None, category, e["tick"], e["s_m"], e["speed_kmh"], int(e["terminal"]), jdumps(e["evidence"])),
            )
        conn.execute(
            "UPDATE training_sessions SET status=?, verification_status=?, ended_at=?, total_ticks=?, input_log=?, input_hash=?, pause_count=?, end_reason=?, "
            "distance_m=?, max_speed_kmh=?, reference_deduction=? WHERE id=?",
            (
                status, "VERIFIED" if verified else "MISMATCH", now_iso(), sim.tick, jdumps(body.inputs), in_hash, body.pause_count,
                body.end_reason if status == "INCOMPLETE" else sim.end_code, round(sim.distance, 1), round(sim.max_speed, 1),
                deduction if scen["kind"] == "ROAD" else None, session_id,
            ),
        )
    return _training_result(conn, conn.execute("SELECT * FROM training_sessions WHERE id=?", (session_id,)).fetchone())


class AbortIn(BaseModel):
    reason: Literal["RESTART", "SENSOR_LOST", "USER_EXIT"]


@app.post("/api/v1/training/sessions/{session_id}/abort", dependencies=[Depends(csrf_guard)])
def abort_session(session_id: str, body: AbortIn, user=Depends(current_user), conn=Depends(get_db)):
    row = _owned_session(conn, session_id, user["id"])
    if row["status"] == "ABORTED":
        return _session_summary(conn, row)
    if row["status"] != "RUNNING":
        raise ApiError(409, "SESSION_ALREADY_ENDED", "이미 종료된 주행은 중단할 수 없습니다.")
    with tx(conn):
        conn.execute(
            "UPDATE training_sessions SET status='ABORTED', verification_status='NOT_APPLICABLE', ended_at=?, end_reason=? WHERE id=?",
            (now_iso(), body.reason, session_id),
        )
    return _session_summary(conn, conn.execute("SELECT * FROM training_sessions WHERE id=?", (session_id,)).fetchone())


@app.get("/api/v1/training/sessions")
def list_sessions(limit: int = Query(20, ge=1, le=50), user=Depends(current_user), conn=Depends(get_db)):
    rows = conn.execute(
        "SELECT * FROM training_sessions WHERE user_id=? ORDER BY started_at DESC LIMIT ?", (user["id"], limit)
    ).fetchall()
    return {"items": [_session_summary(conn, r) | {"reference_deduction": r["reference_deduction"]} for r in rows]}


@app.get("/api/v1/training/sessions/{session_id}")
def session_detail(session_id: str, user=Depends(current_user), conn=Depends(get_db)):
    row = _owned_session(conn, session_id, user["id"])
    out = _training_result(conn, row)
    if row["input_log"]:
        out["replay"] = {"inputs": jloads(row["input_log"]), "total_ticks": row["total_ticks"]}
    return out


# ---------------- AI ----------------
AI_ERROR_MESSAGES = {
    "LLM_NOT_CONFIGURED": "AI가 연결되지 않았습니다(서버 .env 의 LLM_API_KEY 미설정).",
    "LLM_TIMEOUT": "AI 응답 시간이 초과되었습니다.",
    "LLM_AUTH_FAILED": "AI 인증에 실패했습니다. API 키를 확인해 주세요.",
    "LLM_RATE_LIMITED": "AI 호출 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.",
    "LLM_NETWORK_ERROR": "AI 서버에 연결하지 못했습니다.",
    "LLM_BAD_RESPONSE": "AI 응답을 해석하지 못했습니다.",
    "AI_OUTPUT_INVALID": "AI 응답이 근거 검증을 통과하지 못해 표시하지 않습니다.",
}


class AiJobIn(BaseModel):
    kind: Literal["EXPLANATION", "REPORT"]
    answer_id: str | None = None


def _ai_job_out(conn, row) -> dict:
    cites = conn.execute(
        "SELECT ac.chunk_id, ac.claim_key, sc.locator, sc.content, os.title, os.url FROM ai_citations ac JOIN source_chunks sc ON sc.id=ac.chunk_id "
        "JOIN official_sources os ON os.id=sc.source_id WHERE ac.job_id=?",
        (row["id"],),
    ).fetchall()
    code = row["error_code"]
    msg = None
    if code:
        msg = AI_ERROR_MESSAGES.get(code) or AI_ERROR_MESSAGES.get(code.split(":")[0]) or ("AI 호출에 실패했습니다." if code.startswith("LLM_HTTP") else code)
    return {
        "id": row["id"],
        "kind": row["kind"],
        "answer_id": row["answer_id"],
        "status": row["status"],
        "result": jloads(row["result"]),
        "model_version": row["model_version"],
        "prompt_version": row["prompt_version"],
        "error_code": code,
        "error_message": msg,
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
        "citations": [
            {"chunk_id": c["chunk_id"], "claim_key": c["claim_key"], "locator": c["locator"], "content": c["content"], "source_title": c["title"], "source_url": c["url"]}
            for c in cites
        ],
    }


def _explanation_snapshot(conn, user_id: str, answer_id: str) -> dict:
    review = answer_review(answer_id, user={"id": user_id}, conn=conn)  # 소유권·제출 여부 검사 포함
    q = review["question"]
    pos = {o["id"]: o["position"] for o in q["options"]}
    return {
        "question": q["prompt"],
        "options": [{"number": o["position"], "text": o["content"]} for o in q["options"]],
        "correct_options": sorted(pos[i] for i in review["correct_option_ids"]),
        "selected_options": sorted(pos[i] for i in review["selected_option_ids"]),
        "is_correct": review["is_correct"],
        "category": q["category"]["name"],
        "explanation": q["explanation"],
        "evidence": [{"id": review["evidence"]["chunk_id"], "locator": review["evidence"]["locator"], "content": review["evidence"]["content"]}],
    }


def run_ai_job(job_id: str) -> None:
    conn = connect()
    try:
        job = conn.execute("SELECT * FROM ai_jobs WHERE id=?", (job_id,)).fetchone()
        if not job or job["status"] != "QUEUED":
            return
        conn.execute("UPDATE ai_jobs SET status='RUNNING' WHERE id=?", (job_id,))
        snap = jloads(job["evidence_snapshot"])
        status, result, model, error, cites = "FAILED", None, None, None, []
        if job["kind"] == "EXPLANATION":
            allowed = {e["id"] for e in snap["evidence"]}
            try:
                out, model = llm.chat_json(llm.EXPLANATION_SYSTEM, snap)
                try:
                    result = llm.validate_explanation(out, allowed)
                except ValueError as exc:
                    out, model = llm.chat_json(llm.EXPLANATION_SYSTEM, {**snap, "previous_error": str(exc)})
                    result = llm.validate_explanation(out, allowed)
                status = "SUCCEEDED"
                cites = [(c, "explanation") for c in result["citation_chunk_ids"]]
            except llm.LlmUnavailable as exc:
                error = exc.code
            except ValueError:
                error = "AI_OUTPUT_INVALID"
                result = None
        else:
            stats = snap
            if not stats["sufficient"]:
                status, result = "INSUFFICIENT_DATA", {"stats": stats, "narrative": rule_based_narrative(stats), "narrative_source": "rule"}
            else:
                payload = {k: stats[k] for k in ("written", "driving", "evidence_ids", "allowed_refs", "recommended_question_counts", "unmeasured")}
                try:
                    out, model = llm.chat_json(llm.REPORT_SYSTEM, payload)
                    try:
                        narrative = llm.validate_report(out, stats)
                    except ValueError as exc:
                        out, model = llm.chat_json(llm.REPORT_SYSTEM, {**payload, "previous_error": str(exc)})
                        narrative = llm.validate_report(out, stats)
                    status, result = "SUCCEEDED", {"stats": stats, "narrative": narrative, "narrative_source": "llm"}
                except (llm.LlmUnavailable, ValueError) as exc:
                    error = exc.code if isinstance(exc, llm.LlmUnavailable) else "AI_OUTPUT_INVALID"
                    status, result = "FALLBACK", {"stats": stats, "narrative": rule_based_narrative(stats), "narrative_source": "rule"}
        with tx(conn):
            conn.execute(
                "UPDATE ai_jobs SET status=?, result=?, model_version=?, error_code=?, finished_at=? WHERE id=?",
                (status, jdumps(result) if result is not None else None, model, error, now_iso(), job_id),
            )
            for chunk_id, claim in cites:
                conn.execute("INSERT OR IGNORE INTO ai_citations(id,job_id,chunk_id,claim_key) VALUES(?,?,?,?)", (new_id(), job_id, chunk_id, claim))
    except Exception:  # 예기치 못한 오류도 작업 상태로 남긴다
        conn.execute("UPDATE ai_jobs SET status='FAILED', error_code='INTERNAL_ERROR', finished_at=? WHERE id=?", (now_iso(), job_id))
    finally:
        conn.close()


@app.post("/api/v1/ai/jobs", status_code=202, dependencies=[Depends(csrf_guard)])
def create_ai_job(
    body: AiJobIn,
    background: BackgroundTasks,
    user=Depends(current_user),
    conn=Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    route = "POST /ai/jobs"
    replayed = idem_replay(conn, user["id"], route, idempotency_key, body.model_dump())
    if replayed:
        return replayed
    if body.kind == "EXPLANATION":
        if not body.answer_id:
            raise ApiError(400, "ANSWER_ID_REQUIRED", "해설 요청에는 answer_id 가 필요합니다.")
        snapshot = _explanation_snapshot(conn, user["id"], body.answer_id)
        version = llm.EXPLANATION_PROMPT_VERSION
    else:
        if body.answer_id:
            raise ApiError(400, "UNEXPECTED_FIELD", "보고서 요청에는 answer_id 를 보내지 않습니다.")
        snapshot = build_stats(conn, user["id"])
        version = llm.REPORT_PROMPT_VERSION
    running = conn.execute(
        "SELECT * FROM ai_jobs WHERE user_id=? AND kind=? AND answer_id IS ? AND status IN ('QUEUED','RUNNING')",
        (user["id"], body.kind, body.answer_id),
    ).fetchone()
    if running:
        return JSONResponse(_ai_job_out(conn, running), status_code=202)
    jid = new_id()
    with tx(conn):
        conn.execute(
            "INSERT INTO ai_jobs(id,user_id,kind,answer_id,status,evidence_snapshot,prompt_version,created_at) VALUES(?,?,?,?,'QUEUED',?,?,?)",
            (jid, user["id"], body.kind, body.answer_id, jdumps(snapshot), version, now_iso()),
        )
        out = _ai_job_out(conn, conn.execute("SELECT * FROM ai_jobs WHERE id=?", (jid,)).fetchone())
        idem_store(conn, user["id"], route, idempotency_key, body.model_dump(), 202, out)
    background.add_task(run_ai_job, jid)
    return JSONResponse(out, status_code=202)


@app.get("/api/v1/ai/jobs")
def list_ai_jobs(
    kind: Literal["EXPLANATION", "REPORT"] | None = None,
    limit: int = Query(10, ge=1, le=50),
    user=Depends(current_user),
    conn=Depends(get_db),
):
    q = "SELECT * FROM ai_jobs WHERE user_id=?"
    params: list = [user["id"]]
    if kind:
        q += " AND kind=?"
        params.append(kind)
    rows = conn.execute(q + " ORDER BY created_at DESC LIMIT ?", [*params, limit]).fetchall()
    return {"items": [_ai_job_out(conn, r) for r in rows]}


@app.get("/api/v1/ai/jobs/{job_id}")
def get_ai_job(job_id: str, user=Depends(current_user), conn=Depends(get_db)):
    row = conn.execute("SELECT * FROM ai_jobs WHERE id=? AND user_id=?", (job_id, user["id"])).fetchone()
    if not row:
        raise ApiError(404, "AI_JOB_NOT_FOUND", "AI 작업을 찾을 수 없습니다.")
    return _ai_job_out(conn, row)
