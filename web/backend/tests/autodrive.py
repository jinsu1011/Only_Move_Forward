"""테스트용 자동 운전자. 실제 입력과 같은 LEFT/CENTER/RIGHT·전진/정지만 사용한다."""
from __future__ import annotations

import math

from app.sim import PHYS, TICK_HZ, Sim, pedestrian_active, signal_state


def _road_heading(sim: Sim, ahead: int) -> float:
    j = min(len(sim.px) - 2, sim.idx + ahead)
    return math.atan2(sim.py[j + 1] - sim.py[j], sim.px[j + 1] - sim.px[j])


def drive(definition: dict, cruise_kmh: float | None = None, obey: bool = True, max_ticks: int = 30 * 240):
    if cruise_kmh is None:
        cruise_kmh = 20 if definition["kind"] == "FUNCTION" else 36
    sim = Sim(definition)
    lane_mid = definition["lane_width"] / 2
    inputs: list[list[int]] = []
    last = None
    while not sim.ended and sim.tick < max_ticks:
        forward = True
        stages = definition["stages"]
        stage = stages[sim.stage] if sim.stage < len(stages) else None
        if stage and stage["type"] == "REVERSE_STOP_IN":
            forward = False
        ahead = 3 + int(abs(sim.v) * 0.6) if forward else 0
        e = sim.h - _road_heading(sim, ahead)
        e = (e + math.pi) % (2 * math.pi) - math.pi
        if forward:
            c = (sim.offset - lane_mid) * 0.7 - e * 7
        else:
            c = (sim.offset - lane_mid) * 0.5 + e * 5
        steer = -1 if c > 0.3 else (1 if c < -0.3 else 0)

        speed = abs(sim.v) * 3.6
        target = cruise_kmh
        bend = abs(((_road_heading(sim, 30) - _road_heading(sim, 0)) + math.pi) % (2 * math.pi) - math.pi)
        if bend > 0.15:
            target = min(target, 22)
        front = sim.s + PHYS["half_len"]
        stop_at = None
        if obey:
            for z in definition["school_zones"]:
                if z["from"] - 40 <= sim.s <= z["to"]:
                    target = min(target, 24)
            for sig in definition["signals"]:
                if front < sig["stop_s"] and sig["stop_s"] - front < 45 and signal_state(sig, sim.tick) != "GREEN":
                    stop_at = sig["stop_s"] - 1.0
            for cw in definition["crosswalks"]:
                if front < cw["from"] and cw["from"] - front < 30:
                    if cw["id"] not in sim.stopped_before or pedestrian_active(cw, sim.tick):
                        stop_at = cw["from"] - 2.0
        if stage and stage["type"] == "STOP_IN" and sim.s > stage["from"] - 25:
            stop_at = (stage["from"] + stage["to"]) / 2 - PHYS["half_len"] + PHYS["half_len"]
            stop_at = stop_at + PHYS["half_len"]

        if not forward:
            mid = (stage["from"] + stage["to"]) / 2
            throttle = -1 if sim.s > mid + 0.8 and speed < 8 else 0
        elif stop_at is not None:
            gap = stop_at - front
            need = (sim.v * sim.v) / (2 * PHYS["brake"]) + 0.6
            throttle = 0 if gap <= need else (1 if speed < min(target, 20) else 0)
        else:
            throttle = 1 if speed < target else 0

        cur = (throttle, steer)
        if cur != last:
            inputs.append([sim.tick, throttle, steer])
            last = cur
        sim.step(throttle, steer)
    return sim, inputs
