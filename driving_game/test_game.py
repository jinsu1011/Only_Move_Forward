import time
import unittest
import config as cfg
from sensor import Sensor, Setup, parse_roll, parse_sample
from car import Car, Account, circle_box
from traffic_light import TrafficLight


class SensorTests(unittest.TestCase):
    def test_parser_and_partial_stream(self):
        s=Sensor(keyboard=True)
        s.feed(b'noise\nnan\ninf\n181\n12.')
        self.assertFalse(s.available)
        s.feed(b'5\n-30\n')
        self.assertEqual((s.roll,s.sequence),(-30,2))
        self.assertIsNone(parse_roll(b'roll=1 pitch=2'))
        s.feed(b'x'*9000)
        self.assertEqual(s.buffer,b'')

    def test_calibration_deadzone_mapping_clamp(self):
        s=Sensor(mock=True)
        s.feed(b'10\n')
        s.calibrate()
        for roll,expected in [(10,0),(14,0),(6,0),(40,1),(-20,-1),(80,1),(-80,-1),(27,.5)]:
            s.feed(f'{roll}\n'.encode())
            s.steering=0
            self.assertAlmostEqual(s.update(10),expected)

    def test_smoothing_and_disconnect_fallback(self):
        s=Sensor(mock=True)
        s.feed(b'30\n')
        self.assertTrue(0<s.update(.01)<1)
        s.last_read=time.monotonic()-2
        self.assertAlmostEqual(s.update(10,-1),-1)

    def test_serial_exception(self):
        class Broken:
            @property
            def in_waiting(self):
                raise OSError('unplugged')
            def read(self, count):
                return b''
            def close(self):
                pass
        s=Sensor(keyboard=True)
        s.connection=Broken()
        s.feed(b'10\n')
        s.poll()
        self.assertFalse(s.available)
        self.assertIsNone(s.connection)

    def test_two_axis_protocols(self):
        self.assertEqual(parse_sample(b'WME,3068,5.20,3.07,0.00\r'),(5.2,3.07))
        self.assertEqual(parse_sample(b'-12,23'),(-12,23))
        self.assertEqual(parse_sample(b'12'),(12,None))
        for invalid in (b'INFO,READY',b'WME,t,1,2,3',b'WME,1,2,nan,0',
                        b'1,inf',b'1,181',b'1,2,3',b'\xff'):
            self.assertIsNone(parse_sample(invalid))

    def test_pitch_mapping_keyboard_priority_disconnect(self):
        s=Sensor(keyboard=True)
        s.feed(b'5,10\n'); s.calibrate()
        for pitch,expected in ((10,0),(6,0),(14,0),(-15,1),(35,-1),(-60,1),(60,-1)):
            s.feed(f'5,{pitch}\n'.encode())
            s.throttle=0
            self.assertAlmostEqual(s.update_throttle(10),expected)
        s.feed(b'5,-15\n')
        self.assertEqual(s.update_throttle(.01,-1),-1)
        s.last_read=None
        self.assertEqual(s.update_throttle(.01),0)
        self.assertEqual(s.update_throttle(.01,1),1)
        s.feed(b'5\n')
        self.assertEqual(s.update_throttle(.1),0)

    def test_real_pyserial_loopback(self):
        import serial
        s=Sensor(keyboard=True)
        s.connection=serial.serial_for_url('loop://',timeout=0)
        s.connection.write(b'12.5\ninvalid\n-20\n')
        s.poll()
        self.assertEqual(s.roll,-20)
        self.assertEqual(s.sequence,2)
        s.close()


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.sensor=Sensor(keyboard=True)
        self.flow=Setup(self.sensor)

    def tick(self, seconds, roll=5, pitch=7, horizontal=0, vertical=0, keys_down=False):
        for _ in range(round(seconds*100)):
            self.sensor.feed(f'{roll},{pitch}\n'.encode())
            self.flow.update(.01,horizontal,vertical,keys_down)

    def center(self):
        self.tick(3.2)
        self.assertEqual(self.flow.stage,'LEFT')
        self.assertAlmostEqual(self.sensor.center,5)
        self.assertAlmostEqual(self.sensor.pitch_center,7)

    def complete_sensor(self):
        self.center()
        for roll,pitch in ((-15,7),(25,7),(5,-13),(5,27)):
            self.tick(.4,roll,pitch)
            self.tick(.4)

    def test_full_flow_needs_explicit_start(self):
        self.assertFalse(self.flow.start())
        self.complete_sensor()
        self.assertEqual(self.flow.checked,list(Setup.DIRECTIONS))
        self.assertTrue(self.flow.can_start)
        self.tick(2)
        self.assertFalse(self.flow.done)
        self.assertTrue(self.flow.start())
        self.assertTrue(self.flow.done)

    def test_wrong_direction_diagonal_and_short_pulse_rejected(self):
        self.center()
        self.tick(.5,25,7)
        self.assertEqual(self.flow.checked,[])
        self.tick(.5,-15,-13)
        self.assertEqual(self.flow.checked,[])
        self.tick(.1,-15,7); self.tick(.1)
        self.assertEqual(self.flow.checked,[])
        self.tick(.4,-15,7)
        self.assertEqual(self.flow.checked,['LEFT'])
        self.tick(.5,25,7)  # Right without returning to center must fail.
        self.assertEqual(self.flow.checked,['LEFT'])
        self.tick(.4); self.tick(.4,25,7)
        self.assertEqual(self.flow.checked,['LEFT','RIGHT'])

    def test_still_center_and_enough_samples_required(self):
        for n in range(400):
            self.sensor.feed(f'{n%2*12},0\n'.encode())
            self.flow.update(.01)
        self.assertEqual(self.flow.stage,'CENTER')
        self.assertFalse(self.flow.can_start)
        self.tick(3.3)
        self.assertEqual(self.flow.stage,'LEFT')
        fresh=Setup(self.sensor)
        self.sensor.feed(b'0,0\n')
        fresh.update(.01)
        fresh.update(4)
        self.assertEqual(fresh.stage,'CENTER')

    def test_final_center_and_live_sensor_required_to_start(self):
        self.complete_sensor()
        self.tick(.01,5,27)
        self.assertFalse(self.flow.start())
        self.tick(.1)
        self.sensor.last_read=None
        self.assertFalse(self.flow.start())
        self.flow.update(.1)
        self.assertEqual(self.flow.checked,[])
        self.assertFalse(self.flow.done)

    def test_roll_only_cannot_pass_pitch_check(self):
        self.sensor.feed(b'10\n')
        self.flow.update(.01)
        self.assertEqual(self.flow.stage,'NEED_PITCH')
        self.assertFalse(self.flow.start())
        self.flow.use_keyboard()
        self.assertEqual(self.flow.stage,'CENTER')

    def test_keyboard_all_four_directions_and_release(self):
        self.flow.use_keyboard()
        self.tick(4,horizontal=0,vertical=0,keys_down=True)
        self.assertEqual(self.flow.stage,'CENTER')
        self.tick(3.1)
        for horizontal,vertical in ((-1,0),(1,0),(0,1),(0,-1)):
            self.tick(.4,horizontal=horizontal,vertical=vertical,keys_down=True)
            self.tick(.4)
        self.assertTrue(self.flow.can_start)
        self.assertTrue(self.flow.start())

    def test_reset_every_stage_clears_checks_and_alignment(self):
        for stage in ('CONNECT','CENTER','LEFT','RIGHT','FORWARD','BACKWARD','CONFIRMED','READY','DONE'):
            self.flow.stage=stage
            self.flow.checked=['LEFT']
            self.sensor.center=9
            self.sensor.pitch_center=8
            self.sensor.steering=self.sensor.throttle=1
            self.flow.reset()
            self.assertEqual(self.flow.stage,'CONNECT')
            self.assertEqual(self.flow.checked,[])
            self.assertEqual((self.sensor.center,self.sensor.pitch_center,self.sensor.steering,self.sensor.throttle),(0,0,0,0))
            self.assertFalse(self.flow.start())

    def test_restart_anchors_nonzero_pose_immediately(self):
        self.sensor.feed(b'WME,1234,27.5,-18.25,0\n')
        self.sensor.steering=self.sensor.throttle=1
        self.flow.reset()
        self.assertEqual(self.flow.stage,'CENTER')
        self.assertEqual((self.sensor.center,self.sensor.pitch_center),(27.5,-18.25))
        self.assertEqual((self.sensor.horizontal,self.sensor.vertical,self.sensor.steering,self.sensor.throttle),(0,0,0,0))
        self.assertIn('CENTER / STOPPED',self.flow.message)
        self.assertEqual(self.flow.checked,[])
        self.tick(.1,27.5,-18.25)
        self.assertTrue(self.flow.neutral)

    def test_each_direction_has_persistent_confirmation(self):
        self.center()
        for name,roll,pitch in (('LEFT',-15,7),('RIGHT',25,7),('FORWARD',5,-13),('BACKWARD',5,27)):
            self.tick(.4,roll,pitch)
            self.assertEqual(self.flow.stage,'CONFIRMED')
            self.assertEqual(self.flow.message,f'{name} CONFIRMED')
            self.assertEqual(self.flow.checked[-1],name)
            self.tick(1,roll,pitch)
            self.assertEqual(self.flow.message,f'{name} CONFIRMED')
            self.assertFalse(self.flow.start())
            self.tick(.4)
        self.assertEqual(self.flow.stage,'READY')
        self.assertTrue(self.flow.can_start)

    def test_no_device_falls_back_to_keyboard_checks(self):
        self.flow.update(cfg.CONNECT_SECONDS)
        self.assertTrue(self.flow.keyboard)
        self.assertEqual(self.flow.stage,'CENTER')
        self.assertFalse(self.flow.can_start)


class GameTests(unittest.TestCase):
    def test_movement_brake_reverse(self):
        c=Car()
        for _ in range(120): c.update(1/120,1,0)
        self.assertGreater(c.z,cfg.START_POSITION[1])
        c.update(.1,1,1)
        self.assertGreater(c.heading,0)
        c.update(1,0,0,True)
        self.assertEqual(c.speed,0)
        for _ in range(120): c.update(1/120,-1,0)
        self.assertLess(c.speed,0)
        self.assertGreaterEqual(c.speed,-cfg.REVERSE_SPEED)
        c.reset()
        self.assertEqual((c.x,c.z,c.speed,c.heading),(*cfg.START_POSITION,0,0))

    def test_cycle_crossing_and_rearm(self):
        t=TrafficLight()
        self.assertEqual(t.state,'GREEN')
        t.update(cfg.GREEN_SECONDS); self.assertEqual(t.state,'YELLOW')
        t.update(cfg.YELLOW_SECONDS); self.assertEqual(t.state,'RED')
        self.assertFalse(t.violation(10,-6,10,-4))
        self.assertTrue(t.violation(0,-6,0,-4))
        self.assertFalse(t.violation(0,-6,0,-4))
        t.violation(0,-4,0,-9)
        self.assertTrue(t.violation(0,-9,0,0))
        t.update(cfg.RED_SECONDS); self.assertEqual(t.state,'GREEN')
        t.reset(); self.assertFalse(t.crossed)
        self.assertFalse(t.violation(0,-6,0,-4))

    def test_fines_cooldown_bankruptcy_reset(self):
        a=Account()
        self.assertTrue(a.collision('car'))
        self.assertEqual(a.money,-1000)
        self.assertIn('CRASH!',a.notice)
        self.assertFalse(a.collision('property'))
        a.update(cfg.COLLISION_COOLDOWN)
        self.assertTrue(a.collision('property'))
        self.assertIn('PROPERTY DAMAGE',a.notice)
        for _ in range(3):
            a.update(cfg.COLLISION_COOLDOWN); a.collision('car')
        self.assertTrue(a.game_over)
        self.assertEqual(a.money,-5000)
        a.fine(500,'ignored'); self.assertEqual(a.money,-5000)
        a.reset()
        self.assertEqual((a.money,a.cooldown,a.notice,a.notice_time),(0,0,'',0))
        self.assertFalse(a.game_over)

    def test_collision_geometry(self):
        self.assertTrue(circle_box(1.5,0,1,(0,0,1,1)))
        self.assertFalse(circle_box(3,3,1,(0,0,1,1)))

if __name__=='__main__':
    unittest.main(verbosity=2)
