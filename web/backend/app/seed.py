"""기준 데이터 적재. 코드+버전 기준으로 한 번만 넣고 기존 버전을 덮어쓰지 않는다."""
from __future__ import annotations

import json
import sqlite3

from . import config
from .db import jdumps, new_id, tx
from .questions import CHUNKS, QUESTIONS
from .sim import SIM_VERSION, build_course, start_pose

RETRIEVED = "2026-09-15"

SOURCES = [
    {
        "key": "LAW",
        "title": "도로교통법·시행령·시행규칙 (국가법령정보센터)",
        "publisher": "법제처",
        "url": "https://www.law.go.kr/법령/도로교통법",
        "version": "조회 2026-09-15",
        "effective_from": None,
        "reuse_terms": "법령은 저작권법 제7조에 따른 비보호 저작물. 조문 요약은 개발자 작성이며 시행 버전 재확인 필요",
        "review_status": "PENDING",
    },
    {
        "key": "APPENDIX26",
        "title": "도로교통법 시행규칙 [별표 26] 운전면허시험(도로주행시험) 채점기준",
        "publisher": "법제처",
        "url": "https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110201&flSeq=161794629",
        "version": "2026-02-24 개정",
        "effective_from": "2026-08-01",
        "reuse_terms": "법령 별표. 원문 PDF 해시 fb58141f… 로컬 보존",
        "review_status": "SELF_REVIEWED",
    },
    {
        "key": "GUIDE",
        "title": "도로교통공단 안전운전 통합민원 — 운전면허 시험 안내",
        "publisher": "도로교통공단",
        "url": "https://www.safedriving.or.kr/dtGuide/selectDtGuide01.do",
        "version": "조회 2026-09-15",
        "effective_from": None,
        "reuse_terms": "공공기관 안내 페이지 요약. 세부 조건은 원문 확인",
        "review_status": "SELF_REVIEWED",
    },
]

GUIDE_STEPS = [
    ("교통안전교육", "응시 전 교통안전교육을 받습니다. 기존 면허 보유 등 면제 대상은 공단 안내를 확인합니다."),
    ("신체검사", "시험장 또는 지정 병원에서 적성(신체)검사를 받습니다. 건강검진 결과 활용 가능 여부는 원문을 확인합니다."),
    ("학과시험", "객관식 40문항, 기본 40분. 1종 보통 70점 이상, 2종 보통 60점 이상 합격."),
    ("기능시험", "시험장 코스에서 장치 조작과 기본 주행 기능을 평가합니다."),
    ("연습운전면허 발급", "학과·기능 합격 후 연습운전면허를 받아 도로주행 연습을 합니다."),
    ("도로주행시험", "1·2종 보통, 57개 평가 항목(감점 46·실격 11), 70점 이상 합격."),
    ("운전면허증 발급", "도로주행 합격 후 운전면허증을 발급받습니다."),
]

CATEGORIES = [
    ("SIGNAL", "WRITTEN", "신호·안전표지", 1),
    ("SPEED", "WRITTEN", "속도·안전거리", 2),
    ("INTERSECTION", "WRITTEN", "교차로·통행방법", 3),
    ("PEDESTRIAN", "WRITTEN", "보행자·어린이 보호", 4),
    ("PARKING", "WRITTEN", "주정차·앞지르기", 5),
    ("LAW", "WRITTEN", "음주·벌점·운전자 의무", 6),
    ("HIGHWAY", "WRITTEN", "고속도로·긴급상황", 7),
    ("DRV_SIGNAL", "DRIVING", "주행 — 신호 준수", 11),
    ("DRV_SPEED", "DRIVING", "주행 — 속도", 12),
    ("DRV_LANE", "DRIVING", "주행 — 차로·진로", 13),
    ("DRV_PEDESTRIAN", "DRIVING", "주행 — 보행자 보호", 14),
    ("DRV_BASIC", "DRIVING", "주행 — 기본 조작", 15),
]

# 사건 → (공식 항목 코드 또는 None, 분류)
EVENT_MAP = {
    "SIGNAL_RED": ("F04", "DRV_SIGNAL"),
    "CROSSWALK_OVERRUN": ("D43", "DRV_PEDESTRIAN"),
    "CROSSWALK_NO_STOP": ("D43", "DRV_PEDESTRIAN"),
    "PEDESTRIAN_CONFLICT": ("F05", "DRV_PEDESTRIAN"),
    "SCHOOL_ZONE_SPEEDING": ("F06", "DRV_SPEED"),
    "SPEEDING": ("F08", "DRV_SPEED"),
    "CENTER_LINE": ("F07", "DRV_LANE"),
    "LANE_KEEP": ("D28", "DRV_LANE"),
    "OFF_ROAD": ("F02", "DRV_LANE"),
    "START_DELAY": ("D05", "DRV_BASIC"),
    "STAGE_CLEAR": (None, "DRV_BASIC"),
    "COURSE_COMPLETE": (None, "DRV_BASIC"),
    "TIME_LIMIT": (None, "DRV_BASIC"),
}
RULE_CATEGORY = {
    "D05": "DRV_BASIC", "D09": "DRV_BASIC", "D15": "DRV_SPEED", "D16": "DRV_SPEED", "D21": "DRV_BASIC",
    "D22": "DRV_BASIC", "D24": "DRV_LANE", "D25": "DRV_LANE", "D26": "DRV_LANE", "D27": "DRV_LANE",
    "D28": "DRV_LANE", "D37": "DRV_SPEED", "D38": "DRV_PEDESTRIAN", "D39": "DRV_SIGNAL", "D40": "DRV_SIGNAL",
    "D41": "DRV_SIGNAL", "D42": "DRV_SIGNAL", "D43": "DRV_PEDESTRIAN", "F02": "DRV_LANE", "F04": "DRV_SIGNAL",
    "F05": "DRV_PEDESTRIAN", "F06": "DRV_SPEED", "F07": "DRV_LANE", "F08": "DRV_SPEED",
}


def _road_course() -> dict:
    geo = build_course(
        (0.0, 0.0),
        0.0,
        [
            {"type": "straight", "length": 150},
            {"type": "arc", "radius": 32, "angle": 90},
            {"type": "straight", "length": 170},
            {"type": "arc", "radius": 32, "angle": 90},
            {"type": "straight", "length": 110},
        ],
    )
    ends = geo["segment_end_s"]
    s3 = ends[1]
    total = geo["length_m"]
    lane = 3.5
    return {
        "kind": "ROAD",
        "sim_version": SIM_VERSION,
        "lane_width": lane,
        "lanes_each_way": 1,
        "time_limit_s": 240,
        **geo,
        "start": start_pose(geo["centerline"], lane / 2),
        "speed_limits": [{"from": 0, "to": total, "limit_kmh": 50}],
        "school_zones": [{"id": "Z1", "from": round(s3 + 25, 2), "to": round(s3 + 140, 2), "limit_kmh": 30}],
        "signals": [
            {
                "id": "L1", "stop_s": 118.0, "crosswalk_from": 119.0, "crosswalk_to": 125.0,
                "intersection_from": 126.0, "intersection_to": 140.0,
                "green": 9, "yellow": 3, "red": 10, "offset": 3,
            }
        ],
        "crosswalks": [
            {"id": "P1", "from": round(s3 + 90, 2), "to": round(s3 + 96, 2), "ped_period": 18, "ped_from": 4, "ped_to": 11}
        ],
        "finish_s": round(total - 4, 2),
        "stages": [],
    }


def _function_course() -> dict:
    geo = build_course(
        (0.0, 0.0),
        0.0,
        [
            {"type": "straight", "length": 55},
            {"type": "arc", "radius": 22, "angle": -40},
            {"type": "arc", "radius": 22, "angle": 40},
            {"type": "straight", "length": 25},
            {"type": "arc", "radius": 22, "angle": 40},
            {"type": "arc", "radius": 22, "angle": -40},
            {"type": "straight", "length": 45},
        ],
    )
    total = geo["length_m"]
    lane = 4.2
    return {
        "kind": "FUNCTION",
        "sim_version": SIM_VERSION,
        "lane_width": lane,
        "lanes_each_way": 1,
        "time_limit_s": 240,
        **geo,
        "start": start_pose(geo["centerline"], lane / 2),
        "speed_limits": [],
        "school_zones": [],
        "signals": [],
        "crosswalks": [],
        "finish_s": round(total - 2, 2),
        "stages": [
            {"type": "STOP_IN", "from": round(total - 16, 2), "to": round(total - 5, 2), "label": "전진 후 정지 구역 정차"},
            {"type": "REVERSE_STOP_IN", "from": round(total - 34, 2), "to": round(total - 24, 2), "label": "후진으로 뒤 구역 정차"},
        ],
    }


def _exam_course() -> dict:
    """장내기능시험을 본뜬 코스. 출발 → 좌회전 → 횡단보도 → 경사로 정지 → 우회전 →
    굴절(S자) → 신호 교차로 → 직각주차(전진 정차 후 후진 진입) → 가속 구간 → 도착 정차.
    과제는 기존 엔진의 STOP_IN·REVERSE_STOP_IN 으로만 표현했다. 공식 기능시험 채점표(별표24)는
    아직 조사·검수 전이라 연결하지 않는다. 그래서 별표26 을 쓰는 ROAD 가 아니라 FUNCTION 이다.
    회전 반경은 자동 주행이 차로를 벗어나지 않는 값으로 맞췄다."""
    geo = build_course(
        (0.0, 0.0),
        0.0,
        [
            {"type": "straight", "length": 38},            # 출발
            {"type": "arc", "radius": 16, "angle": 90},    # 좌회전
            {"type": "straight", "length": 40},            # 횡단보도 · 경사로
            {"type": "arc", "radius": 16, "angle": -90},   # 우회전
            {"type": "arc", "radius": 20, "angle": -35},   # 굴절(S자) 1
            {"type": "arc", "radius": 20, "angle": 35},    # 굴절(S자) 2
            {"type": "arc", "radius": 20, "angle": 35},    # 굴절(S자) 3
            {"type": "arc", "radius": 20, "angle": -35},   # 굴절(S자) 4
            {"type": "straight", "length": 50},            # 신호 교차로
            {"type": "arc", "radius": 15, "angle": -90},   # 주차장 진입
            {"type": "straight", "length": 38},            # 직각주차 구역
            {"type": "arc", "radius": 15, "angle": 90},    # 주차장 탈출
            {"type": "straight", "length": 55},            # 가속 구간 → 도착
        ],
    )
    ends = geo["segment_end_s"]
    total = geo["length_m"]
    ramp_s = ends[1]      # 횡단보도·경사로가 있는 직선의 시작
    cross_s = ends[7]     # 신호 교차로 직선의 시작
    park_s = ends[9]      # 직각주차 구역의 시작
    lane = 4.0
    return {
        "kind": "FUNCTION",
        "sim_version": SIM_VERSION,
        "lane_width": lane,
        "lanes_each_way": 1,
        "time_limit_s": 360,
        **geo,
        "start": start_pose(geo["centerline"], lane / 2),
        "speed_limits": [{"from": 0, "to": total, "limit_kmh": 30}],
        "school_zones": [],
        "signals": [
            {
                "id": "EX1",
                "stop_s": round(cross_s + 14, 2),
                "crosswalk_from": round(cross_s + 15, 2), "crosswalk_to": round(cross_s + 20, 2),
                "intersection_from": round(cross_s + 21, 2), "intersection_to": round(cross_s + 32, 2),
                "green": 10, "yellow": 3, "red": 9, "offset": 2,
            }
        ],
        "crosswalks": [
            {"id": "CW1", "from": round(ramp_s + 6, 2), "to": round(ramp_s + 11, 2),
             "ped_period": 16, "ped_from": 3, "ped_to": 9}
        ],
        # 경사로: 18m 에 걸쳐 1.6m 올라갔다가(약 9%) 같은 길이로 내려온다.
        # 오르막에서 가속을 놓으면 뒤로 밀리므로 정지 과제가 실제로 어렵다.
        "ramps": [
            {"from": round(ramp_s + 14, 2), "to": round(ramp_s + 32, 2), "rise_m": 1.6},
            {"from": round(ramp_s + 32, 2), "to": round(ramp_s + 40, 2), "rise_m": -1.6},
        ],
        "finish_s": round(total - 6, 2),
        "stages": [
            {"type": "STOP_IN", "from": round(ramp_s + 24, 2), "to": round(ramp_s + 32, 2), "label": "경사로에서 정지"},
            {"type": "STOP_IN", "from": round(park_s + 26, 2), "to": round(park_s + 36, 2), "label": "주차 구역 지나 정차"},
            {"type": "REVERSE_STOP_IN", "from": round(park_s + 6, 2), "to": round(park_s + 18, 2), "label": "직각주차 구역에 후진 주차"},
        ],
    }


SCENARIOS = [
    {
        "code": "FUNCTION_BASIC",
        "version": "1.1.0",
        "kind": "FUNCTION",
        "title": "기본조작 연습장",
        "summary": "직선·S자 구간을 전진으로 통과해 정지 구역에 멈춘 뒤, 후진으로 뒤 구역에 다시 멈춥니다. 조향·전진·후진·정지 감각을 익힙니다.",
        "build": _function_course,
    },
    {
        "code": "FUNCTION_EXAM_A",
        "version": "1.2.0",
        "kind": "FUNCTION",
        "title": "장내기능 코스",
        "summary": "출발해서 좌회전하고, 횡단보도를 지나 경사로에서 한 번 멈춥니다. 우회전 뒤 굴절 구간을 통과하고 신호 교차로를 지나, 직각주차 구역에 후진으로 넣습니다. 빠져나와 가속 구간을 지나 도착 지점에 정차합니다.",
        "build": _exam_course,
    },
    {
        "code": "ROAD_CITY_A",
        "version": "1.1.0",
        "kind": "ROAD",
        "title": "도심 도로주행 A코스",
        "summary": "신호 교차로, 좌회전 곡선, 어린이보호구역(시속 30km)과 신호 없는 횡단보도를 지나 도착 지점에 정차합니다.",
        "build": _road_course,
    },
]


def seed(conn: sqlite3.Connection) -> None:
    with tx(conn):
        source_ids: dict[str, str] = {}
        for src in SOURCES:
            row = conn.execute("SELECT id FROM official_sources WHERE url=? AND version=?", (src["url"], src["version"])).fetchone()
            if row:
                source_ids[src["key"]] = row["id"]
                continue
            sid = new_id()
            source_ids[src["key"]] = sid
            conn.execute(
                "INSERT INTO official_sources(id,title,publisher,url,version,effective_from,retrieved_at,reuse_terms,review_status) VALUES(?,?,?,?,?,?,?,?,?)",
                (sid, src["title"], src["publisher"], src["url"], src["version"], src["effective_from"], RETRIEVED, src["reuse_terms"], src["review_status"]),
            )

        for cid, domain, name, order in CATEGORIES:
            conn.execute(
                "INSERT OR IGNORE INTO categories(id,domain,name_ko,sort_order) VALUES(?,?,?,?)", (cid, domain, name, order)
            )

        if not conn.execute("SELECT 1 FROM guide_steps LIMIT 1").fetchone():
            for i, (title, content) in enumerate(GUIDE_STEPS, start=1):
                conn.execute(
                    "INSERT INTO guide_steps(id,source_id,step_order,title,content) VALUES(?,?,?,?,?)",
                    (new_id(), source_ids["GUIDE"], i, title, content),
                )

        chunk_ids: dict[str, str] = {}
        for locator, content in CHUNKS.items():
            row = conn.execute(
                "SELECT id FROM source_chunks WHERE source_id=? AND locator=?", (source_ids["LAW"], locator)
            ).fetchone()
            if row:
                chunk_ids[locator] = row["id"]
                continue
            cid = new_id()
            chunk_ids[locator] = cid
            conn.execute(
                "INSERT INTO source_chunks(id,source_id,locator,content) VALUES(?,?,?,?)",
                (cid, source_ids["LAW"], locator, content),
            )

        for q in QUESTIONS:
            if conn.execute("SELECT 1 FROM questions WHERE code=? AND version=1", (q["code"],)).fetchone():
                continue
            qid = new_id()
            conn.execute(
                "INSERT INTO questions(id,source_id,chunk_id,category_id,code,version,kind,license_scope,prompt,media_url,points,required_selections,explanation,review_status) "
                "VALUES(?,?,?,?,?,1,'PRACTICE','ALL',?,NULL,?,?,?,'SELF_REVIEWED')",
                (qid, source_ids["LAW"], chunk_ids[q["locator"]], q["category"], q["code"], q["prompt"], 2 if len(q["correct"]) == 1 else 3, len(q["correct"]), q["explanation"]),
            )
            for pos, text in enumerate(q["options"], start=1):
                conn.execute(
                    "INSERT INTO question_options(id,question_id,position,content,is_correct) VALUES(?,?,?,?,?)",
                    (new_id(), qid, pos, text, 1 if pos in q["correct"] else 0),
                )

        rule_ids: dict[str, str] = {}
        rules = json.loads(config.RULES_JSON.read_text(encoding="utf-8"))
        for r in rules:
            row = conn.execute(
                "SELECT id FROM official_scoring_rules WHERE source_id=? AND code=?", (source_ids["APPENDIX26"], r["code"])
            ).fetchone()
            if row:
                rule_ids[r["code"]] = row["id"]
                continue
            rid = new_id()
            rule_ids[r["code"]] = rid
            conn.execute(
                "INSERT INTO official_scoring_rules(id,source_id,category_id,code,name_ko,kind,deduction_points,support,method,limitations,locator,auto_scoring_enabled) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,0)",
                (
                    rid, source_ids["APPENDIX26"], RULE_CATEGORY.get(r["code"]), r["code"], r["name_ko"],
                    "DISQUALIFICATION" if r["is_disqualification"] else "DEDUCTION",
                    None if r["is_disqualification"] else r["deduction_points"],
                    r["support"], r["method"], r["limitation"], r["locator"],
                ),
            )

        for sc in SCENARIOS:
            row = conn.execute("SELECT id FROM scenarios WHERE code=? AND version=?", (sc["code"], sc["version"])).fetchone()
            if row:
                continue
            sid = new_id()
            definition = sc["build"]()
            conn.execute(
                "INSERT INTO scenarios(id,code,version,kind,title,summary,sim_version,definition,is_active) VALUES(?,?,?,?,?,?,?,?,1)",
                (sid, sc["code"], sc["version"], sc["kind"], sc["title"], sc["summary"], SIM_VERSION, jdumps(definition)),
            )
            # 같은 코스의 이전 버전은 목록에서 내린다. 지우지는 않는다 —
            # 과거 주행 기록이 그 버전을 가리키고 있고, 결과를 다시 그릴 때 그 정의가 필요하다.
            conn.execute("UPDATE scenarios SET is_active=0 WHERE code=? AND id<>?", (sc["code"], sid))
            if sc["kind"] == "ROAD":
                for event_code, (rule_code, _cat) in EVENT_MAP.items():
                    if rule_code:
                        conn.execute(
                            "INSERT OR IGNORE INTO scenario_rules(scenario_id,rule_id,event_code) VALUES(?,?,?)",
                            (sid, rule_ids[rule_code], event_code),
                        )
