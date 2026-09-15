# API 계약 제안

접두사 `/api/v1`, JSON, 세션 쿠키 인증. `제출/design.yml`은 OpenAPI 3.0.3 승인 검토 초안이다. Swagger 렌더 검증 전이며 최종 제출본이 아니다.

|메서드·경로|동작|요청 schema|성공 응답|오류|
|---|---|---|---|---|
|POST /auth/signup|회원가입|Signup|201 users|400,409,429|
|POST /auth/login|로그인·세션 쿠키 발급|Login|200 users|400,401,429|
|POST /auth/logout|현재 세션 폐기|본문 없음|204 본문 없음|401,403|
|GET /me|내 공개 프로필|본문 없음|200 users|401|
|GET /dashboard|내 학습 요약|본문 없음|200 Dashboard|401|
|GET /guide|면허종별 공식 안내|본문 없음|200 Guide|400,503|
|GET /written/catalog|검수된 연습 자료 목록|본문 없음|200 WrittenCatalog|401,503|
|POST /written/attempts|새 필기 시도|AttemptCreate|201 AttemptDetail|400,401,409,503|
|GET /written/attempts/{id}|진행 중 문항·저장 답안|본문 없음|200 AttemptDetail|401,404|
|PUT /written/attempts/{id}/answers/{questionId}|선택 답안 저장|AnswerWrite|200 AnswerWrite|400,401,404,409|
|POST /written/attempts/{id}/submit|서버 정답 채점·제출 확정|본문 없음|200 WrittenResult|401,404,409|
|GET /written/attempts/{id}/result|본인 제출 결과|본문 없음|200 WrittenResult|401,404,409|
|GET /written/answers/{id}|제출된 답안의 검수 정답·해설|본문 없음|200 AnswerReview|401,404,409|
|GET /scenarios|연습 가능한 코스|본문 없음|200 scenarios|400,401|
|GET /scenarios/{id}/rules|코스 버전과 지원 규칙|본문 없음|200 Rules|401,404|
|POST /training/sessions|새 주행 시도|TrainingCreate|201 training_sessions|400,401,409|
|POST /training/sessions/{id}/complete|입력 검증 후 서버 판정|TrainingComplete|200 TrainingResult|400,401,404,409,413|
|POST /training/sessions/{id}/abort|R 재시작 등으로 기존 시도 중단|본문 없음|200 training_sessions|401,404,409|
|GET /training/sessions/{id}|본인 주행 결과|본문 없음|200 TrainingResult|401,404|
|POST /ai/jobs|AI 해설·보고서·Q&A 요청|AiCreate|202 ai_jobs|400,401,404,409,429,503|
|GET /ai/jobs|본인 AI 작업 이력|본문 없음|200 ai_jobs|400,401|
|GET /ai/jobs/{id}|작업 상태·답변·출처|본문 없음|200 AiResult|401,404|

## 상태·일관성 계약

- POST 생성은 Idempotency-Key로 중복 요청을 방지. 동일 key/동일 body는 원래 결과, 다른 body는409. idempotency_keys에서 사용자+경로+key와 body 해시·응답을 저장한다.
- GET 다른 사용자 기록은404로 통일. 보호 API 비로그인은401. CSRF/Origin 실패403. DB 오류/AI 공급자 정보는 응답에 노출하지 않는다.
- 로그인 성공은 Set-Cookie로 세션 발급, 로그아웃204와 쿠키 만료. 공개 프로필에 password_hash/token_hash 제외.
- PUT 답안은 소속 문항·보기 및 복수 선택 수를 확인한다. 정답 is_correct/해설은 제출 전 응답에서 제거한다. 미선택은 빈 배열이며 제출 시 오답. 작성 중 새로고침은 서버 저장 답안으로 복구.
- 제출 완료 시 원본 문항 버전의 정답과 배점으로 채점한다. PRACTICE에는 공식 합격 outcome을 생성하지 않는다. MOCK_EXAM은 검수된 구성일 때만 허용한다.
- complete는 서버 입력 재생으로 사건/점수 확정. 중복 complete 동일 입력은 원래 결과; 다른 입력은409. input log 크기 제한과 세션 최대 길이는 성능 검증 후 수치 확정한다.
- ABORTED는 실패 점수와 구별. R로 새 시도를 생성하며 이전 결과를 덮어쓰지 않는다.
- AI EXPLANATION은 본인 제출 answer_id 필수; QA는 prompt 필수; REPORT는 서버가 본인 기록 스냅샷을 수집. 불필요한 다른 필드 조합은400. 개인 식별정보는 모델에 보내지 않는다.
- AI 생성202 → GET 상태 조회. 기록 부족/근거 부족은 정상 종료 상태로 표시. timeout은 FAILED/error_code이고 채점 결과를 삭제하지 않는다. 재시도는 새 key의 새 작업이다.
- 보고서 result={weakest_category,evidence:[{type,id,correct_count,answer_count,event_count}],why,study_topic,next_practice,citation_ids}. Q&A/해설 result={answer,citation_ids}. 수치 검산과 인용 검증을 통과한 문장만 노출한다.
- UI 실시간 속도/조향/신호·잠정 점수는 클라이언트 상태이고 결과 화면은 서버 저장·검증 결과를 사용한다. 단절·포트 권한 등은 HTTP 오류로 가장하지 않는다.

## 확정 전 남은 검증

모든 schema required/readOnly/writeOnly, AI oneOf와 JSON 증거 스키마, session/input_mode 조건, 응답 예제, 제한 수치, 타임스탬프 동률 페이지네이션을 더 구체화한 후 Swagger UI에서 렌더한다. 현 단계는 구조 제안이며 완성 명세로 제출하지 않는다.
