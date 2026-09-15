"""Run: .venv/bin/python main.py --keyboard"""
import argparse
import config as cfg
from pathlib import Path
from panda3d.core import loadPrcFileData
loadPrcFileData('', 'audio-library-name null\ngl-version 3 2')
from ursina import Ursina, Entity, Text, Button, camera, color, held_keys, time, window, application
from sensor import Sensor, Setup
from car import Car, Account
from traffic_light import TrafficLight
from world import World

parser = argparse.ArgumentParser()
parser.add_argument('--keyboard', action='store_true')
parser.add_argument('--port')
parser.add_argument('--mock', action='store_true', help='Arrow keys simulate roll and pitch')
parser.add_argument('--debug', action='store_true')
parser.add_argument('--smoke-test', action='store_true', help='Run deterministic rendered integration checks then exit')
parser.add_argument('--offscreen', action='store_true')
parser.add_argument('--screenshot', type=Path)
args = parser.parse_args()
app = Ursina(title='Sensor Drive', size=(1100,700), borderless=False,
             development_mode=False, icon=str(Path(__import__('ursina').__file__).parent / 'textures' / 'white_cube.png'), window_type='offscreen' if args.offscreen else 'onscreen')
# macOS core OpenGL requires GLSL 150; apply it to all built-in UI as well.
from ursina.shaders.unlit_shader import unlit_shader
unlit_shader.vertex = unlit_shader.vertex.replace('#version 130', '#version 150')
unlit_shader.fragment = unlit_shader.fragment.replace('#version 140', '#version 150')
unlit_shader.fragment = unlit_shader.fragment.replace(' * vertex_color', '')
unlit_shader.vertex = unlit_shader.vertex.replace('in vec4 p3d_Color;', '').replace('out vec4 vertex_color;', '').replace('    vertex_color = p3d_Color;', '')
unlit_shader.fragment = unlit_shader.fragment.replace('in vec4 vertex_color;', '').replace('in vec3 vertex_world_position;', '')
unlit_shader.compile()
for root in (app.render, app.render2d, camera.ui):
    root.setShader(unlit_shader._shader, 100)
    root.setShaderInput('texture_scale', (1.0, 1.0))
    root.setShaderInput('texture_offset', (0.0, 0.0))
camera.overlay.enabled = False
camera.ui_lens.set_film_size(20 * (1100 / 700), 20)
window.color = color.rgb32(156,197,222)
window.exit_button.visible = False
window.fps_counter.enabled = False
from ursina.shaders.text_shader import text_shader
text_shader.vertex = text_shader.vertex.replace('#version 130', '#version 150')
text_shader.fragment = text_shader.fragment.replace('#version 140', '#version 150')
text_shader.fragment = text_shader.fragment.replace('outline_color.a * outline', '0.0')
text_shader.compile()
world = World()
car = Car()
account = Account()
light = TrafficLight()
sensor = Sensor(args.port, keyboard=args.keyboard, mock=args.mock)
setup = Setup(sensor, keyboard=args.keyboard)
camera.fov = 82
camera.clip_plane_far = 240
bonnet = Entity(parent=camera, model='cube', position=(0,-.72,1.3), scale=(1.45,.22,1.1), color=color.rgb32(37,87,110))
hud = Text(position=(-.74,.46), scale=1.15)
notice = Text(origin=(0,0), position=(0,.21), scale=1.8, color=color.rgb32(255,208,95))
setup_panel = Entity(parent=camera.ui, model='quad', scale=(1.52,.94),
                     color=color.rgb32(14,24,35), z=.1)
setup_title = Text('CONTROLLER SETUP', origin=(0,0), position=(0,.39), scale=1.7)
setup_mode = Text(origin=(0,0), position=(0,.32), scale=1)
setup_text = Text(origin=(0,0), position=(0,.20), scale=1.8)
setup_detail = Text(origin=(0,0), position=(0,.07), scale=.88)
setup_checks = Text(origin=(0,0), position=(0,-.015), scale=1)
setup_live = Text(origin=(0,0), position=(0,-.10), scale=.95)
start_button = Button('START  [ENTER]', position=(0,-.205), scale=(.40,.075),
                      color=color.rgb32(35,67,75), text_size=1)
setup_help = Text('K: keyboard   M: sensor   R: restart setup\n'
                  'Sensor direction reversed?  X: left/right   F: forward/back',
                  origin=(0,0), position=(0,-.34), scale=.82)
setup_widgets = (setup_panel,setup_title,setup_mode,setup_text,setup_detail,
                 setup_checks,setup_live,start_button,setup_help)
shade = Entity(parent=camera.ui, model='quad',scale=(2,1),color=color.rgba32(8,15,23,225),z=.1,enabled=False)
game_over_text = Text(origin=(0,0),scale=2,enabled=False)
debug = Text(position=(-.74,-.44),scale=.75,enabled=args.debug)
for label in (hud, notice, setup_title, setup_mode, setup_text, setup_detail,
              setup_checks, setup_live, start_button.text_entity, setup_help, game_over_text, debug):
    label.setShader(text_shader._shader, 200)
    for key, value in text_shader.default_input.items():
        label.setShaderInput(key, value)
smoke_frames = 0


def restart():
    car.reset()
    account.reset()
    light.reset()
    world.reset()
    if not setup.keyboard:
        sensor.connect()
        sensor.poll()  # Anchor R to the newest received pose.
    setup.reset()
    sync_view()


def driving_keys():
    return (held_keys['d']-held_keys['a'], held_keys['w']-held_keys['s'],
            any(held_keys[key] for key in ('a','d','w','s','space')))


def start_game():
    horizontal, vertical, keys_down = driving_keys()
    sensor.poll()
    setup.update(0,horizontal,vertical,keys_down)
    started = setup.start()
    sync_view()
    return started


start_button.on_click = start_game


def sync_view():
    camera.position=(car.x,1.65,car.z)
    camera.rotation=(0,car.heading,0)
    debt = f'-${abs(account.money):,}' if account.money < 0 else f'${account.money:,}'
    money_markup = f'<red>{debt}<default>' if account.money < 0 else debt
    hud.text=f'SPEED  {abs(car.speed)*3.6:5.1f} km/h\nMONEY  {money_markup}\nSTEERING  {sensor.steering*100:+.0f}%'
    notice.text=account.notice if account.notice_time > 0 and not account.game_over else ''
    for widget in setup_widgets:
        widget.enabled=not setup.done
    hud.enabled=setup.done
    setup_mode.text='KEYBOARD MODE' if setup.keyboard else 'SENSOR MODE'
    setup_text.text=setup.message
    setup_text.color=color.rgb32(90,225,172) if setup.stage=='CONFIRMED' else color.white
    setup_detail.text=setup.detail
    setup_checks.text='   '.join(f'{name}: {"OK" if name in setup.checked else "--"}'
                                 for name in Setup.DIRECTIONS)
    horizontal,vertical,_=driving_keys()
    if not setup.keyboard:
        horizontal,vertical=sensor.horizontal,sensor.vertical
    threshold=.5 if setup.keyboard else cfg.DEAD_ZONE
    side='LEFT' if horizontal < -threshold else 'RIGHT' if horizontal > threshold else 'CENTER'
    tilt='FORWARD' if vertical > threshold else 'BACKWARD' if vertical < -threshold else 'STOPPED'
    setup_live.text=f'LIVE INPUT   {side} / {tilt}'
    start_button.disabled=not setup.can_start
    start_button.color=color.rgb32(35,153,133) if setup.can_start else color.rgb32(49,59,69)
    shade.enabled=game_over_text.enabled=account.game_over
    game_over_text.text=f'GAME OVER\nYOU ARE BANKRUPT\n\nDEBT\n{debt}\n\nPRESS R TO RESTART'
    debug.text=f'roll={sensor.roll:.2f} pitch={sensor.pitch:.2f} centers={sensor.center:.2f}/{sensor.pitch_center:.2f}\nserial={sensor.available} mode={"keyboard" if setup.keyboard or not sensor.available else "sensor"}\nlight={light.state} x={car.x:.1f} z={car.z:.1f}'


def input(key):
    if key == 'r':
        restart()
    elif key == 'c':
        # Recalibration always stops the car and repeats direction checks.
        restart()
    elif key == 'enter' and not setup.done:
        start_game()
    elif key == 'k' and not setup.done:
        setup.use_keyboard()
        restart()
    elif key == 'm' and not setup.done:
        setup.use_sensor()
        restart()
    elif key in ('x','f') and not setup.done and not setup.keyboard:
        if key == 'x':
            sensor.roll_sign *= -1
        else:
            sensor.pitch_sign *= -1
        restart()
    elif key == 'escape':
        sensor.close()
        application.quit()


def step(dt, throttle=0, steering_keys=0, brake=False, keys_down=False):
    sensor.poll()
    setup.update(dt,steering_keys,throttle,keys_down or bool(throttle or steering_keys or brake))
    if not setup.done:
        sensor.steering=sensor.throttle=0.0
        return
    steering=sensor.update(dt,steering_keys,enabled=not setup.keyboard)
    drive=sensor.update_throttle(dt,throttle,enabled=not setup.keyboard)
    if not account.game_over:
        account.update(dt)
        light.update(dt)
        world.update(dt,light.state)
        old_x,old_z=car.x,car.z
        car.update(dt,drive,steering,brake)
        collision=world.collision(car.x,car.z)
        if collision:
            account.collision(collision)
            car.x,car.z=old_x,old_z
            car.speed=0
        if light.violation(old_x,old_z,car.x,car.z):
            account.fine(cfg.RED_LIGHT_FINE,'RED LIGHT VIOLATION')
        if account.game_over:
            car.speed=0


def capture(suffix):
    if args.screenshot:
        sync_view()
        app.graphicsEngine.renderFrame()
        app.graphicsEngine.renderFrame()
        target=args.screenshot.with_stem(args.screenshot.stem+suffix)
        assert app.screenshot(namePrefix=str(target), defaultFilename=False)
        from PIL import Image
        with Image.open(target) as frame:
            assert len(frame.convert('RGB').getcolors(frame.width*frame.height) or []) > 8, 'blank rendered frame'


def rendered_checks():
    def tick(seconds, throttle=0, steer=0):
        for _ in range(round(seconds*100)):
            step(.01,throttle,steer)

    def keyboard_ready():
        setup.use_keyboard()
        tick(3.1)
        for throttle,steer in ((0,-1),(0,1),(1,0),(-1,0)):
            tick(.4,throttle,steer)
            tick(.4)
        assert setup.can_start and not setup.done

    def enter_game():
        keyboard_ready()
        assert start_game()

    restart()
    assert not start_game(), 'premature start blocked'
    tick(.2,1,1)
    assert car.speed==0 and (car.x,car.z)==cfg.START_POSITION
    enter_game()
    start=car.z
    tick(1,1)
    assert car.z>start+2 and car.speed>0
    tick(.1,1,1)
    assert car.heading>0
    input('r')
    assert not setup.done and setup.checked==[] and car.speed==0
    enter_game()
    light.elapsed=cfg.GREEN_SECONDS+cfg.YELLOW_SECONDS
    car.z=-5.1
    car.speed=10
    step(.02)
    assert account.money==-cfg.RED_LIGHT_FINE
    capture('-red-light')
    car.x,car.z=world.solids[0][:2]
    step(.02)
    assert 'PROPERTY DAMAGE' in account.notice
    account.cooldown=0
    car.x,car.z=world.ai[0]['entity'].x,world.ai[0]['entity'].z
    step(.02)
    assert 'CRASH!' in account.notice
    account.money=cfg.BANKRUPTCY_THRESHOLD
    old=(car.x,car.z)
    step(.1,1)
    sync_view()
    assert (car.x,car.z)==old and game_over_text.enabled
    capture('-game-over')
    input('r')
    assert account.money==0 and car.speed==0 and light.state=='GREEN'
    assert not account.game_over and account.cooldown==0 and not light.crossed
    assert (car.x,car.z)==cfg.START_POSITION and not setup.done and not game_over_text.enabled
    assert all(c['distance']==c['start'] for c in world.ai)
    capture('-center')
    # Restart must show CENTER immediately, even at nonzero raw sensor angles.
    sensor.mock=True
    sensor.roll,sensor.pitch=23,-17
    setup.keyboard=False
    input('r')
    assert setup.stage=='CENTER' and sensor.horizontal==sensor.vertical==0
    assert 'CENTER / STOPPED' in setup.message
    assert car.speed==sensor.throttle==sensor.steering==0
    capture('-restart-center')
    # Full two-axis mock setup and pitch-driven acceleration/braking/reverse.
    sensor.mock=True
    sensor.roll=sensor.pitch=0
    setup.keyboard=False
    restart()
    tick(3.2)
    assert setup.stage=='LEFT'
    for roll,pitch in ((-20,0),(20,0),(0,-20),(0,20)):
        sensor.roll,sensor.pitch=roll,pitch
        tick(.4)
        sensor.roll=sensor.pitch=0
        assert setup.stage=='CONFIRMED'
        capture('-'+setup.confirmed.lower()+'-confirmed')
        tick(.4)
    assert setup.can_start and not setup.done
    capture('-ready')
    tick(.5)
    assert not setup.done, 'READY never auto-starts'
    assert start_game()
    sensor.pitch=-25
    tick(1)
    assert car.speed>4, 'forward tilt accelerates'
    forward_speed=car.speed
    sensor.pitch=25
    tick(.5)
    assert car.speed<forward_speed, 'back tilt brakes'
    tick(1)
    assert car.speed<0, 'held back tilt reverses'
    input('r')
    assert not setup.done and sensor.center==sensor.roll and sensor.pitch_center==sensor.pitch
    assert sensor.throttle==sensor.steering==car.speed==0
    # Disconnect drops sensor throttle immediately; keyboard remains usable.
    enter_game()
    setup.keyboard=False
    sensor.mock=False
    sensor.last_read=None
    sensor.throttle=1
    step(.01)
    assert sensor.throttle==0
    tick(.5,1,-1)
    assert car.speed>0 and sensor.steering<0
    setup.keyboard=True
    restart()
    keyboard_ready()
    capture('-keyboard-ready')
    assert start_game()
    print('SETUP INTEGRATION: PASS (four directions, neutral return, manual START, R, keyboard)',flush=True)
    print('PITCH DRIVE: PASS (forward acceleration, back braking/reverse, disconnect fallback)',flush=True)
    print('RENDERED INTEGRATION: PASS (movement, fines, collisions, bankruptcy, full restart)',flush=True)


def update():
    global smoke_frames
    if args.smoke_test:
        smoke_frames += 1
        if smoke_frames==2:
            rendered_checks()
        if smoke_frames==120:
            capture('')
            print('GUI SMOKE: PASS',flush=True)
            sensor.close()
            application.quit()
        return
    dt=min(time.dt,.05)
    if args.mock:
        sensor.roll=(held_keys['right arrow']-held_keys['left arrow'])*25
        sensor.pitch=(held_keys['down arrow']-held_keys['up arrow'])*25
    # Substeps prevent tunnelling at the configured maximum speed.
    remaining=dt
    while remaining>0:
        part=min(remaining,1/120)
        horizontal,vertical,keys_down=driving_keys()
        step(part,vertical,horizontal,held_keys['space'],keys_down)
        remaining-=part
    sync_view()

sync_view()
try:
    app.run()
finally:
    sensor.close()
