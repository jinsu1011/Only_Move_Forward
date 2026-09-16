import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.seed import _road_course
from autodrive import drive

ORIGIN = {"origin": "http://localhost:5180"}


def make_client():
    c = TestClient(app)
    c.__enter__()
    token = c.get("/api/v1/auth/csrf").json()["csrf_token"]
    c.headers.update({"x-csrf-token": token, **ORIGIN})
    return c


def signup(c, email, nickname="테스터"):
    r = c.post("/api/v1/auth/signup", json={"email": email, "password": "drive1234", "nickname": nickname, "license_type": "CLASS2_ORDINARY"})
    assert r.status_code == 201, r.text
    c.headers["x-csrf-token"] = c.cookies.get("lf_csrf")
    return r.json()


@pytest.fixture(scope="module")
def alice():
    c = make_client()
    signup(c, "alice@example.com", "앨리스")
    return c


def test_csrf_and_origin_required():
    c = TestClient(app)
    c.__enter__()
    r = c.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "a"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "CSRF_FAILED"
    token = c.get("/api/v1/auth/csrf").json()["csrf_token"]
    r = c.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "a"}, headers={"x-csrf-token": token, "origin": "https://evil.example"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "ORIGIN_REJECTED"


def test_auth_flow_and_errors(alice):
    assert alice.get("/api/v1/me").json()["nickname"] == "앨리스"
    c = make_client()
    assert c.get("/api/v1/me").status_code == 401
    r = c.post("/api/v1/auth/signup", json={"email": "alice@example.com", "password": "drive1234", "nickname": "중복", "license_type": "CLASS1_ORDINARY"})
    assert r.status_code == 409
    r = c.post("/api/v1/auth/signup", json={"email": "bad", "password": "short", "nickname": "a", "license_type": "CLASS1_ORDINARY"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    r = c.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "wrong1234"})
    assert r.status_code == 401
    r = c.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "drive1234"})
    assert r.status_code == 200
    assert "password_hash" not in r.json()


def test_written_flow_hides_answers_until_submit(alice):
    key = "attempt-key-0001"
    body = {"mode": "PRACTICE", "category_ids": ["SIGNAL", "SPEED"], "question_count": 5}
    r1 = alice.post("/api/v1/written/attempts", json=body, headers={"Idempotency-Key": key})
    r2 = alice.post("/api/v1/written/attempts", json=body, headers={"Idempotency-Key": key})
    assert r1.status_code == 201 and r2.status_code == 201 and r1.json()["id"] == r2.json()["id"]
    r3 = alice.post("/api/v1/written/attempts", json={**body, "question_count": 6}, headers={"Idempotency-Key": key})
    assert r3.status_code == 409
    att = r1.json()
    assert all("is_correct" not in o for q in att["questions"] for o in q["options"])
    q0 = att["questions"][0]
    q1 = att["questions"][1]
    bad = alice.put(f"/api/v1/written/attempts/{att['id']}/answers/{q0['question_id']}", json={"option_ids": [q1["options"][0]["id"]]})
    assert bad.status_code == 400
    ok = alice.put(f"/api/v1/written/attempts/{att['id']}/answers/{q0['question_id']}", json={"option_ids": [q0["options"][0]["id"]]})
    assert ok.status_code == 200
    assert alice.get(f"/api/v1/written/attempts/{att['id']}/result").status_code == 409
    res = alice.post(f"/api/v1/written/attempts/{att['id']}/submit").json()
    assert res["question_count"] == 5 and res["outcome"] == "PRACTICE_NO_PASS_JUDGEMENT"
    again = alice.post(f"/api/v1/written/attempts/{att['id']}/submit").json()
    assert again["score"] == res["score"]
    review = alice.get(f"/api/v1/written/answers/{res['items'][0]['answer_id']}").json()
    assert review["correct_option_ids"] and "is_correct" in review["question"]["options"][0]
    assert alice.put(f"/api/v1/written/attempts/{att['id']}/answers/{q0['question_id']}", json={"option_ids": []}).status_code == 409

    bob = make_client()
    signup(bob, "bob@example.com", "바비")
    assert bob.get(f"/api/v1/written/attempts/{att['id']}").status_code == 404
    assert bob.get(f"/api/v1/written/answers/{res['items'][0]['answer_id']}").status_code == 404


def test_training_replay_verification(alice):
    scen = next(s for s in alice.get("/api/v1/scenarios").json()["items"] if s["code"] == "ROAD_CITY_A")
    assert alice.post("/api/v1/training/sessions", json={"scenario_id": scen["id"], "input_mode": "SENSOR"}).status_code == 400
    calib = {"center_deg": -3.2, "invert": False, "enter_deg": 12, "exit_deg": 7, "stable_spread_deg": 1.1, "left_confirmed": True, "right_confirmed": True, "firmware_format": "WME", "steering_axis": "ROLL"}
    s = alice.post("/api/v1/training/sessions", json={"scenario_id": scen["id"], "input_mode": "SENSOR", "calibration": calib})
    assert s.status_code == 201, s.text
    sid = s.json()["id"]
    sim, inputs = drive(_road_course())
    body = {"total_ticks": sim.tick, "inputs": inputs, "client_events": [{"code": e["code"], "tick": e["tick"]} for e in sim.events], "end_reason": "TERMINAL_EVENT"}
    r = alice.post(f"/api/v1/training/sessions/{sid}/complete", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "COMPLETED" and out["verification_status"] == "VERIFIED" and out["official_scoring"] is False
    assert alice.post(f"/api/v1/training/sessions/{sid}/complete", json=body).status_code == 200
    assert alice.post(f"/api/v1/training/sessions/{sid}/complete", json={**body, "inputs": inputs[:-1]}).status_code == 409

    # 조작된 사건 목록 → MISMATCH (서버 재생 결과가 기준)
    s2 = alice.post("/api/v1/training/sessions", json={"scenario_id": scen["id"], "input_mode": "KEYBOARD"}).json()
    r2 = alice.post(f"/api/v1/training/sessions/{s2['id']}/complete", json={**body, "client_events": []}).json()
    assert r2["verification_status"] == "MISMATCH" and r2["status"] == "COMPLETED"

    s3 = alice.post("/api/v1/training/sessions", json={"scenario_id": scen["id"], "input_mode": "KEYBOARD"}).json()
    assert alice.post(f"/api/v1/training/sessions/{s3['id']}/abort", json={"reason": "RESTART"}).json()["status"] == "ABORTED"
    assert alice.post(f"/api/v1/training/sessions/{s3['id']}/complete", json=body).status_code == 409


def test_ai_jobs_without_key_fall_back(alice):
    answers = alice.get("/api/v1/written/attempts").json()["items"]
    att = next(a for a in answers if a["status"] == "SUBMITTED")
    res = alice.get(f"/api/v1/written/attempts/{att['id']}/result").json()
    j = alice.post("/api/v1/ai/jobs", json={"kind": "EXPLANATION", "answer_id": res["items"][0]["answer_id"]})
    assert j.status_code == 202
    for _ in range(20):
        job = alice.get(f"/api/v1/ai/jobs/{j.json()['id']}").json()
        if job["status"] not in ("QUEUED", "RUNNING"):
            break
        time.sleep(0.05)
    assert job["status"] == "FAILED" and job["error_code"] == "LLM_NOT_CONFIGURED"

    rep = alice.post("/api/v1/ai/jobs", json={"kind": "REPORT"}).json()
    for _ in range(20):
        job = alice.get(f"/api/v1/ai/jobs/{rep['id']}").json()
        if job["status"] not in ("QUEUED", "RUNNING"):
            break
        time.sleep(0.05)
    assert job["status"] == "FALLBACK"
    stats = job["result"]["stats"]
    assert stats["written"]["total_answers"] >= 5 and stats["driving"]["total_sessions"] >= 1
    assert alice.post("/api/v1/ai/jobs", json={"kind": "REPORT", "answer_id": "x"}).status_code == 400


def test_report_number_validation_rejects_invented_numbers():
    from app.llm import validate_report

    stats = {"evidence_ids": ["CAT:SIGNAL"], "allowed_refs": ["SIGNAL"], "written": {"categories": [{"accuracy_pct": 40, "correct": 2, "total": 5}]}}
    good = {"headline": "신호 정답률 40%", "summary": "5문항 중 2문항 정답", "focus_areas": [{"title": "신호", "reason": "정답 2/5", "evidence_ids": ["CAT:SIGNAL"]}], "next_steps": [{"title": "신호 연습", "detail": "다시 풀기", "target": "WRITTEN", "ref": "SIGNAL"}]}
    assert validate_report(good, stats)["headline"]
    bad = {**good, "summary": "반응 시간이 0.8초 늦습니다"}
    with pytest.raises(ValueError):
        validate_report(bad, stats)


def test_complete_accepts_zero_tick_run(alice):
    # 카운트다운 도중 Esc 로 나가거나 창 포커스를 잃고 나가면 한 틱도 안 지난 채 종료된다.
    # 이걸 400 으로 막으면 프런트가 "다시 저장" 화면에서 빠져나오지 못한다. 미완료로 남아야 한다.
    scen = next(s for s in alice.get("/api/v1/scenarios").json()["items"] if s["code"] == "FUNCTION_EXAM_A")
    sid = alice.post("/api/v1/training/sessions", json={"scenario_id": scen["id"], "input_mode": "KEYBOARD"}).json()["id"]
    r = alice.post(
        f"/api/v1/training/sessions/{sid}/complete",
        json={"total_ticks": 0, "inputs": [], "client_events": [], "end_reason": "USER_END"},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "INCOMPLETE"
    assert out["total_ticks"] == 0
    assert out["events"] == []
