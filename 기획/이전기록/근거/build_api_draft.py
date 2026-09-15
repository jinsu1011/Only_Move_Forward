from pathlib import Path
import json,runpy
r=Path(__file__).resolve().parents[2]
meta=runpy.run_path(str(r/'docs/evidence/build_design_drafts.py'))
schemas={}
for name,fields in meta['tables'].items():
 props={}
 for n,t,c in fields:
  if n in ['password_hash','token_hash','input_log','is_correct'] and name in ['users','auth_sessions','question_options','training_sessions']:continue
  p={'type':'string'}
  if t in ['int','boolean','jsonb']:p={'type':{'int':'integer','boolean':'boolean','jsonb':'object'}[t]}
  if t=='uuid':p['format']='uuid'
  if t=='timestamptz':p['format']='date-time'
  if t=='date':p['format']='date'
  if t in meta['enums']:p['enum']=meta['enums'][t]
  if 'not null' not in c and 'pk' not in c:p['nullable']=True
  props[n]=p
 schemas[name]={'type':'object','properties':props,'description':'설계 초안: 대응 DB 테이블의 공개 필드. 상세 required/읽기·쓰기 구분은 명세 확정 게이트.'}
def ref(n):return {'$ref':'#/components/schemas/'+n}
def arr(n):return {'type':'array','items':ref(n)}
def obj(p,req=None):return {'type':'object','properties':p,**({'required':req} if req else {})}
S={'type':'string'};I={'type':'integer'};UUID={'type':'string','format':'uuid'}
schemas.update({
'Error':obj({'code':S,'message':S,'request_id':UUID},['code','message','request_id']),
'Signup':obj({'email':{'type':'string','format':'email'},'password':{'type':'string','format':'password','writeOnly':True},'nickname':S,'license_type':{'type':'string','enum':meta['enums']['LicenseType']}},['email','password','nickname','license_type']),
'Login':obj({'email':{'type':'string','format':'email'},'password':{'type':'string','format':'password','writeOnly':True}},['email','password']),
'CategoryStats':obj({'category_id':S,'correct_count':I,'answer_count':I,'event_count':I},['category_id','correct_count','answer_count','event_count']),
'Dashboard':obj({'user':ref('users'),'written_count':I,'recent_attempts':arr('written_attempts'),'recent_sessions':arr('training_sessions'),'recent_reports':arr('ai_jobs')},['user','written_count','recent_attempts','recent_sessions','recent_reports']),
'Guide':obj({'steps':arr('guide_steps'),'sources':arr('official_sources')},['steps','sources']),
'WrittenCatalog':obj({'categories':arr('categories'),'sources':arr('official_sources'),'mock_exam_available':{'type':'boolean'}},['categories','sources','mock_exam_available']),
'AttemptCreate':obj({'license_type':{'type':'string','enum':meta['enums']['LicenseType']},'mode':{'type':'string','enum':['PRACTICE','MOCK_EXAM']},'category_id':S},['license_type','mode']),
'QuestionPublic':obj({'question':ref('questions'),'options':arr('question_options'),'position':I},['question','options','position']),
'AttemptDetail':obj({'attempt':ref('written_attempts'),'questions':arr('QuestionPublic'),'saved_answers':{'type':'array','items':obj({'question_id':UUID,'option_ids':{'type':'array','items':UUID}},['question_id','option_ids'])}},['attempt','questions','saved_answers']),
'AnswerWrite':obj({'option_ids':{'type':'array','items':UUID,'uniqueItems':True}},['option_ids']),
'AnswerReview':obj({'answer':ref('written_answers'),'question':ref('questions'),'options':arr('question_options'),'selected_option_ids':{'type':'array','items':UUID},'correct_option_ids':{'type':'array','items':UUID},'source':ref('official_sources')},['answer','question','options','selected_option_ids','correct_option_ids','source']),
'WrittenResult':obj({'attempt':ref('written_attempts'),'answers':arr('AnswerReview'),'category_stats':arr('CategoryStats')},['attempt','answers','category_stats']),
'Rules':obj({'scenario':ref('scenarios'),'rules':arr('official_scoring_rules'),'sources':arr('official_sources')},['scenario','rules','sources']),
'Calibration':obj({'offset':{'type':'number'},'inverted':{'type':'boolean'},'turn_threshold':{'type':'number'},'return_threshold':{'type':'number'},'protocol_version':S},['offset','inverted','turn_threshold','return_threshold','protocol_version']),
'TrainingCreate':obj({'scenario_id':UUID,'input_mode':{'type':'string','enum':['SENSOR','KEYBOARD']},'calibration_snapshot':ref('Calibration')},['scenario_id','input_mode']),
'InputFrame':obj({'seq':{'type':'integer','minimum':0},'t_ms':{'type':'integer','minimum':0},'steering':{'type':'integer','enum':[-1,0,1]},'drive':{'type':'string','enum':['FORWARD','STOP','REVERSE']}},['seq','t_ms','steering','drive']),
'TrainingComplete':obj({'engine_version':S,'frames':arr('InputFrame')},['engine_version','frames']),
'TrainingResult':obj({'session':ref('training_sessions'),'events':arr('driving_events'),'rules':arr('official_scoring_rules'),'sources':arr('official_sources')},['session','events','rules','sources']),
'AiCreate':obj({'kind':{'type':'string','enum':['EXPLANATION','REPORT','QA']},'answer_id':UUID,'prompt':{'type':'string','maxLength':2000}},['kind']),
'AiResult':obj({'job':ref('ai_jobs'),'citations':arr('ai_citations'),'chunks':arr('source_chunks'),'sources':arr('official_sources')},['job','citations','chunks','sources']),
})
# Never disclose official explanation during an in-progress attempt.
schemas['QuestionPublic']['properties']['question']=obj({k:v for k,v in schemas['questions']['properties'].items() if k not in ['official_explanation','review_status']})
# path, method, operation id, summary, request, response, status, public, errors
ops=[
('/auth/signup','post','signup','회원가입','Signup','users',201,True,[400,409,429]),
('/auth/login','post','login','로그인·세션 쿠키 발급','Login','users',200,True,[400,401,429]),
('/auth/logout','post','logout','현재 세션 폐기',None,None,204,False,[401,403]),
('/me','get','getMe','내 공개 프로필',None,'users',200,False,[401]),
('/dashboard','get','getDashboard','내 학습 요약',None,'Dashboard',200,False,[401]),
('/guide','get','getGuide','면허종별 공식 안내',None,'Guide',200,True,[400,503]),
('/written/catalog','get','getWrittenCatalog','검수된 연습 자료 목록',None,'WrittenCatalog',200,False,[401,503]),
('/written/attempts','post','createAttempt','새 필기 시도','AttemptCreate','AttemptDetail',201,False,[400,401,409,503]),
('/written/attempts/{id}','get','getAttempt','진행 중 문항·저장 답안',None,'AttemptDetail',200,False,[401,404]),
('/written/attempts/{id}/answers/{questionId}','put','saveAnswer','선택 답안 저장','AnswerWrite','AnswerWrite',200,False,[400,401,404,409]),
('/written/attempts/{id}/submit','post','submitAttempt','서버 정답 채점·제출 확정',None,'WrittenResult',200,False,[401,404,409]),
('/written/attempts/{id}/result','get','getWrittenResult','본인 제출 결과',None,'WrittenResult',200,False,[401,404,409]),
('/written/answers/{id}','get','reviewAnswer','제출된 답안의 검수 정답·해설',None,'AnswerReview',200,False,[401,404,409]),
('/scenarios','get','listScenarios','연습 가능한 코스',None,'scenarios',200,False,[400,401]),
('/scenarios/{id}/rules','get','getRules','코스 버전과 지원 규칙',None,'Rules',200,False,[401,404]),
('/training/sessions','post','startTraining','새 주행 시도','TrainingCreate','training_sessions',201,False,[400,401,409]),
('/training/sessions/{id}/complete','post','completeTraining','입력 검증 후 서버 판정','TrainingComplete','TrainingResult',200,False,[400,401,404,409,413]),
('/training/sessions/{id}/abort','post','abortTraining','R 재시작 등으로 기존 시도 중단',None,'training_sessions',200,False,[401,404,409]),
('/training/sessions/{id}','get','getTraining','본인 주행 결과',None,'TrainingResult',200,False,[401,404]),
('/ai/jobs','post','createAiJob','AI 해설·보고서·Q&A 요청','AiCreate','ai_jobs',202,False,[400,401,404,409,429,503]),
('/ai/jobs','get','listAiJobs','본인 AI 작업 이력',None,'ai_jobs',200,False,[400,401]),
('/ai/jobs/{id}','get','getAiJob','작업 상태·답변·출처',None,'AiResult',200,False,[401,404])]
paths={}
for path,method,oid,summary,req,res,status,public,errors in ops:
 op={'operationId':oid,'tags':[path.split('/')[1]],'summary':summary,'description':'구현 전 설계 초안. 소유권을 세션 사용자로 검증한다. 정답·점수는 서버 계산. 세부 조건은 docs/api-design.md 참조.','responses':{str(status):{'description':'처리 성공'}}}
 if public:op['security']=[]
 if res:
  sch=arr(res) if oid in ['listScenarios','listAiJobs'] else ref(res)
  op['responses'][str(status)]['content']={'application/json':{'schema':sch}}
 for e in errors:op['responses'][str(e)]={'$ref':f'#/components/responses/E{e}'}
 if method in ['post','put'] and not public:op['responses']['403']={'$ref':'#/components/responses/E403'}
 if req:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(req)}}}
 params=[]
 import re
 for name in re.findall(r'\{(.*?)\}',path):params.append({'name':name,'in':'path','required':True,'schema':UUID})
 if oid=='getGuide':params.append({'name':'license_type','in':'query','required':True,'schema':{'type':'string','enum':meta['enums']['LicenseType']}})
 if oid=='listScenarios':params.append({'name':'kind','in':'query','required':True,'schema':{'type':'string','enum':['FUNCTION','ROAD']}})
 if oid=='listAiJobs':params.extend([{'name':'kind','in':'query','schema':{'type':'string','enum':['REPORT','QA','EXPLANATION']}},{'name':'limit','in':'query','schema':{'type':'integer','default':20,'minimum':1,'maximum':100}},{'name':'before','in':'query','schema':{'type':'string','format':'date-time'}}])
 if oid in ['createAttempt','startTraining','createAiJob']:params.append({'name':'Idempotency-Key','in':'header','required':True,'schema':UUID})
 if params:op['parameters']=params
 paths.setdefault(path,{})[method]=op
responses={f'E{n}':{'description':text,'content':{'application/json':{'schema':ref('Error'),'example':{'code':code,'message':text,'request_id':'11111111-1111-4111-8111-111111111111'}}}} for n,text,code in [(400,'요청 값 오류','INVALID_INPUT'),(401,'로그인 필요','UNAUTHENTICATED'),(403,'요청 출처·CSRF 검증 실패','FORBIDDEN'),(404,'리소스 없음 또는 본인 자료 아님','NOT_FOUND'),(409,'현재 상태와 충돌','STATE_CONFLICT'),(413,'기록 크기 초과','PAYLOAD_TOO_LARGE'),(429,'요청 제한','RATE_LIMITED'),(503,'자료 또는 AI 서비스 일시 불가','UNAVAILABLE')]}
spec={'openapi':'3.0.3','info':{'title':'면허핏 설계 검토 API','version':'0.1.0-draft','description':'구현 전 제안. 최종 제출용 검증 및 세부 제약 확정 전.'},'servers':[{'url':'/api/v1'}],'tags':[{'name':x} for x in sorted({p.split('/')[1] for p in paths})],'security':[{'sessionCookie':[]}],'paths':paths,'components':{'securitySchemes':{'sessionCookie':{'type':'apiKey','in':'cookie','name':'session'}},'schemas':schemas,'responses':responses}}
(r/'api/design.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2))
text='''# API 계약 제안

접두사 `/api/v1`, JSON, 세션 쿠키 인증. `api/design.yml`은 OpenAPI 3.0.3 승인 검토 초안이다. Swagger 렌더 검증 전이며 최종 제출본이 아니다.

|메서드·경로|동작|요청 schema|성공 응답|오류|
|---|---|---|---|---|
'''
for path,method,oid,summary,req,res,status,pub,errs in ops:text+=f'|{method.upper()} {path}|{summary}|{req or "본문 없음"}|{status} {res or "본문 없음"}|'+','.join(map(str,errs))+'|\n'
text+='''
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
'''
(r/'docs/api-design.md').write_text(text)
# Necessary request persistence, not a user-facing feature.
with (r/'database/design.dbml').open('a') as f:f.write('''\nTable idempotency_keys {\n id uuid [pk]\n user_id uuid [not null, ref: > users.id]\n path varchar(120) [not null]\n request_key uuid [not null]\n body_hash varchar(64) [not null]\n response jsonb [not null]\n expires_at timestamptz [not null]\n indexes {\n  (user_id, path, request_key) [unique]\n }\n}\n''')
print('API draft:',len(paths),'paths,',len(ops),'operations,',len(schemas),'schemas')
