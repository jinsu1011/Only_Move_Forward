import config as cfg


class TrafficLight:
    def __init__(self):
        self.reset()

    def reset(self):
        self.elapsed = 0.0
        self.crossed = False

    @property
    def state(self):
        t = self.elapsed % (cfg.GREEN_SECONDS+cfg.YELLOW_SECONDS+cfg.RED_SECONDS)
        if t < cfg.GREEN_SECONDS:
            return 'GREEN'
        if t < cfg.GREEN_SECONDS+cfg.YELLOW_SECONDS:
            return 'YELLOW'
        return 'RED'

    def update(self, dt):
        self.elapsed += dt

    def violation(self, old_x, old_z, x, z):
        # Re-arm only after returning behind the approach, not while on the line.
        if z < -8:
            self.crossed = False
        if not self.crossed and old_z < -5 <= z:
            fraction = (-5-old_z)/(z-old_z)
            crossing_x = old_x+(x-old_x)*fraction
            if -5 <= crossing_x <= 5:
                self.crossed = True
                return self.state == 'RED'
        return False
