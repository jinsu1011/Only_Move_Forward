# 전진만할게요 — 필기·주행 통합 운전면허 학습

1·2종 보통 운전면허 준비자가 필기 오답과 브라우저 주행 연습 기록을 함께 돌아보고, 근거가 확인되는 AI 설명으로 다음 연습을 정하는 학습 보조 웹 서비스입니다. **공식 시험·실차교육을 대체하지 않으며, 주행 판정은 연습용입니다.**

AI 웹 서비스 설계 Mini-project (SKALA 9반) 산출물입니다.

| 기능 | 내용 |
|---|---|
| 필기 | 주제·문항 수 선택 → 답안 즉시 저장 → 서버 채점 → 제출 후 정답·조문 근거 공개 → AI 오답 코칭 |
| 주행 | 기본조작 연습장 · 도심 도로주행 A코스(신호·어린이보호구역·횡단보도) 3D 시뮬레이션. 키보드 또는 MPU-6050 센서 핸들 |
| 판정 검증 | 브라우저 입력 기록을 서버가 같은 엔진으로 재생해 사건 확정, 별표26 항목과 연결(연습 판정) |
| AI 리포트 | 서버가 계산한 필기 주제별 정답률·주행 사건 빈도만 AI에 전달, 응답의 수치·근거 ID를 서버가 검증 |

## 제출물

[`제출/최종본/`](제출/최종본/) — 마감 2026-09-17(목) 13:40

| 파일 | 내용 |
|---|---|
| `9반_P286_김진수_전진만할게요-개요.pdf` | 프로젝트 기술서 초안 25쪽 (원본 `개요PDF/slides.html`) |
| `9반_P286_김진수_전진만할게요-API.yml` | OpenAPI 3.0.3 · 24경로 27동작 |
| `9반_P286_김진수_전진만할게요-DB.dbml` | DBML · 20테이블 27관계 |
| `체크리스트.md` | 제출 전 확인 항목 · 평가 대응 · 검증 재실행 방법 |

명세는 실제 서버 코드 기준이며, 실제 응답 53건을 명세 스키마로 대조해 불일치 0을 확인했습니다.

## 빠른 시작

```bash
./시작.sh
```

설치물을 점검·재설치합니다. 이후 창 두 개에서 실행합니다.

```bash
cd web/backend && ./.venv/bin/python -m uvicorn app.main:app --port 8010
```

```bash
npm --prefix web/frontend run dev
```

브라우저 `http://localhost:5180` · API 문서 `http://localhost:8010/api/docs` · 센서는 데스크톱 Chrome/Edge(Web Serial).
AI를 쓰려면 `web/backend/.env.example`을 `.env`로 복사해 키를 넣습니다. 없으면 규칙 기반 요약으로 동작합니다.

## 조작

| 모드 | 전진 / 후진 | 조향 |
|---|---|---|
| 키보드 | W / S | A / D |
| 센서 | ↑ / ↓ | 핸들 좌우 기울기(roll) · 민감도 둔감/보통/민감 |

반대 키 동시 입력이나 무입력은 정지/중앙 · **R** 즉시 정지·다시 정렬 · **Esc** 일시정지(한 번 더 누르면 기록 저장 후 나가기)

## 기술 구성

| 영역 | 사용 |
|---|---|
| 프런트엔드 | React 19 · TypeScript · Vite · Three.js · Web Serial |
| 백엔드 | FastAPI · SQLite · scrypt 비밀번호 해시 · HttpOnly 세션 쿠키 · CSRF · Idempotency-Key |
| AI | OpenAI 호환 API (실패 시 규칙 기반 대체) |
| 하드웨어 | Arduino UNO + MPU-6050, 115200 baud `WME,<ms>,<roll>,<pitch>,<yaw>` 50Hz |

## 검증

```bash
cd web/backend && ./.venv/bin/python -m pytest -q
cd web/frontend && npm run typecheck && npm test && npm run build
```

최근 결과(2026-09-16): pytest 14 passed · vitest 20 passed · 타입 검사 오류 0 · 빌드 성공(Three.js 번들 500kB 경고, 동작에는 영향 없음).
**센서 좌우 방향·민감도 실측은 아직 확인하지 않았습니다.**

## 폴더

| 폴더 | 내용 |
|---|---|
| [`제출/최종본/`](제출/최종본/) | 제출 파일 3종, 화면 캡처, ERD·Swagger 이미지, 검증 도구 |
| [`web/`](web/) | `backend/` FastAPI · `frontend/` React·Three.js |
| [`hardware/`](hardware/) | 센서 핸들 펌웨어·배선·실측 체크 |
| [`기획/`](기획/) | `PROGRESS.md` · 공식 자료 조사 · 도로주행 규칙 대응 · 발표 계획 · `이전기록/`(구현 전 초안) |
| [`data/`](data/) | 별표26 57항목 조사 데이터(서버 시드) · `local/` DB(깃 제외) |
| [`driving_game/`](driving_game/) | 기존 파이썬(Ursina) 프로토타입 원본 — 수정하지 않음 |
| `참고자료/` | 수업 배포 자료·법령 원문(깃 제외) |

결정 사항과 원칙은 [`PROJECT_HEAD.md`](PROJECT_HEAD.md), 다른 노트북에서 이어받기는 [`이어서작업.md`](이어서작업.md), 진행 상황은 [`기획/PROGRESS.md`](기획/PROGRESS.md)를 봅니다.
