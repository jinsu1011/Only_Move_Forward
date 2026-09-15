"""One closed practice loop with an intersection and simple moving cars."""
import math
from ursina import Entity, color
from car import circle_box


def route_points():
    points = [(0, -25), (0, 25)]
    for cx, cz, start in [(15,25,180), (45,25,90), (45,-25,0), (15,-25,-90)]:
        for i in range(13):
            a = math.radians(start-i*90/12)
            points.append((cx+15*math.cos(a), cz+15*math.sin(a)))
    return points


class World:
    def __init__(self):
        self.solids = []
        self.route = route_points()
        self.segments = []
        self.length = 0
        Entity(model='plane', scale=260, color=color.rgb32(88,123,83), y=-.08)
        for a,b in zip(self.route, self.route[1:]+self.route[:1]):
            length = math.dist(a,b)
            if length < .001:
                continue
            self.segments.append((a,b,length))
            self.length += length
            self.road(a,b,12)
        self.road((-18,0),(78,0),12)
        # Restore intersection surface over lane stripes, then crosswalk/stop line.
        Entity(model='cube', position=(0,.04,0), scale=(12,.035,12), color=color.rgb32(58,65,74))
        Entity(model='cube', position=(0,.065,-5), scale=(10,.025,.3), color=color.white)
        for x in range(-4,6,2):
            Entity(model='cube', position=(x,.065,-2.8), scale=(1,.025,2), color=color.white)
        for x in (-8, 8, 52, 68):
            for z in (-22, 16, 27):
                self.box(x,z,.3,.3,5,color.rgb32(65,73,82))
                Entity(model='cube', position=(x,5,z), scale=(2,.2,.4), color=color.rgb32(250,228,166))
        for x,z,w,d,h in [(26,18,12,12,13),(37,-18,13,10,9),(-20,23,10,13,16),
                            (80,-20,12,18,12),(27,60,18,12,15)]:
            self.box(x,z,w,d,h,color.rgb32(120,144,162))
            for level in range(2,h,3):
                Entity(model='cube', position=(x,level,z-d/2-.015), scale=(w*.8,.7,.025), color=color.rgb32(184,222,234))
        for x in (-7,67):
            for z in (-17,17):
                self.box(x,z,.35,12,.8,color.rgb32(180,187,193))
        for x,z in [(8,-8),(10,-8),(-8,7)]:
            self.box(x,z,.65,.65,.8,color.orange)
        # Visible junction-end barriers; no roads lead off the map.
        for x in (-18,78):
            self.box(x,0,.5,12,1,color.rgb32(202,189,142))
        self.box(6,-4,.3,.3,5,color.dark_gray)
        Entity(model='cube', position=(6,4.2,-4), scale=(.9,2.5,.7), color=color.rgb32(25,29,36))
        self.lamps = {name: Entity(model='sphere', position=(6,y,-4.4), scale=.55)
                      for name,y in [('RED',4.95),('YELLOW',4.2),('GREEN',3.45)]}
        self.ai = []
        for distance,tint in [(38,color.azure),(115,color.orange),(195,color.violet)]:
            body = Entity(model='cube', scale=(1.8,1.1,3.4), color=tint)
            Entity(parent=body, model='cube', position=(0,.65,-.06), scale=(.8,.65,.5), color=color.rgb32(50,73,85))
            self.ai.append({'entity':body,'start':distance,'distance':distance})
        self.reset()

    def road(self,a,b,width):
        length = math.dist(a,b)
        angle = math.degrees(math.atan2(b[0]-a[0], b[1]-a[1]))
        Entity(model='cube', position=((a[0]+b[0])/2,0,(a[1]+b[1])/2),
               scale=(width,.06,length+.3), rotation_y=angle, color=color.rgb32(58,65,74))
        for i in range(max(1,int(length/4))):
            f=(i+.5)/max(1,int(length/4))
            Entity(model='cube', position=(a[0]+(b[0]-a[0])*f,.04,a[1]+(b[1]-a[1])*f),
                   scale=(.14,.02,min(1.7,length*.6)),rotation_y=angle,color=color.rgb32(247,218,118))

    def box(self,x,z,w,d,h,tint):
        Entity(model='cube',position=(x,h/2,z),scale=(w,h,d),color=tint)
        self.solids.append((x,z,w/2,d/2))

    def pose(self,distance):
        distance %= self.length
        for a,b,length in self.segments:
            if distance <= length:
                f=distance/length
                return a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,math.degrees(math.atan2(b[0]-a[0],b[1]-a[1]))
            distance -= length
        return 0,-25,0

    def reset(self):
        for car in self.ai:
            car['distance']=car['start']
        self.update(0,'GREEN')

    def update(self,dt,state):
        for name,lamp in self.lamps.items():
            lamp.color = {'RED':color.red,'YELLOW':color.yellow,'GREEN':color.lime}[name] if name==state else color.rgb32(44,47,48)
        for car in self.ai:
            car['distance'] += dt*5
            x,z,heading=self.pose(car['distance'])
            car['entity'].position=(x,.65,z)
            car['entity'].rotation_y=heading

    def collision(self,x,z):
        for car in self.ai:
            if math.hypot(x-car['entity'].x,z-car['entity'].z)<2.6:
                return 'car'
        if any(circle_box(x,z,1,bounds) for bounds in self.solids):
            return 'property'
        return None
