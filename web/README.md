# 전진만할게요 웹

## 실행

루트에서 `./시작.sh` 로 설치물을 점검한 뒤 창 두 개로 띄운다.

```bash
cd web/backend && ./.venv/bin/python -m uvicorn app.main:app --port 8010
```

```bash
npm --prefix web/frontend run dev
```

브라우저에서 `http://localhost:5180`. 센서는 Web Serial 을 지원하는 데스크톱 Chrome/Edge 에서 연결한다. `--reload` 는 iCloud 폴더에서 불안정하므로 쓰지 않는다.

- DB: `data/local/license_fit.db` (없으면 서버 시작 시 기준 데이터로 생성)
- AI: `web/backend/.env.example` 을 `.env` 로 복사해 회사 GPT 값을 넣는다. 없으면 규칙 기반 요약

## 조작

| 입력 모드 | 전진·후진 | 조향 |
|---|---|---|
| 키보드 | W / S | A / D |
| 센서 | 방향키 위 / 아래 | MPU-6050 좌우 기울임 |

- R: 주행을 즉시 정지하고 정렬 단계로 돌아간다(처음부터 다시 정렬)
- Esc: 일시정지 → 한 번 더 누르면 지금까지 기록을 ‘미완료’로 저장하고 나간다
- 사건(신호위반 등)은 주행을 끝내지 않고 누적된다. 도로를 벗어나면 가까운 차로로 복귀한다

## 센서 보정

원시 roll → 한 샘플 튐 제거(30° 이상 급변) → 지수 평활 → 히스테리시스(진입/복귀 각도) → 방향 유지 시간.

| 프리셋 | 진입 / 복귀 | 평활 | 유지 |
|---|---|---|---|
| 둔감 | 18° / 10° | 220ms | 180ms |
| 보통(기본) | 15° / 8° | 150ms | 120ms |
| 민감 | 11° / 6° | 80ms | 60ms |

정렬값은 같은 브라우저 탭에서 30분간 재사용하고 중앙 복귀만 확인한다. 주행 기록에는 사용한 보정값이 함께 저장된다.

## 센서 펌웨어

`hardware/firmware/wme_sensor/wme_sensor.ino` — 115200 baud, `WME,<ms>,<roll>,<pitch>,<yaw>` 50Hz.

```bash
arduino-cli compile --fqbn arduino:avr:uno hardware/firmware/wme_sensor
arduino-cli upload -p /dev/cu.usbmodem101 --fqbn arduino:avr:uno hardware/firmware/wme_sensor
```

## 검증

```bash
cd web/backend && ./.venv/bin/python -m pytest -q
cd web/frontend && npm run typecheck && npm test && npm run build
```
