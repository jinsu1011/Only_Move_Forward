#include <Wire.h> // 아두이노에 기본 포함된 I2C 통신 기능만 사용합니다.
// atan2, sqrt, fabs, RAD_TO_DEG는 Arduino 기본 코어가 제공하므로 별도 설치가 없습니다.
const uint32_t PERIOD_US = 20000UL; // 정상 동작 중 20ms마다 한 줄, 초당 50회를 출력합니다.
const uint16_t CALIBRATION_SAMPLES = 400; // 시작할 때 5ms 간격으로 약 2초간 자이로 영점을 구합니다.
uint8_t sensorAddress = 0x68; // AD0가 낮으면 주소는 0x68이며 0x69도 자동 확인합니다.
float gyroBiasZ = 0.0f; // 가만히 있을 때에도 나타나는 자이로 Z축 오차입니다.
float yawDeg = 0.0f; // 시작 자세를 0도로 삼아 누적하는 상대 비틀기 각도입니다.
uint32_t previousUs = 0; // 직전 측정 시각을 마이크로초로 저장합니다.
uint32_t nextUs = 0; // 다음 측정을 시작할 예정 시각입니다.
bool firstSample = true; // 첫 측정에서는 아직 시간 구간이 없으므로 적분하지 않습니다.
// 통신 실패는 정상 측정값처럼 내보내지 않고 재시작 전까지 중단합니다.
void haltSensor(const __FlashStringHelper *message) { // 오류 원인을 시리얼 모니터에 알립니다.
  Serial.print(F("ERR,")); // 정상 샘플의 WME 접두사와 구분합니다.
  Serial.println(message); // 오류 문장은 초보자가 시리얼 모니터에서 확인할 수 있습니다.
  while (true) { delay(1000); } // 접촉 문제를 숨기거나 가짜 0을 내보내지 않습니다.
} // 오류 처리 함수 끝입니다.
bool writeRegister(uint8_t reg, uint8_t value) { // 센서 설정 한 바이트를 레지스터에 씁니다.
  Wire.clearWireTimeoutFlag(); // 이전 통신의 시간 초과 표시를 지웁니다.
  Wire.beginTransmission(sensorAddress); // 선택한 센서 주소로 쓰기를 시작합니다.
  Wire.write(reg); // 값을 넣을 레지스터 번호를 보냅니다.
  Wire.write(value); // 설정값을 보냅니다.
  uint8_t status = Wire.endTransmission(); // 전송을 끝내고 센서 응답을 받습니다.
  return status == 0 && !Wire.getWireTimeoutFlag(); // 응답 성공과 시간 초과 여부를 함께 확인합니다.
} // 레지스터 쓰기 함수 끝입니다.
bool readRegisters(uint8_t reg, uint8_t count, uint8_t *data) { // 연속된 레지스터 값을 읽습니다.
  Wire.clearWireTimeoutFlag(); // 이번 요청의 시간 초과를 새로 확인합니다.
  Wire.beginTransmission(sensorAddress); // 먼저 읽을 시작 위치를 알려줍니다.
  Wire.write(reg); // 읽기 시작 레지스터 주소를 보냅니다.
  if (Wire.endTransmission(false) != 0 || Wire.getWireTimeoutFlag()) { return false; } // 응답이 없으면 실패입니다.
  uint8_t received = Wire.requestFrom(sensorAddress, count, (uint8_t)true); // 필요한 바이트 수만큼 읽습니다.
  if (received != count || Wire.getWireTimeoutFlag()) { return false; } // 부족한 데이터를 정상값으로 쓰지 않습니다.
  for (uint8_t i = 0; i < count; ++i) { data[i] = Wire.read(); } // 받은 값을 순서대로 복사합니다.
  return true; // 필요한 데이터를 모두 읽었습니다.
} // 레지스터 읽기 함수 끝입니다.
int16_t signedWord(const uint8_t *data) { // 상위와 하위 바이트를 부호 있는 16비트 값으로 합칩니다.
  return (int16_t)(((uint16_t)data[0] << 8) | data[1]); // 음수 가속도와 음수 회전 속도도 복원합니다.
} // 두 바이트 변환 함수 끝입니다.
bool readMotion(float &ax, float &ay, float &az, float &gz) { // 필요한 가속도 3축과 자이로 Z축을 가져옵니다.
  uint8_t bytes[14]; // 가속도 6바이트, 온도 2바이트, 자이로 6바이트를 한 번에 읽습니다.
  if (!readRegisters(0x3B, 14, bytes)) { return false; } // ACCEL_XOUT_H부터 연속 읽기에 실패하면 중단합니다.
  ax = signedWord(bytes) / 16384.0f; // ±2g 설정에서 X축 원시값을 중력가속도 g 단위로 바꿉니다.
  ay = signedWord(bytes + 2) / 16384.0f; // Y축 가속도를 같은 단위로 바꿉니다.
  az = signedWord(bytes + 4) / 16384.0f; // Z축 가속도를 같은 단위로 바꿉니다.
  gz = signedWord(bytes + 12) / 131.0f; // ±250도/초 설정에서 Z축 회전 속도를 도/초로 바꿉니다.
  return true; // 온도와 자이로 X/Y는 이번 조작에 사용하지 않습니다.
} // 센서값 읽기 함수 끝입니다.
void setup() { // 보드가 켜지거나 리셋되면 한 번 실행합니다.
  Serial.begin(115200); // 브라우저와 기록 도구도 같은 통신 속도를 사용해야 합니다.
  Wire.begin(); // UNO의 A4(SDA), A5(SCL)로 I2C 통신을 시작합니다.
  digitalWrite(SDA, LOW); // UNO 코어가 켠 5V 내부 풀업을 끄며 모듈의 적절한 외부 풀업을 사용합니다.
  digitalWrite(SCL, LOW); // 전원용 레귤레이터가 신호 전압까지 변환하는 것은 아닙니다.
  Wire.setClock(100000UL); // 초보자 배선에서 기본 I2C 속도 100kHz를 사용합니다.
  Wire.setWireTimeout(25000UL, true); // 배선 문제로 통신이 무한정 멈추지 않도록 25ms 제한을 둡니다.
  delay(100); // 전원을 넣은 직후 센서가 준비될 시간을 줍니다.
  bool found = false; // 센서의 칩 식별값 확인 여부입니다.
  for (uint8_t address = 0x68; address <= 0x69; ++address) { // MPU6050의 두 가능한 주소만 확인합니다.
    sensorAddress = address; // 이번에 확인할 주소를 선택합니다.
    uint8_t identity = 0; // WHO_AM_I 레지스터를 받을 자리입니다.
    if (readRegisters(0x75, 1, &identity) && identity == 0x68) { found = true; break; } // 두 주소 모두 칩 식별값은 0x68입니다.
  } // 주소 확인 반복 끝입니다.
  if (!found) { haltSensor(F("MPU6050_NOT_FOUND")); } // 배선과 모듈 종류 확인이 필요합니다.
  if (!writeRegister(0x6B, 0x80)) { haltSensor(F("RESET_FAILED")); } // 이전 센서 설정을 리셋합니다.
  delay(100); // 센서 리셋이 끝나기를 기다립니다.
  if (!writeRegister(0x6B, 0x01) || !writeRegister(0x6C, 0x00)) { haltSensor(F("WAKE_FAILED")); } // 절전 해제와 전체 축 사용을 설정합니다.
  if (!writeRegister(0x1A, 0x03) || !writeRegister(0x19, 0x04)) { haltSensor(F("RATE_FAILED")); } // 저역 필터와 센서 내부 200Hz 갱신을 설정합니다.
  if (!writeRegister(0x1B, 0x00) || !writeRegister(0x1C, 0x00)) { haltSensor(F("RANGE_FAILED")); } // 자이로 ±250도/초와 가속도 ±2g를 선택합니다.
  delay(100); // 필터와 새 설정이 안정될 시간을 줍니다.
  float sumZ = 0.0f; // 정지 상태의 자이로 Z축 값을 더할 변수입니다.
  bool calibrated = false; // 움직임 없이 보정을 끝까지 마쳤는지 여부입니다.
  while (!calibrated) { // 성공할 때까지 보정을 처음부터 다시 시도합니다.
    Serial.println(F("INFO,KEEP_STILL_CALIBRATING")); // 매 시도마다 약 2초간 손대지 않아야 한다고 알립니다.
    sumZ = 0.0f; // 이전 시도에서 더한 값을 버리고 새로 시작합니다.
    calibrated = true; // 중간에 움직임이 없으면 이 시도가 성공입니다.
    for (uint16_t i = 0; i < CALIBRATION_SAMPLES; ++i) { // 정해진 수만큼 정지 측정합니다.
      float ax, ay, az, gz; // 이번 샘플의 물리량을 담습니다.
      if (!readMotion(ax, ay, az, gz)) { haltSensor(F("CALIBRATION_READ_FAILED")); } // 보정 중 통신 끊김은 배선 문제이므로 멈춥니다.
      float gravity = sqrt(ax * ax + ay * ay + az * az); // 심한 움직임을 발견하기 위해 가속도 크기를 계산합니다.
      if (gravity < 0.85f || gravity > 1.15f || fabs(gz) > 10.0f) { // 큰 움직임이면 이번 보정은 쓸 수 없습니다.
        Serial.println(F("ERR,KEEP_STILL_RETRY")); // 멈추지 않고 다시 보정한다고 알립니다.
        calibrated = false; // 이번 시도는 실패로 표시합니다.
        delay(500); // 사용자가 모형을 내려놓을 시간을 잠시 줍니다.
        break; // 남은 샘플을 건너뛰고 처음부터 다시 시작합니다.
      } // 움직임 처리 끝입니다.
      sumZ += gz; // 일정한 영점 오차를 평균내기 위해 더합니다.
      delay(5); // 센서 내부 갱신 주기에 맞춰 다음 샘플을 기다립니다.
    } // 영점 측정 반복 끝입니다.
  } // 보정 재시도 반복 끝입니다.
  gyroBiasZ = sumZ / CALIBRATION_SAMPLES; // 시작 시 정지 오차를 한 번만 보정합니다.
  Serial.println(F("INFO,READY")); // 이 줄 이후 정상 WME 샘플이 나옵니다.
  nextUs = micros(); // 첫 출력 주기를 시작합니다.
} // 초기화 끝입니다.
void loop() { // 이후 계속 반복해서 측정값을 내보냅니다.
  uint32_t nowUs = micros(); // 현재 시각을 읽습니다.
  if ((int32_t)(nowUs - nextUs) < 0) { return; } // 아직 20ms 주기가 안 됐으면 기다립니다.
  if ((uint32_t)(nowUs - nextUs) >= PERIOD_US) { // 한 주기 이상 밀렸으면 멈추지 않고 주기를 다시 맞춥니다.
    nextUs = nowUs; // 밀린 샘플을 몰아서 출력하지 않고 지금 시각부터 20ms 간격을 새로 잡습니다.
    Serial.println(F("INFO,TIMING_RESYNC")); // 주기를 다시 맞췄다는 사실을 숨기지 않고 알립니다.
  } // 주기 재설정 끝입니다. yaw는 실제 경과 시간으로 적분하므로 밀린 시간도 반영됩니다.
  nextUs += PERIOD_US; // 처리 시간과 별개로 일정한 20ms 간격을 유지합니다.
  float ax, ay, az, gz; // 이번 측정값을 담을 변수입니다.
  if (!readMotion(ax, ay, az, gz)) { haltSensor(F("I2C_READ_FAILED")); } // 실패 시 이전 값이나 0을 정상값처럼 보내지 않습니다.
  uint32_t sampleUs = micros(); // 실제 센서 읽기가 끝난 시각으로 적분 시간을 구합니다.
  uint32_t sampleMs = millis(); // 보드가 켜진 뒤 경과 밀리초를 출력 시각으로 사용합니다.
  float rollDeg = atan2(ay, az) * RAD_TO_DEG; // 중력 방향으로 좌우 기울기를 도 단위로 계산합니다.
  float pitchDeg = atan2(-ax, sqrt(ay * ay + az * az)) * RAD_TO_DEG; // 중력 방향으로 앞뒤 기울기를 계산합니다.
  if (!firstSample) { yawDeg += (gz - gyroBiasZ) * ((uint32_t)(sampleUs - previousUs) / 1000000.0f); } // 보정된 Z축 각속도에 실제 시간 간격을 곱해 누적합니다.
  firstSample = false; // 다음 샘플부터 시간 적분을 합니다.
  previousUs = sampleUs; // 다음 적분을 위해 시각을 저장합니다.
  Serial.print(F("WME,")); // 브라우저가 정상 샘플을 구분할 필수 접두사입니다.
  Serial.print(sampleMs); // 경과 밀리초를 정수로 출력합니다.
  Serial.print(','); // CSV 필드 구분자입니다.
  Serial.print(rollDeg, 2); // roll을 소수점 둘째 자리까지 출력합니다.
  Serial.print(','); // CSV 필드 구분자입니다.
  Serial.print(pitchDeg, 2); // pitch를 소수점 둘째 자리까지 출력합니다.
  Serial.print(','); // CSV 필드 구분자입니다.
  Serial.print(yawDeg, 2); // yaw는 ±180도로 감지 않고 누적하여 드리프트를 보존합니다.
  Serial.write('\n'); // 정상 샘플은 정확히 LF 하나로 줄을 끝냅니다.
} // 반복 측정 끝입니다.
