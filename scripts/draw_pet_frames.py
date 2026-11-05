"""Draw original Dr. Meow character and prop cels on a shared 192-unit stage."""

from functools import lru_cache
from math import cos, pi, sin
from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageOps

from painted_pet_art import face, head_box, load_art, place, tail_box

SIZE = 192
TILE = 224
SCALE = 2
SKINS = {
    "original": dict(cream="#fff2df",ink="#845751",shade="#d88657",
                     quilt="#dea7a2",pillow="#fff1db",sx=1,sy=1),
    "ragdoll": dict(cream="#fff6ed",ink="#786272",shade="#ccb2ae",
                    quilt="#a5b8d4",pillow="#f1f2fb",sx=.98,sy=1.03),
    "british": dict(cream="#c2cade",ink="#606982",shade="#8992b0",
                    quilt="#acaecb",pillow="#e5e6f2",sx=1.07,sy=.94),
    "calico": dict(cream="#fff8e8",ink="#795652",shade="#dca593",
                   quilt="#dcae89",pillow="#fff1d7",sx=.96,sy=1),
}


@lru_cache(maxsize=128)
def tint(color, target, weight):
    a = ImageColor.getrgb(color)
    b = ImageColor.getrgb(target)
    return tuple(round(x+(y-x)*weight) for x,y in zip(a,b))


def palette(color, shade="#815063", depth=.24, light=.64):
    return tint(color,"#fffaf1",light), color, tint(color,shade,depth)


@lru_cache(maxsize=96)
def wash_strip(colors):
    return ImageOps.colorize(Image.linear_gradient("L"),colors[0],colors[2],colors[1]).crop((0,0,1,256))


def wash_into(image, mask, bounds, colors):
    left, top, right, bottom = bounds
    size = right-left,bottom-top
    if min(size) > 0:
        image.paste(wash_strip(colors).resize(size,Image.Resampling.BILINEAR), (left,top), mask)


def spline(start, *segments, steps=8):
    points = [start]
    for segment in segments:
        if len(segment) == 2:
            points.append(segment)
            continue
        x, y = points[-1]
        a, b, c, d, e, f = segment
        for step in range(1, steps+1):
            t = step / steps
            r = 1 - t
            points.append((r**3*x + 3*r*r*t*a + 3*r*t*t*c + t**3*e,
                           r**3*y + 3*r*r*t*b + 3*r*t*t*d + t**3*f))
    return points


class Pen:
    def __init__(self, image, x=0, y=0, angle=0, sx=1, sy=1):
        self.image = image
        self.draw = ImageDraw.Draw(image)
        self.x, self.y, self.sx, self.sy = x, y, sx, sy
        self.angle = angle
        self.c, self.s = cos(angle*pi/180), sin(angle*pi/180)

    def point(self, x, y):
        return (self.x + x*self.sx*self.c - y*self.sy*self.s,
                self.y + x*self.sx*self.s + y*self.sy*self.c)

    def points(self, points):
        return [(round(SCALE*x),round(SCALE*y)) for x,y in (self.point(*point) for point in points)]

    def shape(self, points, fill, ink=None, width=1.5):
        points = self.points(points)
        self.draw.polygon(points, fill)
        if ink:
            self.draw.line(points + points[:1], ink, width=max(1, round(width*SCALE)), joint="curve")

    def wash(self, points, colors, ink=None, width=1.35):
        points = self.points(points)
        xs,ys = zip(*points)
        left,top,right,bottom = min(xs),min(ys),max(xs)+1,max(ys)+1
        mask = Image.new("L",(right-left,bottom-top))
        ImageDraw.Draw(mask).polygon([(x-left,y-top) for x,y in points],fill=255)
        wash_into(self.image,mask,(left,top,right,bottom),colors)
        if ink:
            self.draw.line(points+points[:1],ink,width=max(1,round(width*SCALE)),joint="curve")

    def oval_wash(self, x, y, rx, ry, colors, ink=None, width=1.2):
        self.wash([(x+rx*cos(i*pi/18),y+ry*sin(i*pi/18)) for i in range(36)],colors,ink,width)

    def line(self, points, fill, width=1.2):
        points = self.points(points)
        self.draw.line(points, fill, width=max(1, round(width*SCALE)), joint="curve")
        r = max(.5, (width*SCALE - 1)/2)
        for x, y in [points[0], points[-1]]:
            self.draw.ellipse((x-r, y-r, x+r, y+r), fill)

    def oval(self, x, y, rx, ry, fill, ink=None, width=1.5):
        self.shape([(x+rx*cos(i*pi/18), y+ry*sin(i*pi/18)) for i in range(36)], fill, ink, width)


def mix(a, b, progress):
    return a+(b-a)*progress


def foreleg(image, shoulder, paw, side, c, fur, pad=0, curl=0):
    """Paint one continuous contour from the chest through elbow and paw."""
    sx, sy = shoulder
    x, y = paw
    dx, dy = x-sx, y-sy
    fold = min(1,max(0,(27-dy)/37))
    ex = sx+.55*dx+side*(2+7*fold+4*curl)
    ey = sy+.48*dy+15*fold+19*curl
    middle = spline(
        shoulder,
        (sx+.16*dx,sy+9,ex-side*3,ey-1,ex,ey),
        (ex+side*3,ey+1,x+.18*(ex-x),y+.25*(ey-y),x,y),
        steps=15,
    )
    stroke = Image.new("RGBA",image.size)
    inside = Image.new("L",image.size)
    outer_ink = ImageDraw.Draw(stroke)
    inner_ink = ImageDraw.Draw(inside)
    p = Pen(stroke)

    def section(brush, ax, ay, rx, ry, color):
        bounds = (ax-rx,ay-ry,ax+rx,ay+ry)
        brush.ellipse(tuple(round(v*SCALE) for v in bounds),color)
    # Sample overlapping ovals along the joints so even a deeply folded
    # elbow stays filled. A shared outer contour leaves no seam at the wrist.
    contour = []
    for index,(ax,ay) in enumerate(middle):
        progress = index/(len(middle)-1)
        radius = (mix(10.8,7.2,progress)+1.4*progress**8)*c["sx"]
        contour.append((ax,ay,radius,radius*(1-.10*progress)))
    edge = tint(c["cream"],c["ink"],.48)
    for ax,ay,rx,ry in contour:
        section(outer_ink,ax,ay,rx,ry,edge)
    for index,(ax,ay,rx,ry) in enumerate(contour):
        inset = min(.66,index*.13)
        section(inner_ink,ax,ay,rx-inset,ry-inset,255)
    left,top,right,bottom = bounds = inside.getbbox()
    coat = fur.resize((right-left,bottom-top),Image.Resampling.BICUBIC)
    stroke.paste(coat,(left,top),inside.crop(bounds))

    if pad > 0:
        paw_pink = ("#f8bbc4","#e9a0ad","#bf7e99")
        p.oval_wash(x,y+1.5,3.5*pad,2.5*pad,paw_pink)
        for i in (-1,0,1):
            p.oval_wash(x+i*3.35,y-2.2-abs(i-1)*.25,1.35*pad,1.4*pad,paw_pink)
    for i in (-1,1):
        p.line([(x+i*2.55,y+5.7),(x+i*2.1,y+4.15)],c["shade"],.75)
    image.alpha_composite(stroke)
    return stroke


def overlap_cheek(image, foreleg_image, shoulder_x, strength):
    # Only the distal part crosses in front of the cheek. The shoulder and
    # elbow use the very same silhouette painted below the head.
    bounds = foreleg_image.getbbox()
    layer = foreleg_image.crop(bounds)
    opacity = Image.new("L",(layer.width,1))
    threshold = (shoulder_x+6)*SCALE-bounds[0]
    opacity.putdata([round(255*strength*max(0,min(1,(x-threshold)/(8*SCALE)))) for x in range(layer.width)])
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"),opacity.resize(layer.size)))
    image.alpha_composite(layer,bounds[:2])


def forepaw(side, c, pose, clip, body, head_center):
    tuck, drag, brace = (pose.get(key,0) for key in ("tuck","drag","brace"))
    travel = max(tuck,drag)
    shoulder = body.point(side*15,-22)
    x = 94+side*(14-4*tuck+7*brace)*c["sx"] + (body.x-94)*travel
    y = 161+(body.y-138)*travel-16*drag+6*brace
    if clip == "waking":
        seam = 170-42*pose.get("cover",0)
        y = mix(y,min(y,seam),min(1,brace*1.5))
    active = pose.get("active",0)
    reach = pose.get("reach",0) if active*side > 0 else 0
    if not reach:
        return shoulder,(x,y),reach

    goal_x,goal_y = x+pose.get("paw_x",0), y+pose.get("paw_y",0)
    if clip == "yarn":
        # Paw's contour meets the ball before it rolls.
        goal_x,goal_y = 148-10.5-8.6*c["sx"]+min(5,pose.get("ball",0)),159
    elif clip == "reading":
        a = pose.get("page",0)*pi
        goal_x,goal_y = 138+17*cos(a)+3,147-21*sin(a)
    elif clip == "experiment":
        goal_x,goal_y = 127,153
    elif clip == "math":
        mx,my = writing_point(pose.get("marks",0))
        goal_x,goal_y = 142+mx-12,157+my-13-9*(1-pose.get("pen",0))
    elif clip == "eating-can":
        goal_x,goal_y = 121,164
    elif clip.startswith("eating-"):
        carry = pose.get("carry",0)
        mx,my = mouth_point(*head_center,pose,c)
        goal_x,goal_y = mix(143,mx+10,carry),mix(157,my+11,carry)
    return shoulder,(mix(x,goal_x,reach),mix(y,goal_y,reach)-pose.get("lift",0)),reach


def bed(p, c, spread, cover, front, breath=0):
    if spread < .02:
        return
    left, right = 95-73*spread, 95+73*spread
    ink, cover_color = c["ink"], c["quilt"]
    if not front:
        p.oval(96,173,78*spread,9, "#d4bdc4")
        p.shape(spline((left,159), (left+1,150,left+3,149,left+12,149), (right-13,149),
                       (right-3,149,right,156,right,167), (right-2,172,right-8,174,right-17,174),
                       (left+16,174), (left+5,174,left-2,168,left,159)), cover_color, ink, 1.35)
        p.oval_wash(95,143,62*spread,19,palette(c["pillow"],cover_color,.38),ink,1.2)
        p.line(spline((95-51*spread,141), (73,133,113,133,95+51*spread,141)), "#e0cbd0",1.15)
    elif cover > .01:
        y = 167-42*cover-.9*breath
        top_left, top_right = 95-61*spread, 95+58*spread
        seam = spline((top_left,y),(95-32*spread,y-7,95+30*spread,y-6,top_right,y),
                      (right,146,right+1,165,right-7*spread,170),
                      (95+39*spread,178,95-33*spread,176,left+7*spread,170),
                      (left+2,165,left+6,y+6,top_left,y))
        p.wash(seam,palette(cover_color,ink,.30,.38),ink,1.35)
        if spread > .17:
            p.line(spline((top_left+2,y+3),(95-33*spread,y-2,95+33*spread,y-1,top_right-1,y+3)),
                   "#fff0e4",1.55)
        embroidery = tint(cover_color,"#fff7e7",.69)
        for x in range(50,146,18):
            if top_left+5 < x < top_right-5:
                for yy in range(round(y+12),166,14):
                    p.oval(x,yy,1.8,1.2,embroidery)
                    for dx,dy in [(-2,-1.4),(0,-2.5),(2,-1.4)]:
                        p.oval(x+dx,yy+dy,.57,.63,embroidery)


def mouth_point(x, y, pose, c):
    angle = pose.get("tilt",0)*pi/180
    local_x = pose.get("gaze",0)*3.5*c["sx"]
    local_y = (19+pose.get("look_down",0)*3)*c["sy"]
    return (x+local_x*cos(angle)-local_y*sin(angle),y+local_x*sin(angle)+local_y*cos(angle))


def draw_frame(skin, pose, clip):
    c = SKINS[skin]
    art = load_art(skin)
    im = Image.new("RGBA",(SIZE*SCALE,SIZE*SCALE))
    p = Pen(im)
    body_x = 94 + pose.get("body_x",0)
    body_y = 138 + pose.get("body_y",0)
    x = 94 + pose.get("head_x",0)
    y = 87 + pose.get("head_y",0)
    breathing = pose.get("breath",0)
    tuck = pose.get("tuck",0)
    drag = pose.get("drag",0)
    tail = pose.get("tail",0)
    spread, cover = pose.get("bed",0), pose.get("cover",0)
    if drag < .95:
        p.oval(94,172,49+10*spread,4.6-3*drag,(101,70,72, round(38*(1-drag))))
    bed(p,c,spread,cover,False)
    b = Pen(im,body_x,body_y,pose.get("lean",0),c["sx"],c["sy"]*(1+breathing*.012))
    tail_angle = tail-16*tuck
    tail_rect,tail_left = tail_box(skin,tail_angle*pi/180)
    tail_x = max(body_x-27,4-tail_left)
    tail_pen = Pen(im,tail_x,body_y+21,tail_angle)
    place(im,art.tail,tail_pen,tail_rect,SCALE)
    # The hindquarters remain over the floor while the chest shifts forward.
    hips = Pen(im,94+(body_x-94)*(.56+.44*tuck),body_y,pose.get("lean",0)*.32,b.sx,b.sy)
    floor = 171+(body_y-138)*max(tuck,drag)
    place(im,art.body,hips,(-43,-20,43,(floor-body_y)/b.sy),SCALE)
    left = forepaw(-1,c,pose,clip,b,(x,y))
    right = forepaw(1,c,pose,clip,b,(x,y))
    foreleg(im,left[0],left[1],-1,c,art.fur)
    prop = pose.get("prop",0)
    meal = clip.startswith("eating-")
    if prop > 0 and not meal:
        draw_prop(im,skin,pose,clip,x,y)

    greeting = clip in ("happy","greet","farewell")
    pad = max(0,(right[2]-.46)/.54) if greeting else 0
    curl = pose.get("carry",0) if meal and clip != "eating-can" else pad*.58
    near_leg = foreleg(im,right[0],right[1],1,c,art.fur,pad,curl)
    face_pen = Pen(im,x,y,pose.get("tilt",0),c["sx"],c["sy"])
    eyelid = round(16*min(1,max(0,pose.get("lid",0))))
    smile = round(16*min(1,max(0,pose.get("mouth",0)*1.48)))
    gaze = round(3*pose.get("gaze",0))
    down = round(3*pose.get("look_down",0))
    place(im,face(skin,eyelid,smile,gaze,down),face_pen,head_box(art,skin,pose),SCALE)
    if pad > 0:
        overlap_cheek(im,near_leg,right[0][0],pad)
    if prop > 0 and meal:
        draw_prop(im,skin,pose,clip,x,y)
    if clip == "math" and prop > 0:
        px,py = right[1]
        grip = min(1,right[2]*1.9)
        x1,y1 = mix(119,px-3,grip),mix(155,py-7,grip)
        x2,y2 = mix(133,px+12,grip),mix(158,py+13,grip)
        if prop < 1:
            x1,y1,x2,y2 = (142+(x1-142)*prop,157+(y1-157)*prop,142+(x2-142)*prop,157+(y2-157)*prop)
        p.line([(x1,y1),(x2,y2)],"#8d6558",2.5*prop)
        p.line([(mix(x1,x2,.8),mix(y1,y2,.8)),(x2,y2)],"#e7c79e",1.8*prop)
        p.oval(x2,y2,.7*prop,.7*prop,"#5b4e66")
    # A single moving seam occludes each pixel as the cat tucks in or rises.
    bed(p,c,spread,cover,True,breathing)
    return im.resize((TILE,TILE),Image.Resampling.LANCZOS)


WRITING = [(-13,-2),(-10,-4),(-7,-2),(-4,-3),(-1,-2),(3,-4),(6,-3),(9,-4),(13,-2)]


def writing_point(progress):
    amount = progress*(len(WRITING)-1)
    i = min(int(amount),len(WRITING)-2)
    x,y = WRITING[i]
    xx,yy = WRITING[i+1]
    return x+(xx-x)*(amount-i),y+(yy-y)*(amount-i)


def draw_prop(im, skin, pose, clip, x, y):
    c = SKINS[skin]
    f = pose["prop"]
    if clip == "yarn":
        ball = 148+pose.get("ball",0)
        by = 159
        p = Pen(im,ball,by,pose.get("ball",0)*4, f, f)
        p.oval_wash(0,0,10.5,10.4,("#f8ced8","#dca0b7","#aa6b91"),"#925d80",1.05)
        p.line(spline((-9,3),(-4,-5,2,-7,7,-6)),"#af6e94",1)
        p.line(spline((-7,7),(-3,-1,3,-5,9,-4)),"#f2cfda",1.1)
        p.line(spline((-4,9),(1,2,4,0,10,0)),"#af6e94",.9)
        p.line(spline((7,7),(10,9,11,14,15,13)),"#b67596",1)
        return
    if clip.startswith("eating-"):
        bite = pose.get("bite",0)
        mx,my = mouth_point(x,y,pose,c)
        if clip == "eating-fish":
            carry = pose.get("carry",0)
            p = Pen(im,mix(143,mx+1,carry),mix(163,my+4,carry),-25*carry,
                    max(.08,1-bite)*f,max(.08,1-bite)*f)
            p.shape(spline((-10,0),(-6,-7,0,-6,6,-2),(12,-5),(11,0),(12,5),(6,2),
                           (0,6,-7,6,-10,0)),"#a1b7c7","#5d7488",1.1)
            p.oval(-5.3,-.9,1,1,"#587086")
        elif clip == "eating-can":
            p = Pen(im,139,161,0,f,f)
            p.shape([(-15,-1),(-12,9),(11,9),(15,-1)],"#bb8a82","#82595f",1.2)
            p.oval(0,0,15,5.3,"#f1d0bb","#82595f",1.2)
            p.oval(0,-1,12,3.65,"#a96562" if bite<.8 else "#c6a095")
            p.line([(-7,5),(-3,4),(1,6),(6,5)],"#f8dfc7",.8)
        else:
            carry = pose.get("carry",0)
            p = Pen(im,145+(mx+16-145)*carry,157+(my+7-157)*carry,29*carry-8,f,f)
            p.shape([(-14,-3.5),(13,-3.5),(15,0),(13,3.7),(-14,3.7)],"#d89492","#90646e",1.1)
            p.line([(6,-2.8),(6,3)],"#ffe3d0",.8)
            p.line([(9,-2.8),(9,3)],"#ffe3d0",.8)
            if bite < .8:
                p.oval(-14,0,2.3,1.8,"#d2a08e")
        return
    if clip == "reading":
        p = Pen(im,138,155,0,f,f)
        page = pose.get("page",0)
        p.wash([(-24,-6),(0,-8),(24,-7),(26,8),(2,12),(-24,8)],
               ("#b39ac8","#9e88b3","#786188"),"#6b527c",1.2)
        p.wash(spline((-22,-7),(-15,-12,-4,-10,0,-6),(7,-11,18,-11,23,-8),
                      (23,6),(8,7,4,8,0,10),(-8,7,-16,8,-22,6)),
               ("#fff8e7","#f9ead2","#e5c9af"),"#ae8d9a",.9)
        for dy in (-3,1,4):
            p.line([(-18,dy),(-8,dy+.6),(-3,dy+1)],"#caab9f",.7)
            if page < .99:
                p.line([(5,dy+.4),(16,dy-.9)],"#caab9f",.7)
        if page >= .99:
            p.shape([(10,-6),(11,-2),(15,-2),(12,0),(13,4),(10,2),(7,4),(8,0),(5,-2),(9,-2)],
                    "#d2ab77")
        if 0 < page < 1:
            a = page*pi
            ex, ey = 17*cos(a), -5-21*sin(a)
            p.shape(spline((0,-5),(ex*.28,-8,ex*.76,ey,ex,ey),
                           (ex+1,ey+9),(ex*.7,ey+12,ex*.25,6,0,9)),
                    "#fff8e8","#ae8d9a",1)
        return
    if clip == "math":
        p = Pen(im,142,157,0,f,f)
        p.shape([(-23,-7),(15,-10),(25,8),(-19,11)],"#fff1d9","#be9b99",1.05)
        for i in range(3):
            p.line([(-17,-2+i*4),(17,-4+i*4)],"#ead1bf",.8)
        progress = pose.get("marks",0)
        count = int(progress*(len(WRITING)-1))+1
        if progress > 0:
            p.line(WRITING[:count]+[writing_point(progress)],"#897291",1)
        return
    if clip == "experiment":
        p = Pen(im,147,150,0,f,f)
        p.shape(spline((-6,-15),(6,-15),(6,-8),(7,-5),(15,5),(15,9,10,14,0,14),
                       (-12,14,-15,9,-13,4),(-6,-7),(-6,-15)),
                "#d8efdf","#689294",1.15)
        p.shape(spline((-9,3),(-5,-1,0,6,10,2),(13,8,8,12,0,12),(-10,12,-11,8,-9,3)),
                "#8fc9af")
        p.oval(0,-15,7,2.2,"#e8fbeb","#689294",.95)
        phase = pose.get("bubbles",0)
        for i in range(3):
            age = (phase-i*.14)%1
            if phase > i*.14 and age < .84:
                p.oval((i-1)*3,-3-age*27,1.2+age*1.2,1.2+age*1.2,"#fbf6d9","#81b9a6",.65)
        p.line([(-9,4),(-7,0),(-5,-5)],"#effef3",1.25)

