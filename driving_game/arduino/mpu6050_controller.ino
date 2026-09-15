// UNO R3: VCC -> 5V, GND -> GND, SDA -> A4, SCL -> A5.
// Set TEST_MODE=true for I2C detection and roll/pitch diagnostics.
// Game mode sends roll,pitch per line for the four-direction setup check.
#include <Wire.h>
#include <math.h>
const bool TEST_MODE = false;
uint8_t address = 0;
unsigned long lastSample = 0;

bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool detectSensor() {
  for (uint8_t candidate = 0x68; candidate <= 0x69; ++candidate) {
    Wire.beginTransmission(candidate);
    Wire.write(0x75);  // WHO_AM_I
    if (Wire.endTransmission(false) != 0) continue;
    if (Wire.requestFrom(candidate, (uint8_t)1) != 1) continue;
    if ((Wire.read() & 0x7e) != 0x68) continue;
    address = candidate;
    if (!writeRegister(0x6B, 0)) return false; // wake up
    if (!writeRegister(0x1C, 0)) return false; // +/-2g
    if (TEST_MODE) { Serial.print("MPU-6050 detected at 0x"); Serial.println(address, HEX); }
    return true;
  }
  return false;
}

int16_t readSigned() {
  uint8_t high = Wire.read();
  uint8_t low = Wire.read();
  return (int16_t)(((uint16_t)high << 8) | low);
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.setWireTimeout(3000, true);
  delay(100);
  detectSensor();
}

void loop() {
  if (!address) {
    if (TEST_MODE) Serial.println("MPU-6050 not found; checking 0x68/0x69");
    delay(1000);
    detectSensor();
    return;
  }
  if (millis() - lastSample < 20) return; // 50 Hz
  lastSample = millis();
  Wire.beginTransmission(address);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(address, (uint8_t)6) != 6) {
    address = 0;
    return;
  }
  float ax = readSigned(), ay = readSigned(), az = readSigned();
  float roll = atan2(ay, az) * 180.0 / PI;
  float pitch = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0 / PI;
  if (TEST_MODE) {
    Serial.print("roll="); Serial.print(roll, 2);
    Serial.print(" pitch="); Serial.println(pitch, 2);
  } else {
    Serial.print(roll, 2);
    Serial.print(',');
    Serial.println(pitch, 2);
  }
}
