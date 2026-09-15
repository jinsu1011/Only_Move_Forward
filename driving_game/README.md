# Sensor Drive

MPU-6050 → Arduino UNO → USB Serial → Python/Ursina로 조향하는 소형 1인칭 주행 게임입니다.
Arduino 없이도 키보드로 실행할 수 있습니다. 개발·실행 위치는 이 iCloud 프로젝트입니다.

## 실행 (macOS)

```bash
cd "/Users/kimjinsoo/Library/Mobile Documents/com~apple~CloudDocs/SKALA/개인프로젝트/driving_game"
.venv/bin/python main.py --keyboard
```

센서 자동 검색 및 보정:

```bash
.venv/bin/python main.py
```

자동 검색은 USB modem/serial 장치만 대상으로 합니다. 여러 장치가 있다면 포트를 지정하세요.

```bash
.venv/bin/python -m serial.tools.list_ports
.venv/bin/python main.py --port /dev/cu.usbmodemXXXX
```

`/dev/cu.usbmodemXXXX`는 위 목록의 실제 Arduino 포트로 바꿉니다.
Arduino 시리얼 모니터는 게임을 실행하기 전에 닫아야 합니다.
기존 `.venv`, 패키지 버전, `verify_setup.py`는 보존했습니다.

## 조작

| 입력 | 동작 |
|---|---|
| MPU roll | 좌우 조향 |
| MPU 앞으로 기울이기 | 가속 |
| MPU 뒤로 기울이기 | 전진 중 브레이크, 정지 후 후진 |
| W | 전진 가속 |
| S | 감속 후 후진 |
| Space | 강한 브레이크 |
| A / D | 키보드 좌/우 조향, 센서보다 우선 |
| C | 정지하고 중립 보정·네 방향 점검부터 다시 시작 |
| R | 어느 화면에서든 돈·차량·신호·AI·충돌·위반·파산과 보정·방향 점검 전체 초기화 |
| Enter / START 버튼 | 네 방향 점검 완료 후 중립 상태에서 주행 시작 |
| K / M | 설정 화면에서 키보드 / 센서 모드 선택 |
| X / F | 설정 화면에서 센서 좌우 / 앞뒤 방향 반전 후 재점검 |
| Esc | 종료 |

R은 모든 방향 점검 결과를 지우고, 현재 수신된 센서 자세를 즉시 새 중립 기준으로 잡아 CENTER / STOPPED로 돌아갑니다. 센서 값이 없으면 연결을 기다린 뒤 첫 유효 자세를 중립 기준으로 잡습니다. 센서가 끊기거나 최근 입력이 1초 동안 없으면 A/D로 조향할 수 있습니다.
센서를 다시 연결했다면 R로 설정 화면으로 돌아가 M을 눌러 센서 연결과 점검을 다시 시작하세요. 주행 중 수신이 끊기면 센서 가속 입력을 해제하고 W/S와 A/D로 조작할 수 있습니다.

## 센서 설정과 모의 실행

자동 연결 확인 → **중립 자세 3초 유지 및 roll/pitch 평균 저장** → **좌 → 우 → 앞 → 뒤** → 중립 복귀 → **START 버튼 또는 Enter** 순서입니다. 자동 출발하지 않습니다.

- 각 방향은 센서 약 10도 이상 또는 해당 키를 0.35초 이상 유지해야 통과합니다.
- 방향 통과 시 LEFT CONFIRMED, RIGHT CONFIRMED, FORWARD CONFIRMED, BACKWARD CONFIRMED를 표시합니다. 그 자세를 유지하는 동안 확정 표시가 유지되며, 중립으로 돌아온 뒤 다음 방향으로 넘어갑니다. 반대 방향·큰 대각선·순간 입력은 통과하지 않습니다.
- 중립 보정 중 각도 변화가 3도를 넘으면 카운트를 다시 시작합니다. 최소 30개의 새 샘플도 필요합니다.
- 점검이 끝나기 전에는 차량과 AI, 신호 시간이 진행되지 않습니다.
- 키보드 모드도 모든 키를 놓고 3초 유지한 다음 A → D → W → S 순서로 점검합니다. 각 키를 누른 다음 놓으세요.
- 센서가 없으면 약 5초 후 키보드 점검으로 전환합니다. K를 누르면 바로 키보드 점검을 선택할 수 있습니다.
- 좌우가 반대라면 X, 앞뒤가 반대라면 F를 눌러 방향을 바꾼 뒤 전체 점검을 다시 진행합니다.

```bash
.venv/bin/python main.py --mock --debug
.venv/bin/python sensor.py --mock --seconds 2
```

모의 센서는 좌/우 방향키로 roll, 위/아래 방향키로 pitch를 입력합니다. 방향키를 놓으면 중립입니다.
`--debug`에서만 원시 각도·중심값·연결·신호·좌표를 표시합니다. 설정 화면에는 해석한 방향만 표시합니다.

앞 기울기는 가속, 뒤 기울기는 브레이크/후진입니다. 중립에서는 가속을 해제하고 서서히 감속합니다. W/S 입력은 센서 가감속보다 우선하며 Space는 강한 브레이크입니다.

현재 보드의 `WME,시간,각도1,각도2,추가값` 형식을 직접 읽도록 호환 처리를 추가했습니다. 세 번째·네 번째 값을 roll/pitch 후보로 해석합니다. 기존 펌웨어 소스를 확보하지 못했으므로 실제 물리적 축·방향 일치는 네 방향 실기 점검으로 확인해야 합니다.
새 스케치의 `roll,pitch` 형식도 지원합니다. 예전 roll 한 값만 보내는 펌웨어는 앞뒤를 점검할 수 없어 센서 모드의 START를 허용하지 않습니다.

센서 단독 실기 확인:

```bash
.venv/bin/python sensor.py --port /dev/cu.usbmodemXXXX --seconds 10
```

## Arduino 업로드

현재 환경에서는 Arduino IDE와 `arduino-cli`를 발견하지 못했습니다. 아래 업로드와 실제 보드 검증은 수행하지 않았습니다.

1. Arduino IDE를 준비하고 UNO용 Arduino AVR Boards를 설치합니다.
2. `arduino/mpu6050_controller.ino`를 엽니다. IDE가 같은 이름의 스케치 폴더 생성을 안내하면 `mpu6050_controller` 폴더에 저장합니다. Arduino는 스케치 폴더와 주 `.ino` 파일 이름이 같아야 합니다.
3. 보드는 **Arduino Uno**, 포트는 연결된 UNO USB 포트를 선택합니다.
4. 먼저 `TEST_MODE = true`로 설정하고 검증/업로드합니다.
5. 시리얼 모니터를 **115200 baud**로 열고 MPU-6050 감지 메시지와 `roll=... pitch=...` 출력, 좌우 움직임을 확인합니다.
6. 게임용으로 `TEST_MODE = false`로 되돌려 다시 업로드합니다. 이 모드에서는 `roll,pitch` 두 숫자를 쉼표로 구분해 줄마다 전송합니다. 앞뒤 점검과 가감속에 pitch가 필요합니다.
7. 시리얼 모니터를 닫고 Python 게임을 실행합니다.

추가 MPU 라이브러리는 필요 없고 AVR 코어의 `Wire`를 사용합니다. 코드는 0x68/0x69 주소와 WHO_AM_I를 확인하고, 가속도계로 roll/pitch를 계산합니다. 약 50 Hz 전송이며 보정·평활화는 Python에서 수행합니다.

사용자가 지정한 배선:

| GY-521 | UNO R3 |
|---|---|
| VCC | 5V |
| GND | GND |
| SDA | A4 |
| SCL | A5 |

안전에 영향을 주는 가정: 이 배선은 사용자가 지정한 GY-521 모듈 기준이며, 실제 보드의 5V 전원 지원 여부와 배선 상태는 실물로 확인하지 못했습니다.
좌우가 반대이면 `config.py`의 `STEERING_SIGN`을 `-1.0`으로 변경합니다.

## 게임과 설정

- 직선·곡선이 이어지는 폐쇄 루프, 교차로, 자동 신호등, 정지선·차선·횡단보도, 가드레일·가로등·건물·간단한 장애물이 있습니다.
- 다른 차량은 고정 경로를 순환합니다. 복잡한 교통 판단은 하지 않습니다.
- 신호 위반은 시작 지점에서 정면 교차로로 접근할 때의 정지선을 기준으로 판정합니다. 빨간불에 통과하면 $500 차감하며, 같은 통과를 반복 부과하지 않습니다.
- 다른 차량 충돌은 CRASH!, 시설물 충돌은 PROPERTY DAMAGE와 함께 $1,000 차감합니다. 충돌 대기시간은 1.5초입니다.
- 시작 금액 $0, 기본 파산 기준은 -$5,000 이하입니다. 실제 누적 부채를 파산 화면에 표시합니다.
- 파산 시 주행과 게임 진행이 멈추며 R로 초기화합니다.
- HUD는 속도(km/h), 돈/부채, 조향 비율만 표시합니다. 부채는 빨간색입니다.

위 금액, 파산 기준, 조향 데드존 4도, 최대 조향 기울기 30도·가감속 기울기 25도, 평활화, 속도·가속도·신호 시간은 `config.py`에서 변경할 수 있습니다.
Mac에서 사용되는 기본 GLSL 버전·UI 카메라 범위·글꼴 외곽선의 호환 문제는 `main.py`에서 처리하며 설치된 라이브러리 파일은 수정하지 않습니다.

## 검증 재실행

```bash
.venv/bin/python verify_setup.py
.venv/bin/python -m unittest -v test_game
.venv/bin/python -m py_compile config.py sensor.py car.py traffic_light.py world.py main.py test_game.py
.venv/bin/python main.py --keyboard --smoke-test --screenshot verification/game.png
```

창을 띄우지 않고 동일한 통합 검증을 하려면 마지막 명령에 `--offscreen`을 추가합니다.
`--smoke-test`는 입력·벌금·충돌·파산·재시작·모의 센서 보정을 자동 실행하고 종료합니다.
이는 실제 손으로 키를 누른 조작 시험과 USB 센서 실기 시험을 대체하지 않습니다.

## 검증 결과 (2026-09-15)

| 항목 | 명령/검사 | 결과 | 실물 확인 잔여 |
|---|---|---|---|
| 기존 환경 | `verify_setup.py` | PHASE 1 PYTHON SETUP: OK; Python 3.14.6 / Ursina 8.3.0 / pyserial 3.5 | 없음 |
| 문법 | `python -m py_compile` 위 파일 목록 | 종료 코드 0 | 없음 |
| 센서·게임 규칙 | `python -m unittest -v test_game` | Ran 21 tests; OK | 센서 실기 별도 |
| 시리얼 모의 입력 | `sensor.py --mock`와 pyserial loop:// 테스트 | 입력·부분 줄·잘못된 값·연결 해제 처리 통과 | USB 실제 수신 |
| 실제 창 통합 | `main.py --keyboard --smoke-test ...` | SETUP INTEGRATION / PITCH DRIVE / RENDERED INTEGRATION / GUI SMOKE 모두 PASS; 종료 코드 0 | 센서 실기 별도 |
| 시각 검증 | verification PNG 직접 확인 | 기본 HUD, 보정, 신호 벌금, 파산 화면 확인 | 없음 |
| Arduino 도구 | `command -v arduino-cli`, Applications 확인 | 발견되지 않음; 스케치 컴파일 미실행 | 도구 설치 필요 |
| Arduino USB | `python -m serial.tools.list_ports` | `/dev/cu.usbmodem101` 발견, 실제 두 축 유효 샘플 70개 수신 | 물리 방향 일치 확인 |
| 실제 방향·신규 스케치 업로드 | 기존 펌웨어 데이터 수신 확인; 물리 방향은 미검증 | **좌우·앞뒤 실기 점검 대기** | 있음 |

최신 실행 로그는 `verification/confirmation-tests.log`, `verification/confirmation-integration.log`에 있습니다. 최신 화면은 `verification/confirmation*.png`입니다. 기존 game*.png와 기존 로그는 이전 검증 기록입니다. 실행에 영향을 주지 않는 번들 PNG 색상 프로파일 경고가 남습니다. 오프스크린 실행에서는 framebuffer 속성 경고도 발생하지만 화면 저장과 검증은 통과했습니다.

미충족 사항: 요청한 소프트웨어 기능 미구현은 없음. 실제 보드의 두 축 데이터 수신은 확인했습니다. 물리적 좌우·앞뒤 동작 일치는 설정 화면에서 사용자가 움직여 확인해야 합니다. 신규 Arduino 스케치는 컴파일·업로드하지 않았으며, 현재 보드의 WME 출력을 호환 처리해 사용합니다.

## 프로젝트 구조

```text
driving_game/
├── .gitignore
├── .venv/
├── requirements.txt
├── verify_setup.py
├── config.py
├── sensor.py
├── car.py
├── traffic_light.py
├── world.py
├── main.py
├── test_game.py
├── README.md
├── arduino/
│   ├── .gitkeep
│   └── mpu6050_controller.ino
└── verification/
    ├── tests.log
    ├── integration.log
    ├── game.png
    ├── game-center.png
    ├── game-red-light.png
    └── game-game-over.png
```

실행 시 `__pycache__/`가 생성될 수 있습니다.
