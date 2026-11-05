"""Produce all pose cels first, then assemble lossless atlases and a frame manifest.

Run with Python 3 and Pillow from the application directory.
Use --sources to retain the individual transparent PNG cels as well as the atlases.
"""

import argparse
from json import dumps
from math import pi, sin
from pathlib import Path

from PIL import Image, ImageDraw
from draw_pet_frames import SIZE, SKINS, TILE, draw_frame

ROOT = Path(__file__).resolve().parents[1]
COLUMNS = 5
DURATIONS = dict(eating=1550, yarn=5000, sleeping=1150, waking=1050)
CONTACTS = dict(eating=682, yarn=1900, sleeping=1035, waking=840)
BASE = {}
SLEEP = dict(head_y=23, head_x=-6, tilt=-9, body_y=9, body_x=-8, lean=-5, tuck=1, bed=1, cover=1, lid=1)
DRAG = dict(head_y=-6, tilt=-5, body_y=-8, lean=-3, drag=1, gaze=-.25, ears=.6)


def pose(**parts):
    return parts


def clip(duration, keys, **settings):
    return dict(duration=duration, keys=keys, **settings)


def action(duration, *stages, **settings):
    return clip(duration, [(0, BASE), *stages, (duration-32, BASE), (duration, BASE)], **settings)


def pet(side):
    return action(1300,
        (210, pose(head_x=side*3, gaze=side*.6, ears=.7)),
        (460, pose(head_x=side*10, head_y=1, tilt=side*12, body_x=side*3, lean=side*4, lid=.8, gaze=side*.35, mouth=.2)),
        (750, pose(head_x=side*12, head_y=2, tilt=side*15, body_x=side*4, lean=side*6, lid=1, mouth=.25, tail=side*8)),
        (1020, pose(head_x=side*7, tilt=side*6, body_x=side*2, lean=side*2, lid=.6, mouth=.1)), contact=460, step=42)


def gesture(duration, height, smile):
    return action(duration,
        (round(duration*.2), pose(head_y=-2, gaze=.25, tilt=-3, body_x=-2, lean=-4, ears=.6, active=1)),
        (round(duration*.4), pose(head_x=-4, head_y=-3, tilt=-7, body_x=-3, lean=-5, ears=.8,
                                  active=1, reach=1, paw_x=37, paw_y=-height, mouth=smile)),
        (round(duration*.63), pose(head_x=-3, head_y=-2, tilt=-4, body_x=-3, lean=-4,
                                   active=1, reach=1, paw_x=40, paw_y=-height+4, mouth=smile, lid=.2)),
        (round(duration*.81), pose(tilt=-2, body_x=-1, lean=-2, active=1, reach=.47,
                                   paw_x=32, paw_y=-height+8, mouth=.2)), step=42)


def meal(kind):
    is_can = kind == "can"
    is_fish = kind == "fish"
    feel = dict(head_x=34 if is_can else 13, head_y=45 if is_can else 19, body_x=8,
                body_y=6 if is_can else 3, lean=13 if is_can else 8,
                tilt=2 if is_can else 10, gaze=.75, look_down=1, active=1, prop=1, reach=1)
    sniff = dict(head_x=16, head_y=24, gaze=.8, tilt=9, body_x=5, body_y=4, lean=7, look_down=.8,
                 prop=1, active=1, reach=.23)
    def feed(**changes):
        return {**feel, **changes}
    return action(DURATIONS["eating"],
        (210, pose(head_x=5, head_y=7, gaze=.6, prop=.92)),
        (380, sniff),
        (535, feed(carry=.52, lid=.2, mouth=.42)),
        (CONTACTS["eating"], feed(carry=1, mouth=.67, bite=.16, ears=.54)),
        (776, feed(carry=1, bite=.62, lid=.3, mouth=.1, ears=-.28)),
        (862, feed(carry=1, bite=.78, lid=.43, mouth=.38, ears=.26)),
        (950, feed(carry=.98, bite=.97, lid=.45, mouth=.06)),
        (1030, feed(carry=.9, bite=1, lid=.55, mouth=.24)),
        (1170, pose(head_x=9, head_y=12, gaze=.4, look_down=.33, bite=1, lid=.9, prop=0 if is_fish else .8,
                    active=1, reach=.35, carry=.47)),
        (1370, pose(head_y=-2, tilt=-2, lid=.48, prop=.25 if not is_fish else 0, bite=1)),
        contact=CONTACTS["eating"], step=42)


def activity_pose(**changes):
    return dict(head_x=12, head_y=14, tilt=9, gaze=.9, look_down=.8, body_x=6,
                body_y=3, lean=8, prop=1, active=1, **changes)


def activity(**changes):
    return {**activity_pose(), **changes}


CLIPS = {
    "idle": clip(360, [(0, BASE)], loop=0),
    "idle-content": clip(480, [(0, pose(lid=1,mouth=.25,tilt=-2))], loop=0),
    "idle-happy": clip(480, [(0, pose(mouth=.35,ears=.75,head_y=-2))], loop=0),
    "idle-curious": clip(480, [(0, pose(head_x=3,tilt=6,gaze=.73,ears=.8))], loop=0),
    "blink": action(190, (78,pose(lid=1)), (102,pose(lid=1)), step=22),
    "tail": action(1000, (230,pose(tail=-12,ears=.25)), (480,pose(tail=14)),
                   (720,pose(tail=-5,tilt=1))),
    "stretch": action(1450,
        (280,pose(head_y=6,tilt=-3,body_y=3,brace=.2,lid=.72)),
        (620,pose(head_x=3,head_y=23,tilt=5,body_x=-3,body_y=9,lean=5,brace=1,lid=.96,mouth=.58,tail=13)),
        (840,pose(head_x=3,head_y=23,tilt=5,body_x=-3,body_y=9,lean=5,brace=1,lid=.96,mouth=.36,tail=15)),
        (1100,pose(head_y=3,tilt=-4,body_y=1,brace=.26,lid=.37)), step=42),
    "greet": gesture(900,53,.52),
    "farewell": gesture(1050,46,.15),
    "happy": gesture(1200,51,.63),
    "error": action(1250, (250,pose(head_x=-3,tilt=-7,ears=-.8)),
                    (590,pose(head_x=-5,tilt=-13,ears=-1,head_y=2,gaze=-.65)),
                    (970,pose(head_x=-2,tilt=-6,lid=.8))),
    "petting-left": pet(-1),
    "petting-right": pet(1),
    "eating-fish": meal("fish"),
    "eating-can": meal("can"),
    "eating-treat": meal("treat"),
    "yarn": action(DURATIONS["yarn"],
        (650,pose(prop=1,gaze=.85,tilt=5,head_y=3)),
        (1250,activity(head_y=10,reach=.2,lift=2)),
        (1630,activity(body_x=8,lean=10,reach=.65,lift=8)),
        (CONTACTS["yarn"],activity(head_x=15,body_x=9,lean=11,reach=1,ears=.55)),
        (2180,activity(head_x=19,body_x=9,lean=11,reach=.91,ball=8,gaze=1,ears=.7)),
        (2590,activity(head_x=18,head_y=8,reach=.55,ball=16,gaze=1,lift=3)),
        (3110,pose(head_x=8,tilt=6,head_y=3,prop=1,ball=18,gaze=1)),
        (4070,pose(head_x=3,tilt=3,prop=.8,ball=18,gaze=.72,lid=.3)),
        (4670,pose(tilt=0,prop=0)), contact=CONTACTS["yarn"]),
    "reading": action(6000,
        (570,pose(prop=1,head_x=5,head_y=8,gaze=.65,look_down=.45)),
        (1240,activity(gaze=.48)),
        (2100,activity(gaze=.84,reach=.45)),
        (2440,activity(reach=1,page=0)),
        (2730,activity(head_y=11,reach=1,page=.34)),
        (3050,activity(head_y=10,reach=1,page=.73,gaze=.64)),
        (3330,activity(reach=1,page=1,gaze=.52)),
        (3780,activity(reach=.02,page=1,gaze=.38)),
        (4850,activity(reach=0,page=1,gaze=.82)),
        (5520,pose(prop=.38,head_y=7,tilt=5,gaze=.5,page=1)),
        (5760,pose(page=1)), contact=2440),
    "math": action(6000,
        (530,pose(prop=1,head_y=9,gaze=.65)),
        (1340,activity(gaze=.52,reach=.45)),
        (1780,activity(reach=.76,pen=.65)),
        (2230,activity(reach=1,pen=1,marks=0)),
        (3050,activity(reach=1,pen=1,marks=.50)),
        (3420,activity(head_y=5,look_down=.15,gaze=-.22,reach=.94,pen=.55,marks=.50)),
        (3730,activity(head_y=4,look_down=.1,gaze=-.28,reach=.94,pen=.52,marks=.50)),
        (4110,activity(reach=1,pen=1,marks=.50)),
        (4900,activity(reach=1,pen=1,marks=1)),
        (5380,activity(head_y=4,gaze=.4,reach=.43,pen=.46,marks=1,mouth=.3)),
        (5630,pose(head_y=-2,prop=.4,marks=1)), contact=2230),
    "experiment": action(5500,
        (600,pose(prop=1,head_y=3,gaze=.85)),
        (1250,activity(reach=.45)),
        (1780,activity(reach=1)),
        (2280,activity(reach=1,bubbles=.24,head_x=16,head_y=8,look_down=.3)),
        (3100,activity(reach=1,bubbles=.78,body_x=-1,head_x=5,head_y=-4,tilt=-6,look_down=0,mouth=.21)),
        (3970,activity(reach=.95,bubbles=1.36,head_x=16,head_y=4,look_down=.32,tilt=7)),
        (4750,activity(reach=.08,bubbles=1.82,head_y=7,prop=.8)),
        (5180,pose(head_y=4,prop=.25)), contact=1780),
    "thinking": clip(2900, [
        (0,BASE),(360,pose(tilt=-8,head_x=-2,head_y=-3,gaze=-.45)),
        (1040,pose(tilt=-9,head_x=-2,head_y=-3,gaze=-.55,ears=.4)),
        (1700,pose(tilt=-7,head_x=-2,head_y=-3,gaze=-.4,lid=.38)),
        (2150,pose(tilt=-7,head_x=-2,head_y=-3,gaze=-.42)),
        (2900,pose(tilt=-8,head_x=-2,head_y=-3,gaze=-.45))], loop=360),
    "speaking": clip(3000, [
        (0,BASE),(420,pose(head_y=-1,mouth=.18)),(650,pose(head_y=2,mouth=.28,tilt=2)),
        (970,pose(head_y=-1,mouth=.18)),(2120,pose(head_y=-1,mouth=.18)),
        (2290,pose(head_y=0,lid=.94)),(2480,pose(head_y=-1,mouth=.18)),
        (3000,pose(head_y=-1,mouth=.18))], loop=420),
    "sleeping": clip(DURATIONS["sleeping"], [
        (0,BASE),(240,pose(head_y=10,head_x=-2,tilt=5,body_y=4,lean=3,tuck=.38,lid=.46,bed=.43,cover=.25)),
        (560,pose(head_y=20,head_x=-3,tilt=6,body_y=7,body_x=-4,lean=-3,tuck=.77,lid=.78,bed=.95,cover=.66)),
        (CONTACTS["sleeping"],SLEEP),(DURATIONS["sleeping"],SLEEP)], contact=CONTACTS["sleeping"],step=42),
    "sleeping-loop": clip(2900, [
        (0,SLEEP),(760,{**SLEEP,"head_y":21.6,"breath":1}),
        (1470,SLEEP),(2200,{**SLEEP,"head_y":23.8,"breath":-.7}),(2900,SLEEP)], loop=0, step=145),
    "waking": clip(DURATIONS["waking"], [
        (0,SLEEP),(240,{**SLEEP,"head_y":17,"tilt":-5,"lid":.86,"cover":.86}),
        (490,pose(head_y=11,head_x=-4,tilt=-2,body_y=6,lean=6,tuck=.44,lid=.52,brace=.68,
                  bed=.87,cover=.55)),
        (680,pose(head_y=-1,head_x=-1,tilt=-4,body_y=2,lean=3,brace=.68,bed=.53,cover=.26)),
        (CONTACTS["waking"],pose(head_y=-3,tilt=-2,lid=.28)),(DURATIONS["waking"],BASE)],
        contact=CONTACTS["waking"],step=42),
    "dragging": clip(1250, [
        (0,BASE),(320,DRAG),(760,{**DRAG,"tilt":-3,"tail":5}),(1250,DRAG)], loop=320),
    "drag-end": clip(370, [
        (0,DRAG),(130,pose(head_y=3,tilt=3,body_y=3,drag=.3,lid=.42)),(370,BASE)], step=40),
}


def timing(info):
    last = info["duration"]
    keys = info["keys"]
    times = {0, last, *(time for time,_ in keys)}
    if "loop" in info:
        times.add(info["loop"])
    if "contact" in info:
        times.add(info["contact"])
    for (start,a),(end,b) in zip(keys,keys[1:]):
        if a != b:
            times.update(range(start+info.get("step",55), end, info.get("step",55)))
    return sorted(times)


def eased(progress):
    return progress*progress*(3-2*progress)


def interpolate(keys, time, skin, name):
    if time >= keys[-1][0]:
        return keys[-1][1]
    (start,a),(end,b) = next((a,b) for a,b in zip(keys,keys[1:]) if a[0] <= time < b[0])
    progress = (time-start)/(end-start)
    ease = eased(progress)
    out = {}
    for key in set(a)|set(b):
        amt = progress if key in ("marks","page","ball","bubbles") else ease
        out[key] = a.get(key,0)+(b.get(key,0)-a.get(key,0))*amt
    # Make small gestures suit each build while keeping prop contacts and foot anchors fixed.
    sensitivity = {"original":1,"ragdoll":.83,"british":.69,"calico":1.12}[skin]
    if "tail" in out:
        out["tail"] *= sensitivity
    if not name.startswith("eating") and name not in ("yarn","reading","math","experiment","waking","sleeping","sleeping-loop"):
        for key in ("head_x","tilt","head_y","body_x"):
            if key in out:
                out[key] *= sensitivity
    return out


def render_skin(skin, sources):
    public = ROOT/"public"/"pet"/"v1"/skin
    public.mkdir(parents=True,exist_ok=True)
    output = {}
    for name,info in CLIPS.items():
        times = timing(info)
        moments = times[:-1]
        frames = [draw_frame(skin,interpolate(info["keys"],ms,skin,name),name) for ms in moments]
        if sources:
            source = ROOT/"art-source"/"v1"/"cels"/skin/name
            source.mkdir(parents=True,exist_ok=True)
            for i,frame in enumerate(frames):
                frame.save(source/f"{i:03}.png")
        holds = [b-a for a,b in zip(times,times[1:])]
        cols = min(COLUMNS,len(frames))
        atlas = Image.new("RGBA",(cols*TILE,((len(frames)+cols-1)//cols)*TILE))
        for i,frame in enumerate(frames):
            atlas.paste(frame,((i%cols)*TILE,(i//cols)*TILE))
        atlas.save(public/f"{name}.webp",quality=94,alpha_quality=100,method=4)
        spec = dict(width=TILE,height=TILE,columns=cols,holds=holds)
        if "loop" in info:
            spec["loopFrom"] = moments.index(info["loop"])
        if "contact" in info:
            spec["contactFrame"] = moments.index(info["contact"])
        if name not in ("sleeping","waking","sleeping-loop","dragging"):
            spec["safeFrames"] = [0,len(frames)-1] if len(frames)>1 else [0]
        if name == "idle":
            spec["head"] = [94/SIZE,80/SIZE,52/SIZE,48/SIZE]
            frames[0].save(public/"poster.webp",lossless=True,method=4)
        output[name] = spec
    if sources:
        save_model_sheet(skin)
    print(f"Rendered {skin}: {len(output)} clips",flush=True)
    return skin,output


def save_model_sheet(skin):
    folder = ROOT/"art-source"/"v1"
    studies = [
        ("Seated / base",BASE,"idle"),
        ("Looking left",pose(gaze=-1,tilt=-12,head_x=-7,ears=.7),"idle-curious"),
        ("Looking right",pose(gaze=1,tilt=12,head_x=7,ears=.7),"idle-curious"),
        ("Lean and reach",pose(gaze=1,tilt=9,head_x=15,head_y=14,body_x=8,prop=1,active=1,reach=1),"yarn"),
        ("Asleep",SLEEP,"sleeping-loop"),
    ]
    sheet = Image.new("RGB",(len(studies)*TILE,TILE+42),"#fcf2e8")
    label = ImageDraw.Draw(sheet)
    label.text((14,10),f"DR. MEOW   /   {skin.upper()}",fill="#674b59")
    for index,(name,frame,clip) in enumerate(studies):
        image = draw_frame(skin,frame,clip)
        x = index*TILE
        sheet.paste(image,(x,18),image)
        label.text((x+14,TILE+21),name,fill="#674b59")
    sheet.save(folder/f"{skin}-model-sheet.png")


def save_action_reference():
    clips = [
        ("greet",360),("eating-fish",682),("eating-can",682),("eating-treat",682),("yarn",1900),
        ("reading",2780),("math",2730),("experiment",2380),("stretch",620),("waking",590),
    ]
    size = 157
    row = size+15
    sheet = Image.new("RGB",(size*5,row*2*len(SKINS)),"#f7eee8")
    label = ImageDraw.Draw(sheet)
    for skin_index,skin in enumerate(SKINS):
        for index,(clip,ms) in enumerate(clips):
            cel = draw_frame(skin,interpolate(CLIPS[clip]["keys"],ms,skin,clip),clip)
            cel.thumbnail((size,size))
            x,y = index%5*size,(skin_index*2+index//5)*row
            sheet.paste(cel,(x,y),cel)
            label.text((x+8,y+size),f"{skin} / {clip}",fill="#604751")
    sheet.save(ROOT/"art-source"/"v1"/"action-reference.png")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources",action="store_true",help="also retain individual PNG cels")
    args = parser.parse_args()
    entries = dict(render_skin(skin,args.sources) for skin in SKINS)
    if args.sources:
        save_action_reference()
    target = ROOT/"src"/"pet"/"generatedFrames.json"
    target.write_text(dumps(entries,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    print(f"{len(entries)} skins, {len(CLIPS)} clips each, "
          f"{sum(len(clip['holds']) for clips in entries.values() for clip in clips.values())} cels")


if __name__ == "__main__":
    main()

