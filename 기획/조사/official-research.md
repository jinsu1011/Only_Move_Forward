# 공식 자료 조사 — 2026-09-15

## 면허 과정과 학원

[공단 시험순서](https://www.safedriving.or.kr/dtGuide/selectDtGuide01.do): 응시 전 교통안전교육 → 신체검사 → 학과시험 → 기능시험 → 연습면허 → 도로주행 → 면허 발급. 최초 1·2종 보통 취득자 기준. 기존 면허 등 면제 대상은 별도 안내로 연결한다. 신체검사는 [학과 안내](https://www.safedriving.or.kr/dtGuide/selectDtGuide08.do)의 건강검진 결과 활용 가능 여부도 함께 안내한다.

[시행규칙 별표32](https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110201&flSeq=158860089&gubun=), 2025-12-02 개정본에서 전문학원의 학과·기능·도로주행 교육 구조를 확인했다. 보통 표준표는 3/4/6시간이나 같은 별표의 조정·면제 규정이 있으므로 모든 사람에게 고정 총시간으로 안내하지 않는다. 학원 개별 가격·시간표는 전국 기준으로 사용하지 않는다. 출시 전 제106조와 별표32 최신 시행 연결 추가 확인 필요.

## 학과와 도로주행

[학과 공식 안내](https://www.safedriving.or.kr/dtGuide/selectDtGuide08.do): 객관식 40문제, 기본 40분. 1종 보통 70점 이상, 2종 보통 60점 이상. 장애 등 별도 지원 시험은 별도 조건. 문항 배점·복수 정답은 데이터 원문에 따라 저장하고 단순 정답률을 공식 점수로 표시하지 않는다.

[도로주행 공식 안내](https://www.safedriving.or.kr/dtGuide/selectDtGuide11.do): 1·2종 보통, 합격70점, 57개 평가 항목. [별표26](https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110201&flSeq=161794629)의 감점46/실격11 전체 목록과 지원 분류는 road-test-coverage.md 참조. 법령 PDF는 원문을 로컬 보존했으며 현재 시행 조문과 함께 버전 기록했다.

## 문제은행과 이용 조건

[한국어 문제은행 게시 목록](https://www.safedriving.or.kr/subExamBoard/selectSubExamBoardKorList.do?menuCd=MN-PO-1151)에서 2026-03-09 시행, 2026-01-29 등록된 1·2종 보통/대형·특수 자료를 확인했다.

[공공데이터포털 15054986](https://www.data.go.kr/data/15054986/fileData.do)은 기관 다운로드 PDF와 ‘이용허락범위 제한 없음’을 표시한다. 다만 카탈로그 파일명은 20220718, 수정일은 2025-09-15여서 2026 파일 자체의 권리 표시 및 첨부물 동일성 검증까지 끝났다고 볼 수 없다. 이번 단계에서는 전체 문제 DB를 복제하지 않았다.

구현 전 게이트: 2026 첨부 원문 확보→파일별 이용 조건(사진/영상 포함) 확인→문항/보기/정답/배점/면허종별 검수→검수 승인 버전만 공개. 미완료 시 공식 문제는 원문 링크, 자체 검수 문제는 PRACTICE로 표시한다. AI 생성 문항은 AI_GENERATED_PRACTICE로 분리하며 MVP 자동 출제에서 제외한다.

## 실제 공공 API / 데이터

|제공자·공식 이름|엔드포인트/자료|인증·호출 제한|이용 조건|활용 결정|
|---|---|---|---|---|
|법제처·현행법령(공포일) 목록 조회 API|http://www.law.go.kr/DRF/lawSearch.do?target=law|OC 등 공식 요청변수, 서비스 신청 필요. 계정별 제한 수치는 확인 전|공동활용 이용약관 추가 확인|법령 갱신 확인 후보. 런타임 의존 대신 승인 스냅샷|
|공단·운전면허 학과시험 1종 대형 특수 및 1종 보통 2종 보통 문제은행|data.go.kr/data/15054986/fileData.do → 공단 PDF|파일 다운로드. API 인증/호출량 개념 해당 없음|포털 제한 없음, 최신 첨부 개별 권리 확인 필요|검수 후 자체 DB import|
|공단·화물차 교통사고 다발지역|data.go.kr/data/15113414/openapi.do → opendata.koroad.or.kr/api/sample.do|JSON/XML LINK API 존재 확인. 상세 페이지 접근 오류로 실제 호출 경로·키·한도 미확인|포털 상세 조건 추가 확인|MVP 제외: 면허 학습 핵심과 거리 있음|

[법제처 API 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do), [교통사고 API 카탈로그](https://www.data.go.kr/data/15113414/openapi.do).
공식 실시간 채점 API, 공식 정답 판정 API는 이번 조사에서 확인하지 못했다. 존재한다고 가정하지 않는다. 데이터베이스와 검수된 규칙으로 처리한다. 미확인 API 인증키·호출 한도는 발명하지 않는다.

## 미해결 사항

최신 문제은행 첨부물/이미지 권리 검수, 법령 API 계약·한도, 별표32 현행 연결, F08 경계와 정지 관련 규정 중첩. 이 항목은 배포용 데이터 승인 게이트다. 출처를 확보하지 못한 내용은 AI 근거 검색에 포함하지 않는다.
