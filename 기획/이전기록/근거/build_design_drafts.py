from pathlib import Path
import json,html
root=Path(__file__).resolve().parents[2]
def write(p,s): (root/p).write_text(s,encoding='utf-8')
tables={
'users': [('id','uuid','pk'),('email','varchar(254)','not null, unique'),('password_hash','text','not null'),('nickname','varchar(40)','not null'),('license_type','LicenseType','not null'),('created_at','timestamptz','not null')],
'auth_sessions':[('id','uuid','pk'),('user_id','uuid','not null, ref: > users.id'),('token_hash','text','not null, unique'),('expires_at','timestamptz','not null'),('revoked_at','timestamptz','')],
'official_sources':[('id','uuid','pk'),('title','text','not null'),('publisher','text','not null'),('url','text','not null'),('version','varchar(80)','not null'),('effective_from','date',''),('effective_to','date',''),('retrieved_at','timestamptz','not null'),('sha256','varchar(64)',''),('reuse_terms','text','not null'),('review_status','ReviewStatus','not null')],
'source_chunks':[('id','uuid','pk'),('source_id','uuid','not null, ref: > official_sources.id'),('locator','text','not null'),('content','text','not null')],
'guide_steps':[('id','uuid','pk'),('source_id','uuid','not null, ref: > official_sources.id'),('license_type','LicenseType','not null'),('step_order','int','not null'),('title','text','not null'),('content','text','not null')],
'categories':[('id','varchar(40)','pk'),('name_ko','varchar(80)','not null')],
'questions':[('id','uuid','pk'),('source_id','uuid','not null, ref: > official_sources.id'),('category_id','varchar(40)','not null, ref: > categories.id'),('source_number','varchar(80)','not null'),('kind','QuestionKind','not null'),('license_scope','varchar(20)','not null'),('prompt','text','not null'),('media_url','text',''),('points','int','not null'),('required_selections','int','not null'),('official_explanation','text',''),('review_status','ReviewStatus','not null')],
'question_options':[('id','uuid','pk'),('question_id','uuid','not null, ref: > questions.id'),('position','int','not null'),('content','text','not null'),('is_correct','boolean','not null')],
'written_attempts':[('id','uuid','pk'),('user_id','uuid','not null, ref: > users.id'),('license_type','LicenseType','not null'),('mode','varchar(20)','not null'),('status','AttemptStatus','not null'),('started_at','timestamptz','not null'),('submitted_at','timestamptz',''),('score','int',''),('max_score','int',''),('outcome','varchar(30)','')],
'attempt_questions':[('id','uuid','pk'),('attempt_id','uuid','not null, ref: > written_attempts.id'),('question_id','uuid','not null, ref: > questions.id'),('position','int','not null')],
'written_answers':[('id','uuid','pk'),('attempt_question_id','uuid','not null, unique, ref: > attempt_questions.id'),('is_correct','boolean',''),('earned_points','int',''),('updated_at','timestamptz','not null')],
'answer_selections':[('answer_id','uuid','not null, ref: > written_answers.id'),('option_id','uuid','not null, ref: > question_options.id')],
'official_scoring_rules':[('id','uuid','pk'),('source_id','uuid','not null, ref: > official_sources.id'),('category_id','varchar(40)','not null, ref: > categories.id'),('official_locator','text','not null'),('internal_code','varchar(40)','not null'),('name_ko','text','not null'),('description','text','not null'),('deduction_points','int',''),('is_disqualification','boolean','not null'),('support','SupportLevel','not null'),('limitations','text','not null'),('effective_from','date','not null'),('effective_to','date',''),('detector_version','varchar(60)',''),('enabled','boolean','not null')],
'scenarios':[('id','uuid','pk'),('kind','TrainingKind','not null'),('title','text','not null'),('version','varchar(40)','not null'),('definition','jsonb','not null')],
'scenario_rules':[('scenario_id','uuid','not null, ref: > scenarios.id'),('rule_id','uuid','not null, ref: > official_scoring_rules.id')],
'training_sessions':[('id','uuid','pk'),('user_id','uuid','not null, ref: > users.id'),('scenario_id','uuid','not null, ref: > scenarios.id'),('input_mode','varchar(20)','not null'),('calibration_snapshot','jsonb',''),('status','TrainingStatus','not null'),('verification_status','varchar(20)','not null'),('started_at','timestamptz','not null'),('ended_at','timestamptz',''),('input_log','jsonb',''),('score','int',''),('outcome','varchar(30)',''),('disqualification_rule_id','uuid','ref: > official_scoring_rules.id')],
'driving_events':[('id','uuid','pk'),('session_id','uuid','not null, ref: > training_sessions.id'),('rule_id','uuid','ref: > official_scoring_rules.id'),('category_id','varchar(40)','not null, ref: > categories.id'),('event_key','varchar(100)','not null'),('at_ms','int','not null'),('evidence','jsonb','not null'),('judgement','varchar(20)','not null'),('deducted_points','int','not null')],
'ai_jobs':[('id','uuid','pk'),('user_id','uuid','not null, ref: > users.id'),('kind','AiKind','not null'),('answer_id','uuid','ref: > written_answers.id'),('prompt','text',''),('status','AiStatus','not null'),('evidence_snapshot','jsonb','not null'),('result','jsonb',''),('model_version','varchar(80)',''),('prompt_version','varchar(40)','not null'),('error_code','varchar(40)',''),('created_at','timestamptz','not null')],
'ai_citations':[('id','uuid','pk'),('job_id','uuid','not null, ref: > ai_jobs.id'),('chunk_id','uuid','not null, ref: > source_chunks.id'),('claim_key','varchar(80)','not null')]
}
enums={'LicenseType':['CLASS1_ORDINARY','CLASS2_ORDINARY'],'ReviewStatus':['PENDING','APPROVED','REJECTED'],'QuestionKind':['OFFICIAL','PRACTICE','AI_GENERATED_PRACTICE'],'AttemptStatus':['IN_PROGRESS','SUBMITTED','ABORTED'],'SupportLevel':['A','B','C'],'TrainingKind':['FUNCTION','ROAD'],'TrainingStatus':['RUNNING','PAUSED','COMPLETED','DISQUALIFIED','ABORTED'],'AiKind':['EXPLANATION','REPORT','QA'],'AiStatus':['QUEUED','RUNNING','SUCCEEDED','INSUFFICIENT_DATA','INSUFFICIENT_EVIDENCE','FAILED']}
indexes={'question_options':['(question_id, position) [unique]'],'attempt_questions':['(attempt_id, position) [unique]','(attempt_id, question_id) [unique]'],'answer_selections':['(answer_id, option_id) [pk]'],'scenario_rules':['(scenario_id, rule_id) [pk]'],'driving_events':['(session_id, event_key) [unique]'],'written_attempts':['(user_id, started_at)'],'training_sessions':['(user_id, started_at)'],'official_sources':['(url, version) [unique]'],'official_scoring_rules':['(source_id, internal_code) [unique]'],'guide_steps':['(source_id, license_type, step_order) [unique]']}
s='// 승인 검토용 초안. 자동 파서 및 dbdiagram 렌더 검증 전.\nProject license_fit {\n database_type: \'PostgreSQL\'\n Note: \'웹 운전면허 학습. 규칙과 문항 버전은 불변, 과거 시도 보존.\'\n}\n'
for n,v in enums.items():s+='\nEnum '+n+' {\n'+'\n'.join('  '+x for x in v)+'\n}\n'
for n,cols in tables.items():
 s+='\nTable '+n+' {\n'+'\n'.join('  '+a+' '+b+(' ['+c+']' if c else '') for a,b,c in cols)+'\n'
 if n in indexes:s+='  indexes {\n'+'\n'.join('    '+x for x in indexes[n])+'\n  }\n'
 s+='}\n'
write('database/design.dbml',s)
write('docs/database-design.md','''# ERD 제안

승인 검토용 DBML: `database/design.dbml`. FUNCTION/ROAD는 같은 구조를 가지므로 training_sessions를 공통으로 사용하고 scenarios.kind로 구분한다. 별도 practice_sessions/road_sessions 중복 테이블을 만들지 않는다.

```mermaid
erDiagram
 users ||--o{ auth_sessions : 인증
 users ||--o{ written_attempts : 응시
 written_attempts ||--|{ attempt_questions : 출제
 questions ||--o{ attempt_questions : 문항버전
 questions ||--|{ question_options : 보기
 attempt_questions ||--o| written_answers : 답안
 written_answers ||--o{ answer_selections : 복수선택
 question_options ||--o{ answer_selections : 선택됨
 users ||--o{ training_sessions : 연습
 scenarios ||--o{ training_sessions : 코스버전
 scenarios ||--o{ scenario_rules : 규칙구성
 official_scoring_rules ||--o{ scenario_rules : 포함
 training_sessions ||--o{ driving_events : 사건
 official_scoring_rules ||--o{ driving_events : 판정근거
 official_sources ||--o{ official_scoring_rules : 법령버전
 official_sources ||--o{ questions : 문제은행
 official_sources ||--o{ source_chunks : 인용
 official_sources ||--o{ guide_steps : 안내
 users ||--o{ ai_jobs : AI요청
 ai_jobs ||--o{ ai_citations : 인용
 source_chunks ||--o{ ai_citations : 출처위치
```

## 무결성 계약

- 문항/보기/법령/코스 버전은 공개 이후 수정하지 않고 새 ID로 발행. 사용 중인 버전 삭제 금지.
- 중복 이메일은 소문자·정규화 정책을 고정한 뒤 unique. 비밀번호 해시·세션 토큰 해시는 응답에 노출하지 않는다.
- 선택 option은 해당 attempt_question의 question 소속이어야 한다. 기본 FK만으로 강제되지 않으므로 트랜잭션 검증/복합 FK로 구현 시 확정한다.
- 답안 제출·최종 채점은 한 트랜잭션. SUBMITTED 재제출은 같은 결과 반환, 다른 내용 수정은409.
- official_scoring_rules: 실격이면 deduction_points NULL, 감점이면 양수. enabled=true는 support=A이며 검증된 detector_version 필수. 기능 연습 사건은 rule_id 없이 기록 가능.
- 세션의 rule 목록은 불변 scenario_rules로 고정. driving_events.rule_id는 해당 세션 코스에 포함된 규칙이어야 한다.
- AI의 answer_id는 같은 사용자 답안만 허용. citations는 승인된 source_chunks만 연결.
- effective_to는 exclusive, NULL이면 종료일 없음. 새 법령 검수 시 이전 버전 종료일 기록.
- 점수·판정은 서버 계산. 함수 연습 score/outcome은 NULL이고 통계만 표시. ROAD의 검증 실패도 score NULL/UNVERIFIED.
- score 0–100 표시는 제품 표시 정책이며 원시 감점 합계는 사건으로 보존. 이것을 법령의 최저점 규정으로 주장하지 않는다.
- JSON: calibration_snapshot={offset,inverted,turn_threshold,return_threshold,protocol_version}; input_log={engine_version,frames:[{seq,t_ms,steering,drive}]}; evidence={position,speed_kmh,zone_id,signal_state,frame_seq}; ai evidence_snapshot={attempt_ids,session_ids,category_stats,coverage,source_ids}.
- JSON의 구체적 스키마·크기·보관 기간·삭제 정책은 구현 전 명세 확정 게이트. 원시 센서 값을 무기한 저장하지 않는다.

## 아직 검증하지 않은 것

DBML 도구 렌더, SQL 마이그레이션·CHECK/복합FK 실행은 미실행. 실제 DB를 만들지 않았다. 이는 관계와 영속 필드를 검토하기 위한 초안이다.
''')
# Screen contracts: screen, title, route, visible data, controls, error, APIs, tables, navigation
screens=[
('S01','서비스 소개','/','필기·주행 통합 학습 / 실차교육을 대체하지 않는 보조 도구','학습 시작; 면허 절차 보기','안내 로딩 실패: 원문 링크','GET /guide','guide_steps,official_sources','S02,S03,S05'),
('S02','회원가입','/signup','이메일 [입력]; 비밀번호 [입력]; 닉네임 [입력]; 1종/2종 보통 [선택]','가입; 로그인으로','400 형식 오류 /409 이메일 중복: 입력 유지','POST /auth/signup','users','S03'),
('S03','로그인','/login','이메일 [입력]; 비밀번호 [입력]','로그인; 회원가입','401 로그인 정보 확인 /429 잠시 후 재시도','POST /auth/login','users,auth_sessions','S04,S02'),
('S04','대시보드','/dashboard','닉네임; 면허종별; 필기 응시 수; 최근 점수; 연습 목록; AI 추천 상태','필기 시작; 기본조작; 도로 연습; AI 보고서; 로그아웃','401 로그인 이동 /기록 없음: 첫 학습 안내','GET /me; GET /dashboard; POST /auth/logout','users,written_attempts,training_sessions,ai_jobs','S06,S10,S13,S16,S03'),
('S05','면허 취득 안내','/license-guide','교육→신체검사→학과→기능→연습면허→도로주행→발급; 출처·시행일·조회일','면허 종류 선택; 공식 원문 열기; 학습 시작','출처 미확인: 해당 안내 비공개, 원문 링크','GET /guide?license_type=...','guide_steps,official_sources','S06,S01'),
('S06','필기 연습 설정','/written','면허종별; 주제; 연습/모의시험; 문제 출처 구분; 데이터 버전','연습 시작; 대시보드','503 검수 문제 없음 /409 모의시험 미지원 버전','GET /written/catalog; POST /written/attempts','categories,questions,written_attempts,attempt_questions','S07,S04'),
('S07','필기 문제','/written/{id}','문항 본문; 이미지; 보기; 선택 개수; 진행/남은 시간(앱 상태)','이전; 다음; 답안 저장; 최종 제출','저장 실패: 선택 보존·재시도 /409 이미 제출: 결과 이동','GET /written/attempts/{id}; PUT /written/attempts/{id}/answers/{questionId}; POST /written/attempts/{id}/submit','attempt_questions,questions,question_options,written_answers,answer_selections','S08'),
('S08','필기 결과','/written/result/{id}','점수/총점; 정답 수; 문제별 결과; 출처; 연습은 합격 판정 없음','오답 보기; 새 연습; 보고서','404 본인 결과 없음 /결과 조회 실패 재시도','GET /written/attempts/{id}/result','written_attempts,written_answers,questions','S09,S06,S16'),
('S09','오답·AI 해설','/written/review/{answerId}','문제; 내 선택; 검수 정답; 공식 해설; AI 설명; 인용 링크','AI 해설 요청; 다시 조회; 결과로','AI 실패: 공식 해설 유지 /근거 부족: 답변 유보','GET /written/answers/{id}; POST /ai/jobs; GET /ai/jobs/{id}','written_answers,answer_selections,question_options,ai_jobs,ai_citations,source_chunks','S08'),
('S10','센서 연결','/controller','연결 상태(기기); 센서/키보드 [선택]; 지원 브라우저 안내','장치 연결; 키보드 사용; 대시보드','미지원·권한 거절·포트 점유: 키보드 선택','브라우저 Web Serial; 서버 API 없음','앱/센서 상태만','S11,S04'),
('S11','중앙·좌우 점검','/controller/setup','CENTER / STOP; 3초 안정 측정; LEFT 확인; CENTER; RIGHT 확인; CENTER; READY','방향 반전; R 다시 점검; 시작(READY만)','불안정: 카운트 다시 /단절: 연결 화면','브라우저 로컬 상태; 시작 시 POST /training/sessions','training_sessions.calibration_snapshot','S12 또는 S14,S10'),
('S12','기본조작 연습','/practice','전진/정지/후진; LEFT/CENTER/RIGHT; 기본 주행 화면; 연습 사건 목록','키보드 W/S 전진·후진, A/D 조향; 센서 방향키 위/아래 전진·후진, MPU 조향; R 재시작; 일시정지; 종료','단절·blur: 즉시 정지/일시정지; 저장 실패: 재시도','POST /training/sessions; POST /training/sessions/{id}/complete; POST /training/sessions/{id}/abort','training_sessions,driving_events','S11,S16,S04'),
('S13','도로 연습 설정','/road','코스; 판정 규칙 버전; A/B/C 지원 목록; 일부 기준 평가 안내','컨트롤러 점검 후 시작; 기준 보기','검증된 자동 규칙 없음: 정보/연습 모드만','GET /scenarios?kind=ROAD; GET /scenarios/{id}/rules','scenarios,scenario_rules,official_scoring_rules,official_sources','S10,S11'),
('S14','도로주행 시뮬레이션','/road/session/{id}','주행 화면; 속도; 제한속도; 신호; 진행; 지원 규칙 점수(검증 전 잠정)','키보드 W/S/A/D; 센서 방향키 위/아래와 MPU 조향; R; 일시정지; 종료','실격: 즉시 정지→결과 /단절: 일시정지 /저장 실패: 미저장 표시','POST /training/sessions; POST /training/sessions/{id}/complete; POST /training/sessions/{id}/abort','training_sessions,scenarios,driving_events','S15,S11'),
('S15','도로 결과','/road/result/{id}','검증 상태; 점수; PASS/FAIL/DISQUALIFIED; 감점 목록; 실격 사유; 미측정 항목','재연습; 사건 근거 보기; AI 보고서','UNVERIFIED: 점수 숨김 /저장 실패: 재전송','GET /training/sessions/{id}','training_sessions,driving_events,official_scoring_rules,official_sources','S13,S16'),
('S16','AI 통합 학습 보고서','/report','취약영역; 실제 분자/분모; 근거 응시/세션; 추천 주제·다음 연습; 출처','보고서 생성; 상태 새로고침; 추천 연습','기록 부족 /AI timeout /근거 없는 주장은 노출하지 않음','POST /ai/jobs; GET /ai/jobs/{id}; GET /ai/jobs?kind=REPORT','ai_jobs,ai_citations,written_attempts,written_answers,training_sessions,driving_events','S06,S13,S17'),
('S17','공식 근거 Q&A','/assistant','질문 [입력]; 답변; 법령 시행일; 인용 위치','질문 보내기; 원문 열기; 대시보드','INSUFFICIENT_EVIDENCE: 확인 가능한 근거 없음 /timeout 재시도','POST /ai/jobs; GET /ai/jobs/{id}','ai_jobs,ai_citations,source_chunks,official_sources','S04')]
write('docs/evidence/screen-contracts.json',json.dumps(screens,ensure_ascii=False,indent=2))
flow='''# UI 흐름 — 승인 검토안

실제 화면 구현 전 와이어프레임이다. `ui-wireframes.html`에서 17개 화면의 콘텐츠·버튼·상태·오류를 검토할 수 있다. 아직 최종 PDF에 삽입되지 않았다.

```mermaid
flowchart TD
 S01[소개] --> S02[가입]
 S01 --> S03[로그인]
 S01 --> S05[면허 안내]
 S02 --> S03
 S03 --> S04[대시보드]
 S04 --> S06[필기 설정]
 S06 --> S07[문제]
 S07 --> S08[결과]
 S08 --> S09[오답·AI 해설]
 S04 --> S10[장치 선택]
 S10 --> S11[중앙·좌우 점검]
 S11 --> S12[기본조작]
 S04 --> S13[도로 설정]
 S13 --> S10
 S11 --> S14[도로주행]
 S14 --> S15[도로 결과]
 S08 --> S16[통합 보고서]
 S12 --> S16
 S15 --> S16
 S16 --> S06
 S16 --> S13
 S16 --> S17[Q&A]
 S11 -->|R| S11
 S12 -->|R| S11
 S14 -->|R| S11
 S14 -->|센서 단절| PAUSE[정지·재연결·재점검]
 PAUSE --> S11
```

셋업 화면은 returnTo와 scenario_id를 앱 상태로 유지한다. 새로고침으로 이 값이 없으면 대시보드/코스 선택으로 돌아간다. 단절 후 기존 주행의 자동 재개는 하지 않고 다시 점검한 새 시도로 기록한다.

## 공통 동작

로그인 성공 후 원래의 보호 화면으로 이동하되 내부 경로만 허용한다. 실패한 폼은 비밀번호를 제외한 값을 유지한다. 주행 결과 저장 실패 때 재시도 데이터는 동일 세션 ID로 보존하며 성공 전 ‘저장 완료’로 표시하지 않는다. API timeout은 자동 재시도해 중복 세션/AI 작업을 만들지 않도록 요청 ID를 사용한다.

'''
matrix='# UI → API → ERD 일관성 행렬\n\n모든 API는 /api/v1 접두사. UI 정적 문구·선택값·센서 상태는 서버 저장 없이 앱 상태로 표시 가능. 아래 표는 화면 수준이며 최종 명세 확정 때 필드별 스키마 대조를 추가한다.\n\n|UI/경로|표시·입력 데이터|서버 동작|영속 데이터/상태|이동|\n|---|---|---|---|---|\n'
htmls='''<!doctype html><html lang="ko"><meta charset="utf-8"><title>면허핏 설계 와이어프레임</title><style>body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;background:#edf1f7;color:#15243a;margin:0}header{background:#173a57;color:white;padding:32px}main{max-width:1180px;margin:auto;padding:24px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}a{color:#21658c}nav a{background:white;padding:8px;text-decoration:none;border-radius:5px}.screen{background:white;border:1px solid #bdc9d6;border-radius:12px;padding:24px;margin-bottom:28px;break-inside:avoid}.bar{display:flex;justify-content:space-between;color:#50647c;border-bottom:1px solid #d6dfe8;padding-bottom:12px}.body{display:grid;grid-template-columns:2fr 1fr;gap:28px}.field{padding:14px;background:#f4f7fb;border:1px solid #d7e0ea;margin:9px 0}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.btn{border:1px solid #226a86;background:#e7f3f7;padding:10px 14px;border-radius:6px}.error{border-left:4px solid #a76217;background:#fff4e5;padding:14px}.meta{font-size:13px;color:#596a7f;overflow-wrap:anywhere}.road{height:180px;background:#394957;position:relative;border:15px solid #89ab92;margin-top:10px;overflow:hidden}.road:before{content:'';display:block;position:absolute;left:48%;height:100%;border-left:4px dashed white}.car{position:absolute;background:#54c4e4;bottom:15px;left:60%;width:34px;height:62px;border:3px solid white;border-radius:9px}.signal{position:absolute;top:12px;right:20px;background:#ec6a6a;padding:8px;color:#151515}h2{margin:18px 0}footer{padding:24px;color:#596a7f}@media(max-width:700px){.body{display:block}}@media print{header,nav{display:none}.screen{page-break-after:always}body{background:white}main{padding:0}}</style><header><h1>면허핏 · UI 설계 검토</h1><p>필기에서 발견하고, 주행에서 연습하고, 근거로 복습합니다.</p><p>17개 화면 · 구현 전 와이어프레임 · 표시값은 필드 이름이며 실제 학습 결과가 아닙니다.</p></header><main><nav>'''
for x in screens:htmls+=f'<a href="#{x[0]}">{x[0]} {x[1]}</a>'
htmls+='</nav>'
for sid,title,route,data,actions,error,apis,entities,nav in screens:
 flow+=f'## {sid} {title} `{route}`\n\n- 표시/입력: {data}\n- 버튼/조작: {actions}\n- 오류: {error}\n- API: {apis}\n- 저장/상태: {entities}\n- 이동: {nav}\n\n'
 matrix+=f'|{sid} {route}|{data}|{apis}|{entities}|{nav}|\n'
 htmls+=f'<section class="screen" id="{sid}"><div class="bar"><strong>면허핏</strong><span>{sid} · {html.escape(route)}</span></div><h2>{title}</h2><div class="body"><div>'
 if sid in ['S12','S14']:htmls+='<div class="road"><div class="car"></div><span class="signal">신호 상태</span></div>'
 for f in data.split(';'):htmls+='<div class="field">'+html.escape(f.strip())+'</div>'
 htmls+='<div class="actions">'+''.join('<span class="btn">'+html.escape(a.strip())+'</span>' for a in actions.split(';'))+'</div></div><aside><h3>오류 / 복구</h3><div class="error">'+html.escape(error)+'</div><h3>다음 화면</h3>'
 for target in nav.replace(' 또는 ', ',').split(','):
  htmls+=f'<a href="#{target}">{target}</a> '
 htmls+='</aside></div><p class="meta">설계 주석 — '+html.escape(apis)+'</p><p class="meta">데이터 — '+html.escape(entities)+'</p></section>'
htmls+='</main><footer>설계 문서입니다. 폼 제출·주행·센서 연결은 동작하지 않습니다. 최종 PDF에는 화면별 캡처와 전체 이동 흐름을 포함할 예정입니다.</footer></html>'
write('docs/ui-flow.md',flow);write('docs/ui-api-erd-matrix.md',matrix);write('docs/ui-wireframes.html',htmls)
print('Wrote',len(tables),'tables and',len(screens),'screen contracts/wireframes.')
