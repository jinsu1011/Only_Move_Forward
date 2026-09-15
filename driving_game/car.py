"""Arcade movement and fines, independent of Ursina for repeatable tests."""
import math
import config as cfg


class Car:
    def __init__(self):
        self.reset()

    def reset(self):
        self.x, self.z = cfg.START_POSITION
        self.heading = self.speed = 0.0

    def update(self, dt, throttle, steering, strong_brake=False):
        if strong_brake:
            self.speed = math.copysign(max(0, abs(self.speed)-cfg.STRONG_BRAKING*dt), self.speed)
        elif throttle:
            rate = cfg.BRAKING if self.speed * throttle < 0 else cfg.ACCELERATION
            self.speed += throttle * rate * dt
        else:
            self.speed = math.copysign(max(0, abs(self.speed)-2*dt), self.speed)
        self.speed = max(-cfg.REVERSE_SPEED, min(cfg.MAX_SPEED, self.speed))
        self.heading += steering * cfg.STEERING_RATE * min(abs(self.speed)/6, 1) * (1 if self.speed >= 0 else -1) * dt
        angle = math.radians(self.heading)
        self.x += math.sin(angle) * self.speed * dt
        self.z += math.cos(angle) * self.speed * dt


class Account:
    def __init__(self):
        self.reset()

    def reset(self):
        self.money = cfg.START_MONEY
        self.cooldown = 0.0
        self.notice = ''
        self.notice_time = 0.0

    @property
    def game_over(self):
        return self.money <= cfg.BANKRUPTCY_THRESHOLD

    def update(self, dt):
        self.cooldown = max(0, self.cooldown-dt)
        self.notice_time = max(0, self.notice_time-dt)

    def fine(self, amount, message):
        if not self.game_over:
            self.money -= amount
            self.notice = f'{message}\n-${amount:,}'
            self.notice_time = 2.0

    def collision(self, kind):
        if self.cooldown <= 0 and not self.game_over:
            self.fine(cfg.COLLISION_FINE, 'CRASH!' if kind == 'car' else 'PROPERTY DAMAGE')
            self.cooldown = cfg.COLLISION_COOLDOWN
            return True
        return False


def circle_box(x, z, radius, bounds):
    bx, bz, half_x, half_z = bounds
    dx = max(abs(x-bx)-half_x, 0)
    dz = max(abs(z-bz)-half_z, 0)
    return dx*dx + dz*dz <= radius*radius
