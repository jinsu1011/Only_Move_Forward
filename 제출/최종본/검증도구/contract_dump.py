"""실제 FastAPI 앱을 임시 DB로 띄워 모든 동작의 응답을 수집한다(명세 대조용)."""
import json, os, sys, tempfile, uuid
from pathlib import Path

BE = Path(sys.argv[1])
OUT = Path(sys.argv[2])
os.environ["LF_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "contract.db")
os.environ["LLM_API_KEY"] = ""
sys.path.insert(0, str(BE))
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

rec = []
def call(c, method, tpl, path, status, **kw):
    r = c.request(method, "/api/v1" + path, **kw)
    body = None if r.status_code == 204 else r.json()
    rec.append({"method": method.lower(), "path": tpl, "status": r.status_code, "expected": status, "body": body})
    assert r.status_code == status, (method, path, r.status_code, r.text[:300])
    return body

O = {"origin": "http://localhost:5180"}
with TestClient(app) as c:
    call(c, "GET", "/health", "/health", 200)
    anon = TestClient(app)
    call(anon, "POST", "/auth/login", "/auth/login", 403, json={"email": "a@b.co", "password": "x"})
    tok = call(c, "GET", "/auth/csrf", "/auth/csrf", 200)["csrf_token"]
    c.headers.update({"x-csrf-token": tok, **O})
    call(c, "GET", "/me", "/me", 401)
    call(c, "POST", "/auth/signup", "/auth/signup", 400, json={"email": "bad", "password": "short", "nickname": "a", "license_type": "CLASS1_ORDINARY"})
    call(c, "POST", "/auth/signup", "/auth/signup", 201, json={"email": "learner@example.com", "password": "drive2026", "nickname": "초보운전", "license_type": "CLASS2_ORDINARY"})
    c.headers["x-csrf-token"] = c.cookies.get("lf_csrf")
    call(c, "POST", "/auth/signup", "/auth/signup", 409, json={"email": "learner@example.com", "password": "drive2026", "nickname": "중복", "license_type": "CLASS2_ORDINARY"})
    call(c, "POST", "/auth/login", "/auth/login", 401, json={"email": "learner@example.com", "password": "wrong2026"})
    call(c, "POST", "/auth/login", "/auth/login", 200, json={"email": "learner@example.com", "password": "drive2026"})
    c.headers["x-csrf-token"] = c.cookies.get("lf_csrf")
    call(c, "GET", "/me", "/me", 200)
    call(c, "GET", "/guide", "/guide", 200)
    call(c, "GET", "/dashboard", "/dashboard", 200)
    call(c, "GET", "/written/catalog", "/written/catalog", 200)
    key = str(uuid.uuid4())
    att = call(c, "POST", "/written/attempts", "/written/attempts", 201, json={"question_count": 6}, headers={"Idempotency-Key": key})
    call(c, "POST", "/written/attempts", "/written/attempts", 201, json={"question_count": 6}, headers={"Idempotency-Key": key})
    call(c, "POST", "/written/attempts", "/written/attempts", 409, json={"question_count": 7}, headers={"Idempotency-Key": key})
    aid = att["id"]
    call(c, "GET", "/written/attempts/{attemptId}", f"/written/attempts/{aid}", 200)
    call(c, "GET", "/written/attempts/{attemptId}", f"/written/attempts/{uuid.uuid4()}", 404)
    for q in att["questions"]:
        call(c, "PUT", "/written/attempts/{attemptId}/answers/{questionId}", f"/written/attempts/{aid}/answers/{q['question_id']}", 200, json={"option_ids": [q["options"][0]["id"]]})
    call(c, "GET", "/written/attempts/{attemptId}/result", f"/written/attempts/{aid}/result", 409)
    res = call(c, "POST", "/written/attempts/{attemptId}/submit", f"/written/attempts/{aid}/submit", 200)
    q0 = att["questions"][0]
    call(c, "PUT", "/written/attempts/{attemptId}/answers/{questionId}", f"/written/attempts/{aid}/answers/{q0['question_id']}", 409, json={"option_ids": []})
    call(c, "GET", "/written/attempts/{attemptId}/result", f"/written/attempts/{aid}/result", 200)
    call(c, "GET", "/written/attempts", "/written/attempts", 200)
    ans = res["items"][0]["answer_id"]
    call(c, "GET", "/written/answers/{answerId}", f"/written/answers/{ans}", 200)

    items = call(c, "GET", "/scenarios", "/scenarios", 200)["items"]
    road = next(s for s in items if s["kind"] == "ROAD")
    # 코스 정의 스키마를 코스 종류마다 검증하도록 모든 코스 상세를 호출한다(기본조작·장내기능·도로주행).
    for sc in items:
        call(c, "GET", "/scenarios/{scenarioId}", f"/scenarios/{sc['id']}", 200)
    call(c, "GET", "/scenarios/{scenarioId}", f"/scenarios/{uuid.uuid4()}", 404)
    call(c, "GET", "/scoring-rules", "/scoring-rules", 200)
    call(c, "POST", "/training/sessions", "/training/sessions", 400, json={"scenario_id": road["id"], "input_mode": "SENSOR"})
    calib = {"center_deg": 1.8, "invert": False, "enter_deg": 15, "exit_deg": 8, "smoothing_ms": 150, "dwell_ms": 120, "stable_spread_deg": 1.2,
             "left_confirmed": True, "right_confirmed": True, "sample_hz": 50, "firmware_format": "WME", "steering_axis": "ROLL"}
    s1 = call(c, "POST", "/training/sessions", "/training/sessions", 201, json={"scenario_id": road["id"], "input_mode": "SENSOR", "calibration": calib})
    call(c, "POST", "/training/sessions/{sessionId}/abort", f"/training/sessions/{s1['id']}/abort", 200, json={"reason": "SENSOR_LOST"})
    s2 = call(c, "POST", "/training/sessions", "/training/sessions", 201, json={"scenario_id": road["id"], "input_mode": "KEYBOARD"})
    call(c, "POST", "/training/sessions/{sessionId}/complete", f"/training/sessions/{s2['id']}/complete", 400, json={"total_ticks": 10, "inputs": [[0, 5, 0]], "end_reason": "USER_END"})
    call(c, "POST", "/training/sessions/{sessionId}/complete", f"/training/sessions/{s2['id']}/complete", 200,
         json={"total_ticks": 900, "inputs": [[0, 1, 0], [300, 1, 1], [420, 0, 0]], "client_events": [], "end_reason": "USER_END", "pause_count": 1})
    call(c, "POST", "/training/sessions/{sessionId}/abort", f"/training/sessions/{s2['id']}/abort", 409, json={"reason": "USER_EXIT"})
    call(c, "GET", "/training/sessions/{sessionId}", f"/training/sessions/{s2['id']}", 200)
    call(c, "GET", "/training/sessions/{sessionId}", f"/training/sessions/{uuid.uuid4()}", 404)
    call(c, "GET", "/training/sessions", "/training/sessions", 200)

    call(c, "POST", "/ai/jobs", "/ai/jobs", 400, json={"kind": "EXPLANATION"})
    j1 = call(c, "POST", "/ai/jobs", "/ai/jobs", 202, json={"kind": "EXPLANATION", "answer_id": ans})
    call(c, "GET", "/ai/jobs/{jobId}", f"/ai/jobs/{j1['id']}", 200)
    j2 = call(c, "POST", "/ai/jobs", "/ai/jobs", 202, json={"kind": "REPORT"})
    call(c, "GET", "/ai/jobs/{jobId}", f"/ai/jobs/{j2['id']}", 200)
    call(c, "GET", "/ai/jobs", "/ai/jobs", 200)
    call(c, "GET", "/written/answers/{answerId}", f"/written/answers/{ans}", 200)
    call(c, "GET", "/dashboard", "/dashboard", 200)
    call(c, "POST", "/auth/logout", "/auth/logout", 204)

OUT.write_text(json.dumps(rec, ensure_ascii=False, indent=1))
print("recorded", len(rec), "calls;", "statuses", sorted({r["status"] for r in rec}))
