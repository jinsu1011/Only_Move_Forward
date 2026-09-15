"""통합 취약점 통계(서버 계산)와 규칙 기반 추천. AI 가 없어도 이 결과는 항상 제공된다."""
from __future__ import annotations

from .db import jloads

EVENT_LABELS = {
    "SIGNAL_RED": "적색 신호에 정지선 통과",
    "CROSSWALK_OVERRUN": "적색 신호 정지 시 정지선 넘어 횡단보도 침범",
    "CROSSWALK_NO_STOP": "어린이보호구역 신호 없는 횡단보도 앞 일시정지 안 함",
    "PEDESTRIAN_CONFLICT": "보행자 횡단 중 횡단보도 진입",
    "SCHOOL_ZONE_SPEEDING": "어린이보호구역 제한속도(30km/h) 초과",
    "SPEEDING": "지정 최고속도 10km/h 초과",
    "CENTER_LINE": "중앙선 침범",
    "LANE_KEEP": "차로를 벗어난 채 1초 이상 주행",
    "OFF_ROAD": "도로 이탈",
    "START_DELAY": "출발 후 20초 동안 출발하지 않음",
    "STAGE_CLEAR": "과제 구간 통과",
    "COURSE_COMPLETE": "코스 완주",
    "TIME_LIMIT": "제한 시간 초과",
}

EVENT_TIPS = {
    "SIGNAL_RED": "교차로 50m 전부터 신호를 확인하고, 황색으로 바뀌면 정지선 앞에서 멈출 수 있는 속도로 접근하세요.",
    "CROSSWALK_OVERRUN": "정지할 때 차 앞부분이 정지선을 넘지 않도록 조금 일찍 감속을 시작하세요.",
    "CROSSWALK_NO_STOP": "어린이보호구역의 신호 없는 횡단보도 앞에서는 보행자가 없어도 완전히 멈춘 뒤 출발하세요.",
    "PEDESTRIAN_CONFLICT": "횡단보도에 보행자가 있으면 보행자가 모두 건널 때까지 정지선 앞에서 기다리세요.",
    "SCHOOL_ZONE_SPEEDING": "보호구역 표지를 보면 진입 전에 30km/h 이하로 미리 줄이세요.",
    "SPEEDING": "속도계를 수시로 확인하고 제한속도 표지 구간마다 속도를 다시 맞추세요.",
    "CENTER_LINE": "곡선 구간 진입 전에 속도를 줄이고 조향을 일찍, 부드럽게 시작하세요.",
    "LANE_KEEP": "조향을 크게 한 번 꺾기보다 짧게 여러 번 나누어 차로 중앙을 유지해 보세요.",
    "OFF_ROAD": "속도를 낮추고 곡선 안쪽을 보며 조향 입력 시간을 늘려 보세요.",
    "START_DELAY": "출발 준비가 끝나면 주변을 확인한 뒤 바로 출발하는 연습을 하세요.",
}

UNMEASURED = ["거울·사각지대 확인", "방향지시등 조작", "시선 처리", "반응 시간", "좌석안전띠·기어·주차브레이크 조작"]


def build_stats(conn, user_id: str) -> dict:
    attempts = conn.execute(
        "SELECT id, submitted_at, correct_count, question_count, score, max_score FROM written_attempts "
        "WHERE user_id=? AND status='SUBMITTED' ORDER BY submitted_at DESC LIMIT 10",
        (user_id,),
    ).fetchall()
    attempt_ids = [a["id"] for a in attempts]
    cat_rows = []
    if attempt_ids:
        marks = ",".join("?" * len(attempt_ids))
        cat_rows = conn.execute(
            f"SELECT c.id, c.name_ko, SUM(wa.is_correct) AS correct, COUNT(*) AS total "
            f"FROM written_answers wa JOIN attempt_questions aq ON aq.id=wa.attempt_question_id "
            f"JOIN questions q ON q.id=aq.question_id JOIN categories c ON c.id=q.category_id "
            f"WHERE aq.attempt_id IN ({marks}) GROUP BY c.id ORDER BY c.sort_order",
            attempt_ids,
        ).fetchall()
    categories = [
        {
            "id": r["id"],
            "name": r["name_ko"],
            "correct": int(r["correct"] or 0),
            "total": int(r["total"]),
            "accuracy_pct": round(100 * int(r["correct"] or 0) / int(r["total"])),
        }
        for r in cat_rows
    ]
    total_correct = sum(c["correct"] for c in categories)
    total_answers = sum(c["total"] for c in categories)

    sessions = conn.execute(
        "SELECT ts.id, ts.status, ts.ended_at, ts.reference_deduction, s.title, s.code, s.kind FROM training_sessions ts "
        "JOIN scenarios s ON s.id=ts.scenario_id WHERE ts.user_id=? AND ts.status IN ('COMPLETED','DISQUALIFIED','INCOMPLETE') "
        "ORDER BY ts.ended_at DESC LIMIT 10",
        (user_id,),
    ).fetchall()
    session_items = []
    counts: dict[str, int] = {}
    for s in sessions:
        evs = conn.execute(
            "SELECT event_code FROM driving_events WHERE session_id=? ORDER BY seq", (s["id"],)
        ).fetchall()
        codes = [e["event_code"] for e in evs if e["event_code"] not in ("STAGE_CLEAR", "COURSE_COMPLETE")]
        for c in codes:
            counts[c] = counts.get(c, 0) + 1
        session_items.append(
            {"id": s["id"], "scenario": s["title"], "scenario_code": s["code"], "status": s["status"], "events": codes}
        )
    event_counts = [
        {"code": code, "label": EVENT_LABELS.get(code, code), "count": n}
        for code, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    evidence_ids = [f"WA:{a['id']}" for a in attempts] + [f"TS:{s['id']}" for s in session_items]
    evidence_ids += [f"CAT:{c['id']}" for c in categories] + [f"EV:{e['code']}" for e in event_counts]

    weakest = None
    candidates = [c for c in categories if c["total"] >= 3]
    if candidates:
        weakest = min(candidates, key=lambda c: (c["accuracy_pct"], -c["total"]))
    top_issue = event_counts[0] if event_counts else None

    recommendations = []
    if weakest:
        recommendations.append(
            {
                "title": f"{weakest['name']} 집중 연습",
                "detail": f"최근 기록에서 {weakest['name']} 정답 {weakest['correct']}/{weakest['total']}문항으로 가장 낮습니다. 이 주제만 골라 10문항을 풀어 보세요.",
                "target": "WRITTEN",
                "ref": weakest["id"],
                "evidence_ids": [f"CAT:{weakest['id']}"],
            }
        )
    if top_issue:
        scen = next((s["scenario_code"] for s in session_items if top_issue["code"] in s["events"]), "ROAD_CITY_A")
        recommendations.append(
            {
                "title": f"주행: {top_issue['label']}",
                "detail": EVENT_TIPS.get(top_issue["code"], "같은 코스를 다시 주행해 보세요."),
                "target": "DRIVE",
                "ref": scen,
                "evidence_ids": [f"EV:{top_issue['code']}"],
            }
        )
    if not recommendations and session_items:
        recommendations.append(
            {"title": "도로주행 A코스 도전", "detail": "기록된 주행 사건이 없습니다. 어린이보호구역이 포함된 도로 코스로 넘어가 보세요.", "target": "DRIVE", "ref": "ROAD_CITY_A", "evidence_ids": [f"TS:{session_items[0]['id']}"]}
        )

    return {
        "written": {
            "attempts": [
                {"id": a["id"], "submitted_at": a["submitted_at"], "correct": a["correct_count"], "total": a["question_count"]}
                for a in attempts
            ],
            "categories": categories,
            "total_correct": total_correct,
            "total_answers": total_answers,
        },
        "driving": {
            "sessions": session_items,
            "event_counts": event_counts,
            "total_sessions": len(session_items),
            "disqualified_sessions": sum(1 for s in session_items if s["status"] == "DISQUALIFIED"),
            "completed_sessions": sum(1 for s in session_items if s["status"] == "COMPLETED"),
        },
        "evidence_ids": evidence_ids,
        "allowed_refs": [c["id"] for c in categories] + ["FUNCTION_BASIC", "ROAD_CITY_A"],
        "recommended_question_counts": [10, 20],
        "unmeasured": UNMEASURED,
        "rule_based": {
            "weakest_written": weakest,
            "top_driving_issue": top_issue,
            "recommendations": recommendations,
        },
        "sufficient": total_answers >= 5 or len(session_items) >= 1,
    }


def rule_based_narrative(stats: dict) -> dict:
    rb = stats["rule_based"]
    parts = []
    if rb["weakest_written"]:
        w = rb["weakest_written"]
        parts.append(f"필기에서는 {w['name']} 정답률이 {w['accuracy_pct']}%로 가장 낮습니다.")
    if rb["top_driving_issue"]:
        t = rb["top_driving_issue"]
        parts.append(f"주행에서는 '{t['label']}' 사건이 {t['count']}회로 가장 많았습니다.")
    headline = "기록에서 찾은 다음 연습 과제" if parts else "기록이 더 필요합니다"
    return {
        "headline": headline,
        "summary": " ".join(parts) or "필기 5문항 이상 또는 주행 1회 이상 기록이 쌓이면 분석할 수 있습니다.",
        "focus_areas": [
            {"title": r["title"], "reason": r["detail"], "evidence_ids": r["evidence_ids"]} for r in rb["recommendations"]
        ],
        "next_steps": [
            {"title": r["title"], "detail": r["detail"], "target": r["target"], "ref": r["ref"]} for r in rb["recommendations"]
        ],
    }


def session_event_rows(conn, session_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT de.*, r.code AS rule_code, r.name_ko AS rule_name, r.kind AS rule_kind, r.deduction_points, r.support, r.locator "
        "FROM driving_events de LEFT JOIN official_scoring_rules r ON r.id=de.rule_id WHERE de.session_id=? ORDER BY de.seq",
        (session_id,),
    ).fetchall()
    return [
        {
            "seq": r["seq"],
            "code": r["event_code"],
            "label": EVENT_LABELS.get(r["event_code"], r["event_code"]),
            "tick": r["tick"],
            "time_s": round(r["tick"] / 30, 2),
            "s_m": r["s_m"],
            "speed_kmh": r["speed_kmh"],
            "terminal": bool(r["is_terminal"]),
            "category_id": r["category_id"],
            "evidence": jloads(r["evidence"]),
            "rule": (
                {
                    "code": r["rule_code"],
                    "name_ko": r["rule_name"],
                    "kind": r["rule_kind"],
                    "deduction_points": r["deduction_points"],
                    "support": r["support"],
                    "locator": r["locator"],
                }
                if r["rule_code"]
                else None
            ),
        }
        for r in rows
    ]
