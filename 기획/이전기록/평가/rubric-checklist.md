# 평가 체크리스트

출처: `참고자료/9반_평가기준.pdf` 전체, 과제 안내 마지막 상세 기준표. 총 100점=목표30+설계40(DB20/API20)+납기20+발표10. 행별 임의 배점을 만들지 않는다. 보안 스킴은 채점 제외지만 제품 인증 설계는 유지한다.

상태는 제출 산출물 기준이다. 문서 초안 작성만으로 VERIFIED 처리하지 않는다. TODO→IN PROGRESS→DONE→실물 검토 후 VERIFIED.

|ID|평가 영역|배점|요구사항|충족 위치|UI|엔티티|API|산출물|상태|
|---|---|---|---|---|---|---|---|---|---|
|G01|목표 시스템 정의|30 (영역 합계)|목표·대상·핵심가치 명확|design-report §서비스|S01|users|GET /me|개요 PDF|IN PROGRESS|
|G02|목표 시스템 정의|영역 내 별도 배점 없음|문제의 원인·배경·현황을 구체화, 검증 안 된 시장 수치 금지|design-report §문제|S01,S04|없음|없음|개요 PDF|IN PROGRESS|
|G03|목표 시스템 정의|동일|기능의 필요성과 목표 연결, 개념↔요구사항 일관성|design-report §범위|전체|전체|전체|개요 PDF|IN PROGRESS|
|G04|목표 시스템 정의|동일|액터·역할·상세 요구 기능 정의|design-report §액터|전체|users|인증/학습 API|개요 PDF|IN PROGRESS|
|G05|목표 시스템 정의|동일|실현 가능한 규모, 불필요한 기능 제외|design-report §범위|전체|전체|전체|개요 PDF|IN PROGRESS|
|U01|UI 흐름|목표 정의 영역, 독립 배점 미명시|모든 주요 요구를 화면과 이동으로 제시|ui-flow|전체|전체|전체|개요 PDF|IN PROGRESS|
|U02|UI 흐름|동일|화면별 의미 있는 텍스트·버튼·입력·표시값|ui-flow|전체|matrix|matrix|개요 PDF|IN PROGRESS|
|U03|UI 흐름|동일|중요 오류/예외 시나리오 표현|ui-flow|전체|matrix|400/401/403/404/409/503|개요 PDF|IN PROGRESS|
|U04|UI 흐름|동일|UI 필드와 API 데이터 연결|ui-api-erd-matrix|전체|전체|전체|개요 PDF|IN PROGRESS|
|D01|데이터 모델|20 (영역 합계)|서비스에 필요한 개체 완전성|제출/design.dbml|전체|전체|전체|DB.dbml|IN PROGRESS|
|D02|데이터 모델|영역 내 별도 배점 없음|모든 영속 UI 데이터 필드 존재|ui-api-erd-matrix|전체|전체|전체|DB.dbml|IN PROGRESS|
|D03|데이터 모델|동일|PK/FK·1:N·M:N 관계 명확|제출/design.dbml|전체|전체|전체|DB.dbml|IN PROGRESS|
|D04|데이터 모델|동일|적절한 타입·제약·중복 방지|제출/design.dbml|전체|전체|전체|DB.dbml|IN PROGRESS|
|D05|데이터 모델|동일|API 요청·응답과 ERD 일치|ui-api-erd-matrix|전체|전체|전체|DB.dbml/API.yml|IN PROGRESS|
|D06|데이터 모델|동일|dbdiagram.io에서 오류 없이 렌더링|final-quality-audit|해당 없음|전체|해당 없음|DB.dbml|IN PROGRESS|
|A01|API 설계|20 (영역 합계)|모든 서버 기능·화면 동작의 API 정의|제출/design.yml|전체|전체|전체|API.yml|IN PROGRESS|
|A02|API 설계|영역 내 별도 배점 없음|요청·응답 구조와 데이터 모델 정합|ui-api-erd-matrix|전체|전체|전체|API.yml|IN PROGRESS|
|A03|API 설계|동일|HTTP method/path/query/body 구분|제출/design.yml|전체|전체|전체|API.yml|IN PROGRESS|
|A04|API 설계|동일|상황별 오류 코드와 메시지|제출/design.yml|오류 화면|해당 엔티티|오류 응답|API.yml|IN PROGRESS|
|A05|API 설계|동일|공통 schema/response $ref 재사용|제출/design.yml|전체|전체|components|API.yml|IN PROGRESS|
|A06|API 설계|동일|OpenAPI 3.x Swagger UI 무오류|final-quality-audit|해당 없음|해당 없음|전체|API.yml|IN PROGRESS|
|T01|납기|20|세 산출물 완비, 최종 업로드 9/17 13:40 이내|reference-review|해당 없음|해당 없음|해당 없음|세 파일|TODO|
|T02|납기|영역 내|반_고유번호_이름_프로젝트명 형식과 확장자|final-quality-audit|해당 없음|해당 없음|해당 없음|세 파일|TODO|
|T03|납기|영역 내|PDF 안에 UI 흐름 캡처 포함|final-quality-audit|전체|ERD 그림|API 요약|개요 PDF|TODO|
|P01|발표|6|문제→서비스→화면→데이터/API→설계 선택·향후 과제를 명료하게 전달|presentation-plan|주요 화면|주요 관계|주요 흐름|개요 PDF|TODO|
|P02|발표|4|5분 제한, 4:30–5:00 목표로 리허설|presentation-plan|해당 없음|해당 없음|해당 없음|개요 PDF|TODO|
