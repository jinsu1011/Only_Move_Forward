"""Non-blocking serial input and a mandatory pre-drive controller check."""
import argparse
import math
import time
import serial
from serial.tools import list_ports
import config as cfg


def angle(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and abs(number) <= 180 else None
    except (ValueError, TypeError):
        return None


def parse_sample(line):
    """Return (roll, pitch) or None. Legacy roll-only input has no pitch."""
    try:
        text = line.decode('ascii').strip() if isinstance(line, bytes) else line.strip()
        fields = text.split(',')
        if len(fields) == 1:
            roll = angle(fields[0])
            return (roll, None) if roll is not None else None
        if len(fields) == 5 and fields[0] == 'WME':
            # Existing board protocol: WME,millis,angle1,angle2,extra.
            # The physical roll/pitch assignment is checked by the setup screen.
            if not fields[1].isdigit() or not math.isfinite(float(fields[4])):
                return None
            fields = fields[2:4]
        if len(fields) != 2:
            return None
        roll, pitch = (angle(value) for value in fields)
        return (roll, pitch) if roll is not None and pitch is not None else None
    except (ValueError, TypeError, UnicodeError, AttributeError):
        return None


def parse_roll(line):
    sample = parse_sample(line)
    return sample[0] if sample is not None else None


class Sensor:
    def __init__(self, port=None, keyboard=False, mock=False):
        self.connection = None
        self.roll = self.pitch = self.center = self.pitch_center = self.steering = 0.0
        self.throttle = 0.0
        self.has_pitch = False
        self.last_read = None
        self.sequence = 0
        self.buffer = b''
        self.mock = mock
        self.error = ''
        self.port = port
        self.roll_sign = cfg.STEERING_SIGN
        self.pitch_sign = cfg.PITCH_SIGN
        if not keyboard and not mock:
            self.connect()

    def connect(self):
        if self.mock or self.connection:
            return
        port = self.port
        if port is None:
            candidates = [p.device for p in list_ports.comports()
                          if any(s in p.device.lower() for s in ('usbmodem', 'usbserial', 'wchusb'))]
            port = candidates[0] if candidates else None
        if port:
            try:
                self.connection = serial.Serial(port, cfg.SERIAL_BAUD, timeout=0)
                self.error = ''
            except (serial.SerialException, OSError) as exc:
                self.error = str(exc)

    @property
    def available(self):
        return self.last_read is not None and time.monotonic() - self.last_read < cfg.SENSOR_TIMEOUT

    @property
    def horizontal(self):
        return (self.roll - self.center) * self.roll_sign

    @property
    def vertical(self):
        return (self.pitch - self.pitch_center) * self.pitch_sign

    def feed(self, data):
        self.buffer += data
        if len(self.buffer) > 8192:
            self.buffer = b''
            return
        while b'\n' in self.buffer:
            line, self.buffer = self.buffer.split(b'\n', 1)
            sample = parse_sample(line)
            if sample is not None:
                self.roll, pitch = sample
                self.has_pitch = pitch is not None
                self.pitch = pitch if pitch is not None else 0.0
                self.last_read = time.monotonic()
                self.sequence += 1

    def poll(self):
        if self.mock:
            self.feed(f'{self.roll},{self.pitch}\n'.encode())
        elif self.connection:
            try:
                self.feed(self.connection.read(min(self.connection.in_waiting, 4096)))
            except (serial.SerialException, OSError) as exc:
                self.error = str(exc)
                self.close()
                self.last_read = None

    def reset_alignment(self):
        # Restart uses the current physical pose as zero, never absolute 0 degrees.
        self.center = self.roll if self.available else 0.0
        self.pitch_center = self.pitch if self.available and self.has_pitch else 0.0
        self.steering = self.throttle = 0.0

    def calibrate(self):
        if self.available:
            self.center, self.pitch_center = self.roll, self.pitch
            self.steering = self.throttle = 0.0

    def update(self, dt, keyboard=0.0, enabled=True):
        target = keyboard
        if enabled and self.available and keyboard == 0:
            roll = self.horizontal
            magnitude = max(0.0, abs(roll) - cfg.DEAD_ZONE) / (cfg.MAX_ROLL - cfg.DEAD_ZONE)
            target = math.copysign(min(1.0, magnitude), roll)
        self.steering += (target - self.steering) * (1 - math.exp(-cfg.SMOOTHING * dt))
        return self.steering

    def update_throttle(self, dt, keyboard=0.0, enabled=True):
        if keyboard:
            self.throttle = keyboard
            return keyboard
        if not enabled or not self.available or not self.has_pitch:
            self.throttle = 0.0
            return 0.0
        pitch = self.vertical
        magnitude = max(0.0, abs(pitch)-cfg.DEAD_ZONE)/(cfg.MAX_PITCH-cfg.DEAD_ZONE)
        target = math.copysign(min(1.0, magnitude), pitch)
        self.throttle += (target-self.throttle)*(1-math.exp(-cfg.SMOOTHING*dt))
        # A small residual must not defeat neutral coasting forever.
        if abs(self.throttle) < .001:
            self.throttle = 0.0
        return self.throttle

    def close(self):
        if self.connection:
            self.connection.close()
            self.connection = None


class Setup:
    DIRECTIONS = ('LEFT', 'RIGHT', 'FORWARD', 'BACKWARD')

    def __init__(self, sensor, keyboard=False):
        self.sensor = sensor
        self.keyboard = keyboard
        self.reset()

    def reset(self):
        self.sensor.reset_alignment()
        self.stage = 'CENTER' if self.keyboard or (self.sensor.available and self.sensor.has_pitch) else 'CONNECT'
        self.elapsed = self.hold = 0.0
        self.samples = []
        self.checked = []
        self.last_sequence = self.sensor.sequence
        self.hold_samples = 0
        self.confirmed = None
        self.neutral = self.keyboard or (self.sensor.available and self.sensor.has_pitch)
        self.detail = 'Current position set to CENTER. Vehicle STOPPED.'

    @property
    def done(self):
        return self.stage == 'DONE'

    @property
    def can_start(self):
        return (self.stage == 'READY' and self.neutral and
                len(self.checked) == 4 and
                (self.keyboard or (self.sensor.available and self.sensor.has_pitch)))

    @property
    def message(self):
        if self.stage == 'CENTER':
            return f'CENTER / STOPPED\n{max(1, math.ceil(cfg.CENTER_SECONDS-self.elapsed))}'
        if self.stage == 'CONFIRMED':
            return f'{self.confirmed} CONFIRMED'
        if self.stage in self.DIRECTIONS:
            prefix = 'PRESS' if self.keyboard else 'TILT'
            key = {'LEFT': 'A', 'RIGHT': 'D', 'FORWARD': 'W', 'BACKWARD': 'S'}[self.stage]
            return f'{prefix} {self.stage}' + (f'  [{key}]' if self.keyboard else '')
        return {'CONNECT': 'CHECKING ARDUINO', 'NEED_PITCH': 'TWO AXES REQUIRED',
                'READY': 'CHECK COMPLETE' if self.neutral else 'RETURN TO CENTER', 'DONE': ''}[self.stage]

    def use_keyboard(self):
        self.keyboard = True
        self.reset()

    def use_sensor(self):
        self.keyboard = False
        self.sensor.connect()
        self.reset()

    def change(self, stage):
        self.stage = stage
        self.elapsed = self.hold = 0.0
        self.hold_samples = 0
        self.detail = ''

    def start(self):
        if not self.can_start:
            return False
        self.sensor.steering = self.sensor.throttle = 0.0
        self.change('DONE')
        return True

    def update(self, dt, horizontal=0.0, vertical=0.0, keys_down=False):
        if self.done:
            return
        self.elapsed += dt
        if not self.keyboard:
            if not self.sensor.available:
                if self.stage != 'CONNECT':
                    self.reset()
                    self.detail = 'Connection lost. Repeat checks, or press K for keyboard.'
                elif self.elapsed >= cfg.CONNECT_SECONDS:
                    self.use_keyboard()
                    self.detail = 'No sensor data. Keyboard check selected.'
                return
            if not self.sensor.has_pitch:
                self.stage = 'NEED_PITCH'
                self.detail = 'Roll-only data cannot check forward/back. Press K for keyboard.'
                return
            if self.stage in ('CONNECT', 'NEED_PITCH'):
                self.sensor.calibrate()
                self.change('CENTER')
            horizontal, vertical = self.sensor.horizontal, self.sensor.vertical
            self.neutral = abs(horizontal) <= cfg.DEAD_ZONE and abs(vertical) <= cfg.DEAD_ZONE
        else:
            self.neutral = not keys_down and horizontal == 0 and vertical == 0

        fresh = self.keyboard or self.sensor.sequence != self.last_sequence
        self.last_sequence = self.sensor.sequence
        if self.stage == 'CENTER':
            if self.keyboard:
                if not self.neutral:
                    self.elapsed = 0
                    self.detail = 'Release A / D / W / S and Space.'
                else:
                    self.detail = 'Keep all driving keys released.'
                enough = True
            else:
                if fresh:
                    self.samples.append((self.sensor.roll, self.sensor.pitch))
                enough = len(self.samples) >= cfg.CENTER_MIN_SAMPLES
                if self.samples and any(max(v)-min(v) > cfg.CENTER_MAX_SPREAD for v in zip(*self.samples)):
                    self.samples = [(self.sensor.roll, self.sensor.pitch)]
                    self.elapsed = 0
                    self.detail = 'Movement detected. Hold still; countdown restarted.'
                else:
                    self.detail = 'Hold the controller in your neutral driving position.'
            if self.elapsed >= cfg.CENTER_SECONDS and enough:
                if not self.keyboard:
                    self.sensor.center = sum(v[0] for v in self.samples)/len(self.samples)
                    self.sensor.pitch_center = sum(v[1] for v in self.samples)/len(self.samples)
                self.sensor.steering = 0
                self.change('LEFT')
            return

        if self.stage == 'CONFIRMED':
            next_index = len(self.checked)
            next_step = self.DIRECTIONS[next_index] if next_index < 4 else 'START'
            self.detail = f'Return to CENTER / STOPPED. Next: {next_step}.'
            if self.neutral:
                self.hold += dt
                self.hold_samples += fresh
                if self.hold >= cfg.CHECK_HOLD_SECONDS and (self.keyboard or self.hold_samples >= 3):
                    self.change(self.DIRECTIONS[next_index] if next_index < 4 else 'READY')
            else:
                self.hold = self.hold_samples = 0
            return
        if self.stage == 'READY':
            self.detail = 'Press Enter or click START.' if self.neutral else 'Release keys / return controller to center.'
            return
        if self.stage not in self.DIRECTIONS:
            return

        threshold = .5 if self.keyboard else cfg.CHECK_ANGLE
        cross_limit = .1 if self.keyboard else cfg.CHECK_CROSS_LIMIT
        expected = {'LEFT': -horizontal, 'RIGHT': horizontal,
                    'FORWARD': vertical, 'BACKWARD': -vertical}[self.stage]
        other = vertical if self.stage in ('LEFT', 'RIGHT') else horizontal
        if expected >= threshold and abs(other) <= cross_limit:
            self.hold += dt
            self.hold_samples += fresh
            self.detail = 'Hold briefly to confirm this direction.'
            if self.hold >= cfg.CHECK_HOLD_SECONDS and (self.keyboard or self.hold_samples >= 3):
                self.confirmed = self.stage
                self.checked.append(self.stage)
                self.change('CONFIRMED')
                self.detail = 'Direction confirmed. Return to CENTER / STOPPED.'
                self.neutral = False
        else:
            self.hold = self.hold_samples = 0
            self.detail = 'Move only in the indicated direction.'
            if expected <= -threshold:
                self.detail = 'Opposite input detected. Use the indicated direction.'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port')
    parser.add_argument('--mock', action='store_true')
    parser.add_argument('--seconds', type=float, default=10)
    args = parser.parse_args()
    sensor = Sensor(args.port, mock=args.mock)
    deadline = time.monotonic() + args.seconds
    count = 0
    try:
        while time.monotonic() < deadline:
            sensor.poll()
            count = sensor.sequence
            print(f'connected={sensor.available} roll={sensor.roll:.2f} pitch={sensor.pitch:.2f} '
                  f'has_pitch={sensor.has_pitch} steering={sensor.update(.1):.3f}')
            time.sleep(.1)
        print(f'VALID_SAMPLES={count}')
    finally:
        sensor.close()
