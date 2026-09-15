import json
from pathlib import Path

from app.seed import _function_course, _road_course
from app.sim import Sim, replay
from autodrive import drive

FIXTURE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "sim" / "golden.json"


def codes(sim):
    return [e["code"] for e in sim.events]


def test_function_course_complete_with_forward_and_reverse():
    d = _function_course()
    sim, inputs = drive(d)
    assert codes(sim)[-1] == "COURSE_COMPLETE", sim.events
    assert "STAGE_CLEAR" in codes(sim)
    again = replay(d, inputs, sim.tick)
    assert again.events == sim.events


def test_road_course_lawful_run_completes_without_disqualification():
    from app.sim import DISQUALIFY_CODES

    d = _road_course()
    sim, inputs = drive(d)
    assert codes(sim)[-1] == "COURSE_COMPLETE", sim.events
    assert not set(codes(sim)) & DISQUALIFY_CODES
    assert not {"SIGNAL_RED", "CROSSWALK_NO_STOP", "PEDESTRIAN_CONFLICT"} & set(codes(sim))
    assert replay(d, inputs, sim.tick).events == sim.events


def test_violations_accumulate_and_run_continues_to_finish():
    d = _road_course()
    d["signals"][0]["offset"] = 0  # 첫 교차로를 녹색으로 통과하도록 고정
    sim, inputs = drive(d, cruise_kmh=45, obey=False)
    assert "SCHOOL_ZONE_SPEEDING" in codes(sim), sim.events
    assert sim.end_code in {"COURSE_COMPLETE", "TIME_LIMIT"}
    assert sim.max_s > d["school_zones"][0]["to"]
    assert [e for e in sim.events if e["terminal"]] == [sim.events[-1]]
    assert replay(d, inputs, sim.tick).events == sim.events


def test_red_light_violation_recorded_without_ending():
    d = _road_course()
    for offset in range(0, 22):
        d["signals"][0]["offset"] = offset
        sim, _ = drive(d, cruise_kmh=40, obey=False)
        reds = [e for e in sim.events if e["code"] == "SIGNAL_RED"]
        if reds:
            assert reds[0]["evidence"]["light"] == "RED" and not reds[0]["terminal"]
            assert sim.end_code != "SIGNAL_RED"
            return
    raise AssertionError("no offset produced a red light crossing")


def test_off_road_recovers_to_lane_and_keeps_driving():
    d = _road_course()
    sim = replay(d, [[0, 1, 1]], 30 * 20)
    offs = [e for e in sim.events if e["code"] == "OFF_ROAD"]
    assert offs and not sim.ended
    assert all(e["evidence"]["recovered"] for e in offs)
    assert -1.5 < sim.offset < d["lane_width"] + 1.5


def test_start_delay_and_time_limit():
    d = _road_course()
    sim = replay(d, [[0, 0, 0]], 30 * 25)
    assert codes(sim) == ["START_DELAY"]


def test_both_or_no_throttle_stops_vehicle():
    d = _function_course()
    sim = Sim(d)
    for _ in range(60):
        sim.step(1, 0)
    assert sim.v > 0
    for _ in range(60):
        sim.step(0, 0)
    assert sim.v == 0


def test_write_golden_fixture_for_frontend():
    d = _road_course()
    sim, inputs = drive(d)
    d2 = _function_course()
    sim2, inputs2 = drive(d2)
    d3 = _road_course()
    sim3, inputs3 = drive(d3, cruise_kmh=48, obey=False)
    data = {
        "road": {"definition": d, "inputs": inputs, "total_ticks": sim.tick, "events": sim.events,
                 "final": {"x": sim.x, "y": sim.y, "h": sim.h, "v": sim.v}},
        "road_violations": {"definition": d3, "inputs": inputs3, "total_ticks": sim3.tick, "events": sim3.events,
                            "final": {"x": sim3.x, "y": sim3.y, "h": sim3.h, "v": sim3.v}},
        "function": {"definition": d2, "inputs": inputs2, "total_ticks": sim2.tick, "events": sim2.events,
                     "final": {"x": sim2.x, "y": sim2.y, "h": sim2.h, "v": sim2.v}},
    }
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
