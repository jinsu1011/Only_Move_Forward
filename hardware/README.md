# 센서 핸들 (Arduino UNO + MPU-6050)

## 배선

| MPU-6050 | UNO |
|---|---|
| VCC | 5V (모듈 레귤레이터 사양 확인) |
| GND | GND |
| SDA | A4 |
| SCL | A5 |

## 출력

115200 baud, 50Hz: `WME,<경과ms>,<roll>,<pitch>,<yaw>`. 시작 시 약 2초 자이로 영점(`INFO,KEEP_STILL_CALIBRATING` → `INFO,READY`), 오류는 `ERR,<사유>`.

웹은 roll(좌우 기울기)만 조향에 쓴다. pitch·yaw 는 쓰지 않는다. 기존 프로토타입 형식 `roll,pitch` 도 인식한다.

## 민감도

roll 은 가속도로 계산해 손떨림·충격에 흔들린다. 펌웨어는 원시값을 그대로 보내고, 웹이 튐 제거·평활·유지 시간으로 보정한다(`web/frontend/src/input/steering.ts`). 프리셋과 세부 조정은 정렬 화면에서 바꾼다.

## 실측 확인 (사용자)

- [ ] 핸들을 왼쪽으로 기울일 때 정렬 화면이 LEFT 로 표시되는지 (반대면 좌우 반전)
- [ ] 가만히 잡고 있을 때 CENTER 가 유지되는지 → 흔들리면 둔감
- [ ] 의도한 기울기에 늦게 반응하면 민감
