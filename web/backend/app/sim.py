"""결정적 주행 시뮬레이션 (sim-1.0.0).

프런트엔드 `src/sim/engine.ts` 와 한 줄씩 대응한다. 서버는 클라이언트가 보낸 입력 기록을
이 엔진으로 다시 재생해 사건을 확정한다. 두 구현이 같은 결과를 내도록
- 고정 틱(30Hz), 정수 틱 기반 시간
- 매 틱 상태를 1e-6 단위로 반올림
- hypot/`**` 대신 곱셈·sqrt 만 사용
한다. 공식 채점이 아니라 연습용 판정이다.
"""
from __future__ import annotations

import math

SIM_VERSION = "sim-1.0.0"
TICK_HZ = 30

GRAVITY = 9.81  # m/s^2
STATIC_HOLD = 0.35  # m/s^2 미만의 경사는 정지 상태에서 굴러가지 않는다(주차 브레이크 대용)

PHYS = {
    "accel": 2.8,  # m/s^2 (Space)
    "brake": 6.0,  # m/s^2 (입력 없음·동시 입력·반대 방향)
    "max_fwd": 16.7,  # m/s ≈ 60km/h
    "max_rev": 3.0,  # m/s ≈ 10.8km/h
    "steer_rate": 2.2,  # 조향 비율 변화량/초
    "max_steer": 0.55,  # rad
    "wheelbase": 2.6,
    "half_len": 2.2,
    "half_width": 0.9,
}

DISQUALIFY_CODES = {
    "SIGNAL_RED",
    "SCHOOL_ZONE_SPEEDING",
    "SPEEDING",
    "CENTER_LINE",
    "OFF_ROAD",
    "PEDESTRIAN_CONFLICT",
}


def r6(v: float) -> float:
    return math.floor(v * 1e6 + 0.5) / 1e6


def r2(v: float) -> float:
    return math.floor(v * 100 + 0.5) / 100


def signal_state(sig: dict, tick: int) -> str:
    cycle = sig["green"] + sig["yellow"] + sig["red"]
    ph = (tick / TICK_HZ + sig["offset"]) % cycle
    if ph < sig["green"]:
        return "GREEN"
    if ph < sig["green"] + sig["yellow"]:
        return "YELLOW"
    return "RED"


def pedestrian_active(cw: dict, tick: int) -> bool:
    if not cw.get("ped_period"):
        return False
    ph = (tick / TICK_HZ) % cw["ped_period"]
    return cw["ped_from"] <= ph < cw["ped_to"]


class Sim:
    def __init__(self, definition: dict):
        self.d = definition
        pts = definition["centerline"]
        self.px = [p[0] for p in pts]
        self.py = [p[1] for p in pts]
        self.cum = [0.0]
        for i in range(len(pts) - 1):
            dx = self.px[i + 1] - self.px[i]
            dy = self.py[i + 1] - self.py[i]
            self.cum.append(self.cum[-1] + math.sqrt(dx * dx + dy * dy))
        self.total = self.cum[-1]
        st = definition["start"]
        self.x = st["x"]
        self.y = st["y"]
        self.h = st["heading"]
        self.v = 0.0
        self.steer = 0.0
        self.tick = 0
        self.idx = 0
        self.events: list[dict] = []
        self.ended = False
        self.end_code: str | None = None
        self.s, self.offset = self._project()
        self.prev_s = self.s
        self.start_s = self.s
        self.max_s = self.s
        self.distance = 0.0
        self.max_speed = 0.0
        # 판정 누적 상태
        self.cl_ticks = 0
        self.lk_ticks = 0
        self.lk_in_ticks = 0
        self.lk_emitted = False
        self.sz_ticks = 0
        self.sp_ticks = 0
        self.start_delay_emitted = False
        self.overrun_emitted: set[str] = set()
        self.stopped_before: set[str] = set()
        self.ped_emitted: set[str] = set()
        self.stage = 0
        self.stop_ticks = 0
        self.reversed_in_stage = False

    # ---- 기하 ----
    def _project(self) -> tuple[float, float]:
        n = len(self.px)
        lo = max(0, self.idx - 10)
        hi = min(n - 2, self.idx + 10)
        best_j = lo
        best_t = 0.0
        best_d2 = -1.0
        for j in range(lo, hi + 1):
            ax = self.px[j]
            ay = self.py[j]
            dx = self.px[j + 1] - ax
            dy = self.py[j + 1] - ay
            l2 = dx * dx + dy * dy
            t = ((self.x - ax) * dx + (self.y - ay) * dy) / l2
            if t < 0:
                t = 0.0
            elif t > 1:
                t = 1.0
            qx = ax + t * dx
            qy = ay + t * dy
            d2 = (self.x - qx) * (self.x - qx) + (self.y - qy) * (self.y - qy)
            if best_d2 < 0 or d2 < best_d2:
                best_d2 = d2
                best_j = j
                best_t = t
        self.idx = best_j
        ax = self.px[best_j]
        ay = self.py[best_j]
        dx = self.px[best_j + 1] - ax
        dy = self.py[best_j + 1] - ay
        length = math.sqrt(dx * dx + dy * dy)
        s = self.cum[best_j] + best_t * length
        cross = dx * (self.y - ay) - dy * (self.x - ax)
        return s, -cross / length

    def _speed_limit(self, s: float) -> float:
        limit = 999.0
        for z in self.d.get("speed_limits", []):
            if z["from"] <= s <= z["to"] and z["limit_kmh"] < limit:
                limit = z["limit_kmh"]
        return limit

    def _emit(self, code: str, terminal: bool, evidence: dict) -> None:
        self.events.append(
            {
                "seq": len(self.events) + 1,
                "code": code,
                "tick": self.tick,
                "s_m": r2(self.s),
                "speed_kmh": r2(abs(self.v) * 3.6),
                "terminal": terminal,
                "evidence": evidence,
            }
        )
        if terminal and not self.ended:
            self.ended = True
            self.end_code = code

    # ---- 한 틱 ----
    def step(self, throttle: int, steer_in: int) -> None:
        if self.ended:
            return
        p = PHYS
        st = self.steer
        rate = p["steer_rate"] / TICK_HZ
        target = float(steer_in)
        if target > st:
            st = min(target, st + rate)
        else:
            st = max(target, st - rate)

        v = self.v
        a = p["accel"] / TICK_HZ
        b = p["brake"] / TICK_HZ
        if throttle == 1:
            # 뒤로 밀리는 중이면 먼저 제동력으로 잡고, 0 을 지나면 그대로 전진 가속한다.
            # 0 에서 끊으면 경사로에서 영영 출발하지 못한다.
            v = min(p["max_fwd"], v + (b if v < 0 else a))
        elif throttle == -1:
            v = max(-p["max_rev"], v - (b if v > 0 else a))
        else:
            v = max(0.0, v - b) if v > 0 else min(0.0, v + b)

        # 경사로: 중력의 진행 방향 성분. 오르막에서 가속을 놓으면 뒤로 밀린다.
        # 정지 상태에서 경사가 완만하면 굴러가지 않도록 정지 마찰만큼은 버틴다.
        g = grade_at(self.d, self.s)
        if g:
            slope_a = -GRAVITY * math.sin(math.atan(g)) / TICK_HZ
            if abs(v) < 1e-6 and abs(slope_a) * TICK_HZ < STATIC_HOLD:
                slope_a = 0.0
            v += slope_a

        yaw = v / p["wheelbase"] * (-st) * p["max_steer"]
        h = self.h + yaw / TICK_HZ
        x = self.x + v * math.cos(h) / TICK_HZ
        y = self.y + v * math.sin(h) / TICK_HZ

        self.steer = r6(st)
        self.v = r6(v)
        self.h = r6(h)
        self.x = r6(x)
        self.y = r6(y)
        self.tick += 1

        self.s, self.offset = self._project()
        self.distance += abs(self.v) / TICK_HZ
        speed_kmh = abs(self.v) * 3.6
        if speed_kmh > self.max_speed:
            self.max_speed = speed_kmh
        if self.s > self.max_s:
            self.max_s = self.s
        if self.v < -0.5:
            self.reversed_in_stage = True
        self._judge(speed_kmh)
        self.prev_s = self.s

    def _course_point(self, s: float, lateral: float) -> tuple[float, float, float]:
        cum = self.cum
        lo = 0
        hi = len(cum) - 1
        target = max(0.0, min(self.total, s))
        while hi - lo > 1:
            mid = (lo + hi) >> 1
            if cum[mid] <= target:
                lo = mid
            else:
                hi = mid
        seg = cum[hi] - cum[lo] or 1.0
        t = (target - cum[lo]) / seg
        dx = self.px[hi] - self.px[lo]
        dy = self.py[hi] - self.py[lo]
        length = math.sqrt(dx * dx + dy * dy) or 1.0
        nx = dy / length
        ny = -dx / length
        return self.px[lo] + dx * t + nx * lateral, self.py[lo] + dy * t + ny * lateral, math.atan2(dy, dx)

    def _recover(self) -> None:
        """도로를 벗어나면 가까운 차로 중앙에 정지 상태로 되돌려 주행을 이어간다."""
        x, y, h = self._course_point(self.s, self.d["lane_width"] / 2)
        self.x = r6(x)
        self.y = r6(y)
        self.h = r6(h)
        self.v = 0.0
        self.steer = 0.0
        self.s, self.offset = self._project()
        self.cl_ticks = 0
        self.lk_ticks = 0
        self.lk_in_ticks = 0
        self.lk_emitted = False

    def _judge(self, speed_kmh: float) -> None:
        # 실격 해당 사건도 기록만 하고 주행은 계속한다. 끝나는 경우는 완주·제한 시간뿐이다.
        d = self.d
        hl = PHYS["half_len"]
        hw = PHYS["half_width"]
        lane = d["lane_width"]
        road = d["kind"] == "ROAD"

        # 1) 도로 이탈 → 기록 후 차로로 복귀
        left_limit = -lane if road else -1.5
        if self.offset > lane + 1.5 or self.offset < left_limit or self.s < -3 or self.s > self.total + 3:
            self._emit("OFF_ROAD", False, {"offset_m": r2(self.offset), "recovered": True})
            self._recover()
            self.prev_s = self.s
            return

        s = self.s
        off = self.offset
        front = s + hl
        prev_front = self.prev_s + hl
        rear = s - hl

        # 2) 중앙선 침범 (도로 코스)
        if road:
            self.cl_ticks = self.cl_ticks + 1 if off < 0 else 0
            if self.cl_ticks == 9:
                self._emit("CENTER_LINE", False, {"offset_m": r2(off), "duration_s": 0.3})

        # 3) 차로 유지
        out = off < hw - 0.3 or off > lane - hw + 0.3
        if out:
            self.lk_ticks += 1
            self.lk_in_ticks = 0
            if self.lk_ticks == TICK_HZ and not self.lk_emitted:
                self.lk_emitted = True
                self._emit("LANE_KEEP", False, {"offset_m": r2(off), "lane_width_m": lane, "duration_s": 1.0})
        else:
            self.lk_in_ticks += 1
            if self.lk_in_ticks >= 15:
                self.lk_ticks = 0
                self.lk_emitted = False

        if road:
            # 4) 속도
            school = None
            for z in d.get("school_zones", []):
                if z["from"] <= s <= z["to"]:
                    school = z
            if school is not None and speed_kmh > school["limit_kmh"]:
                self.sz_ticks += 1
            else:
                self.sz_ticks = 0
            if self.sz_ticks == 15 and school is not None:
                self._emit(
                    "SCHOOL_ZONE_SPEEDING",
                    False,
                    {"limit_kmh": school["limit_kmh"], "speed_kmh": r2(speed_kmh), "duration_s": 0.5},
                )
            limit = self._speed_limit(s)
            self.sp_ticks = self.sp_ticks + 1 if speed_kmh > limit + 10 else 0
            if self.sp_ticks == TICK_HZ:
                self._emit("SPEEDING", False, {"limit_kmh": limit, "speed_kmh": r2(speed_kmh), "duration_s": 1.0})

            # 5) 신호
            for sig in d.get("signals", []):
                light = signal_state(sig, self.tick)
                if self.v > 0 and prev_front < sig["stop_s"] <= front and light == "RED":
                    self._emit("SIGNAL_RED", False, {"signal_id": sig["id"], "light": light})
                if (
                    light == "RED"
                    and abs(self.v) < 0.1
                    and sig["stop_s"] < front <= sig["crosswalk_to"]
                    and sig["id"] not in self.overrun_emitted
                ):
                    self.overrun_emitted.add(sig["id"])
                    self._emit(
                        "CROSSWALK_OVERRUN",
                        False,
                        {"signal_id": sig["id"], "light": light, "over_stop_line_m": r2(front - sig["stop_s"])},
                    )

            # 6) 신호 없는 횡단보도(어린이보호구역)
            for cw in d.get("crosswalks", []):
                if cw["from"] - 15 <= front <= cw["from"] and abs(self.v) < 0.1:
                    self.stopped_before.add(cw["id"])
                if self.v > 0 and prev_front < cw["from"] <= front and cw["id"] not in self.stopped_before:
                    self._emit("CROSSWALK_NO_STOP", False, {"crosswalk_id": cw["id"]})
                overlap = front > cw["from"] and rear < cw["to"]
                if not overlap:
                    self.ped_emitted.discard(cw["id"])
                elif pedestrian_active(cw, self.tick) and abs(self.v) > 0.5 and cw["id"] not in self.ped_emitted:
                    self.ped_emitted.add(cw["id"])
                    self._emit("PEDESTRIAN_CONFLICT", False, {"crosswalk_id": cw["id"], "pedestrian": True})

            # 7) 20초 내 미출발
            if not self.start_delay_emitted and self.tick >= 20 * TICK_HZ and self.max_s - self.start_s < 1.0:
                self.start_delay_emitted = True
                self._emit("START_DELAY", False, {"waited_s": 20})

        # 8) 과제 단계
        stages = d.get("stages", [])
        if self.stage < len(stages):
            stg = stages[self.stage]
            in_box = stg["from"] <= s <= stg["to"] and abs(self.v) < 0.1 and not out
            if stg["type"] == "REVERSE_STOP_IN":
                in_box = in_box and self.reversed_in_stage
            self.stop_ticks = self.stop_ticks + 1 if in_box else 0
            if self.stop_ticks == TICK_HZ:
                self.stage += 1
                self.stop_ticks = 0
                self.reversed_in_stage = False
                if self.stage == len(stages):
                    self._emit("COURSE_COMPLETE", True, {"stages": len(stages)})
                    return
                self._emit("STAGE_CLEAR", False, {"stage": self.stage, "label": stg.get("label", "")})

        # 8-1) 피니시 라인 — 선을 넘으면 그 자리에서 끝난다.
        # 과제를 다 못 했으면 완주로 치지 않는다(미완료로 남는다).
        finish_s = d.get("finish_s")
        if finish_s is not None and s >= finish_s:
            done = self.stage >= len(stages)
            self._emit("COURSE_COMPLETE" if done else "FINISH_LINE_EARLY", True,
                       {"stages_done": self.stage, "stages": len(stages)})
            return

        # 9) 제한 시간
        if self.tick >= d["time_limit_s"] * TICK_HZ:
            self._emit("TIME_LIMIT", True, {"time_limit_s": d["time_limit_s"]})


def replay(definition: dict, inputs: list[list[int]], total_ticks: int) -> Sim:
    sim = Sim(definition)
    k = 0
    thr = 0
    ste = 0
    while sim.tick < total_ticks and not sim.ended:
        while k < len(inputs) and inputs[k][0] <= sim.tick:
            thr = inputs[k][1]
            ste = inputs[k][2]
            k += 1
        sim.step(thr, ste)
    return sim


# ---- 코스 생성 (시드에서 한 번 계산해 저장) ----
def grade_at(definition: dict, s: float) -> float:
    """코스 s 지점의 경사(상승/수평거리). 오르막이 양수다.
    ramps 는 [{from, to, rise_m}] 이고 구간 안에서는 기울기가 일정하다."""
    for r in definition.get("ramps", []):
        if r["from"] <= s <= r["to"]:
            run = r["to"] - r["from"]
            return (r["rise_m"] / run) if run > 0 else 0.0
    return 0.0


def elevation_at(definition: dict, s: float) -> float:
    """코스 s 지점의 높이(m). 경사로를 다 올라간 뒤에는 그 높이를 유지한다."""
    h = 0.0
    for r in definition.get("ramps", []):
        if s <= r["from"]:
            continue
        run = r["to"] - r["from"]
        if run <= 0:
            continue
        h += r["rise_m"] * min(1.0, (s - r["from"]) / run)
    return h


def build_course(start: tuple[float, float], heading_deg: float, segments: list[dict]) -> dict:
    x, y = start
    h = math.radians(heading_deg)
    pts = [(x, y)]
    marks = []
    for seg in segments:
        if seg["type"] == "straight":
            n = int(round(seg["length"]))
            for _ in range(n):
                x += math.cos(h)
                y += math.sin(h)
                pts.append((x, y))
        else:
            r = seg["radius"]
            ang = math.radians(seg["angle"])
            n = max(1, int(round(abs(ang) * r)))
            dth = ang / n
            ds = 2 * r * math.sin(abs(dth) / 2)
            for _ in range(n):
                h += dth / 2
                x += ds * math.cos(h)
                y += ds * math.sin(h)
                h += dth / 2
                pts.append((x, y))
        marks.append(len(pts) - 1)
    centerline = [[round(px, 3), round(py, 3)] for px, py in pts]
    cum = [0.0]
    for i in range(len(centerline) - 1):
        dx = centerline[i + 1][0] - centerline[i][0]
        dy = centerline[i + 1][1] - centerline[i][1]
        cum.append(cum[-1] + math.sqrt(dx * dx + dy * dy))
    return {"centerline": centerline, "segment_end_s": [round(cum[m], 2) for m in marks], "length_m": round(cum[-1], 2)}


def start_pose(centerline: list[list[float]], lateral: float) -> dict:
    ax, ay = centerline[0]
    bx, by = centerline[1]
    dx, dy = bx - ax, by - ay
    length = math.sqrt(dx * dx + dy * dy)
    nx, ny = dy / length, -dx / length  # 진행 방향의 오른쪽
    return {"x": r6(ax + nx * lateral), "y": r6(ay + ny * lateral), "heading": r6(math.atan2(dy, dx))}
