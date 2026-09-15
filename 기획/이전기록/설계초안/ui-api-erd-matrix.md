# UI → API → ERD 일관성 행렬

모든 API는 /api/v1 접두사. UI 정적 문구·선택값·센서 상태는 서버 저장 없이 앱 상태로 표시 가능. 아래 표는 화면 수준이며 최종 명세 확정 때 필드별 스키마 대조를 추가한다.

|UI/경로|표시·입력 데이터|서버 동작|영속 데이터/상태|이동|
|---|---|---|---|---|
|S01 /|필기·주행 통합 학습 / 실차교육을 대체하지 않는 보조 도구|GET /guide|guide_steps,official_sources|S02,S03,S05|
|S02 /signup|이메일 [입력]; 비밀번호 [입력]; 닉네임 [입력]; 1종/2종 보통 [선택]|POST /auth/signup|users|S03|
|S03 /login|이메일 [입력]; 비밀번호 [입력]|POST /auth/login|users,auth_sessions|S04,S02|
|S04 /dashboard|닉네임; 면허종별; 필기 응시 수; 최근 점수; 연습 목록; AI 추천 상태|GET /me; GET /dashboard; POST /auth/logout|users,written_attempts,training_sessions,ai_jobs|S06,S10,S13,S16,S03|
|S05 /license-guide|교육→신체검사→학과→기능→연습면허→도로주행→발급; 출처·시행일·조회일|GET /guide?license_type=...|guide_steps,official_sources|S06,S01|
|S06 /written|면허종별; 주제; 연습/모의시험; 문제 출처 구분; 데이터 버전|GET /written/catalog; POST /written/attempts|categories,questions,written_attempts,attempt_questions|S07,S04|
|S07 /written/{id}|문항 본문; 이미지; 보기; 선택 개수; 진행/남은 시간(앱 상태)|GET /written/attempts/{id}; PUT /written/attempts/{id}/answers/{questionId}; POST /written/attempts/{id}/submit|attempt_questions,questions,question_options,written_answers,answer_selections|S08|
|S08 /written/result/{id}|점수/총점; 정답 수; 문제별 결과; 출처; 연습은 합격 판정 없음|GET /written/attempts/{id}/result|written_attempts,written_answers,questions|S09,S06,S16|
|S09 /written/review/{answerId}|문제; 내 선택; 검수 정답; 공식 해설; AI 설명; 인용 링크|GET /written/answers/{id}; POST /ai/jobs; GET /ai/jobs/{id}|written_answers,answer_selections,question_options,ai_jobs,ai_citations,source_chunks|S08|
|S10 /controller|연결 상태(기기); 센서/키보드 [선택]; 지원 브라우저 안내|브라우저 Web Serial; 서버 API 없음|앱/센서 상태만|S11,S04|
|S11 /controller/setup|CENTER / STOP; 3초 안정 측정; LEFT 확인; CENTER; RIGHT 확인; CENTER; READY|브라우저 로컬 상태; 시작 시 POST /training/sessions|training_sessions.calibration_snapshot|S12 또는 S14,S10|
|S12 /practice|전진/정지/후진; LEFT/CENTER/RIGHT; 기본 주행 화면; 연습 사건 목록|POST /training/sessions; POST /training/sessions/{id}/complete; POST /training/sessions/{id}/abort|training_sessions,driving_events|S11,S16,S04|
|S13 /road|코스; 판정 규칙 버전; A/B/C 지원 목록; 일부 기준 평가 안내|GET /scenarios?kind=ROAD; GET /scenarios/{id}/rules|scenarios,scenario_rules,official_scoring_rules,official_sources|S10,S11|
|S14 /road/session/{id}|주행 화면; 속도; 제한속도; 신호; 진행; 지원 규칙 점수(검증 전 잠정)|POST /training/sessions; POST /training/sessions/{id}/complete; POST /training/sessions/{id}/abort|training_sessions,scenarios,driving_events|S15,S11|
|S15 /road/result/{id}|검증 상태; 점수; PASS/FAIL/DISQUALIFIED; 감점 목록; 실격 사유; 미측정 항목|GET /training/sessions/{id}|training_sessions,driving_events,official_scoring_rules,official_sources|S13,S16|
|S16 /report|취약영역; 실제 분자/분모; 근거 응시/세션; 추천 주제·다음 연습; 출처|POST /ai/jobs; GET /ai/jobs/{id}; GET /ai/jobs?kind=REPORT|ai_jobs,ai_citations,written_attempts,written_answers,training_sessions,driving_events|S06,S13,S17|
|S17 /assistant|질문 [입력]; 답변; 법령 시행일; 인용 위치|POST /ai/jobs; GET /ai/jobs/{id}|ai_jobs,ai_citations,source_chunks,official_sources|S04|
