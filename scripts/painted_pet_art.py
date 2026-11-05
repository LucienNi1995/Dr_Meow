"""Fit the authored painted components to the existing animation joints."""

from dataclasses import dataclass
from functools import lru_cache
from math import cos, sin
from pathlib import Path

from PIL import Image, ImageChops

SOURCE = Path(__file__).resolve().parents[1]/"art-source"/"painted"
# Landmarks are in each original 1536x1024 sheet. The skin's open face defines
# the silhouette; only the eye and mouth regions use pixels from the expression.
LANDMARKS = {
    "original": ((433,373),(1137,367),((326,334),(533,334)),((1015,348),(1250,348))),
    "ragdoll": ((413,364),(1147,353),((309,325),(507,325)),((1029,332),(1264,331))),
    "british": ((428,350),(1130,341),((315,323),(528,320)),((1009,329),(1240,327))),
    "calico": ((435,366),(1128,363),((321,331),(528,331)),((1010,344),(1240,343))),
}
TAIL_SIZE = {"original":(60,59),"ragdoll":(63,64),"british":(49,53),"calico":(29,29)}
SAMPLE = 280


@dataclass(frozen=True)
class Expression:
    image: Image.Image
    mask: Image.Image
    origin: tuple[int,int]


@dataclass(frozen=True)
class SkinArt:
    head: Image.Image
    nose: tuple[float,float]
    eyes: tuple[Expression,Expression]
    gaze: tuple[Expression,Expression]
    smile: Expression
    body: Image.Image
    tail: Image.Image
    fur: Image.Image


def trim(sheet, box):
    region = sheet.crop(box)
    bounds = region.getchannel("A").point(lambda a: 255 if a >= 48 else 0).getbbox()
    if not bounds:
        raise ValueError(f"Missing painted component at {box}")
    x1,y1,x2,y2 = bounds
    left,top = max(0,x1-3),max(0,y1-3)
    return region.crop((left,top,min(region.width,x2+3),min(region.height,y2+3))),(box[0]+left,box[1]+top)


def expression(sheet, src, dst, radius, crop_origin, scale):
    rx,ry = radius
    x,y = dst
    bounds = [round((v-crop_origin[i%2])*scale) for i,v in enumerate((x-rx,y-ry,x+rx,y+ry))]
    left,top,right,bottom = bounds
    sx,sy = src
    patch = sheet.crop((sx-rx,sy-ry,sx+rx,sy+ry)).resize((right-left,bottom-top),Image.Resampling.LANCZOS)
    width,height = patch.size
    feather_x = max(1,round(width*.12))
    feather_y = max(1,round(height*.14))
    blend = Image.new("L",patch.size)
    blend.putdata([
        round(255*min(1,col/feather_x,(width-1-col)/feather_x,row/feather_y,(height-1-row)/feather_y))
        for row in range(height) for col in range(width)
    ])
    return Expression(patch,ImageChops.multiply(blend,patch.getchannel("A")),(left,top))


@lru_cache(maxsize=4)
def load_art(skin):
    with Image.open(SOURCE/f"{skin}.png") as source:
        sheet = source.convert("RGBA")
    head,origin = trim(sheet,(0,0,768,530))
    body,_ = trim(sheet,(0,530,686,1024))
    tail,_ = trim(sheet,(686,530,1110,1024))
    arm,_ = trim(sheet,(1110,530,1536,1024))
    # Use the central painted fur as material on the continuous animated limb.
    # The original paw sheet is retained alongside the face and body sources.
    w,h = arm.size
    fur = arm.crop((round(w*.34),round(h*.19),round(w*.68),round(h*.83))).convert("RGB")
    nose,closed_nose,eyes,closed_eyes = LANDMARKS[skin]
    scale = SAMPLE/head.width
    normalized_nose = ((nose[0]-origin[0])/head.width,(nose[1]-origin[1])/head.height)
    eye_layers = tuple(
        expression(sheet,source,(target[0],target[1]+2),(101,86),origin,scale)
        for source,target in zip(closed_eyes,eyes)
    )
    gaze_layers = tuple(expression(sheet,eye,eye,(46,46),origin,scale) for eye in eyes)
    smile = expression(sheet,(closed_nose[0],closed_nose[1]+42),(nose[0],nose[1]+42),(78,68),origin,scale)
    return SkinArt(
        head.resize((SAMPLE,round(head.height*scale)),Image.Resampling.LANCZOS),normalized_nose,
        eye_layers,gaze_layers,smile,body,tail,fur,
    )


@lru_cache(maxsize=96)
def face(skin, closed, smile, gaze, down):
    art = load_art(skin)
    if not any((closed,smile,gaze,down)):
        return art.head
    head = art.head.copy()
    if closed < 12 and (gaze or down):
        # Keep the painted lashes and eye rims fixed. Move only the inner
        # iris and highlights through the feathered central patch.
        for eye in art.gaze:
            bitmap = eye.image.transform(eye.image.size,Image.Transform.AFFINE,(1,0,-gaze,0,1,-down),
                                         resample=Image.Resampling.BICUBIC)
            head.paste(bitmap,eye.origin,ImageChops.multiply(eye.mask,bitmap.getchannel("A")))
    if closed:
        # The replacement first covers the upper eyelid, then reaches the
        # bottom of the eye. This avoids a double iris while blinking.
        for eye in art.eyes:
            width,height = eye.image.size
            boundary = height*(-.12+1.32*closed/16)
            roll = Image.new("L",(1,height))
            roll.putdata([round(255*min(1,max(0,(boundary-row)/(.18*height)))) for row in range(height)])
            mask = ImageChops.multiply(eye.mask,roll.resize((width,height)))
            head.paste(eye.image,eye.origin,mask)
    if smile:
        patch = art.smile
        strength = patch.mask.point(lambda a: round(a*smile/16))
        head.paste(patch.image,patch.origin,strength)
    return head


def place(image, part, pen, box, sampling):
    left,top,right,bottom = box
    width = max(1,round((right-left)*pen.sx*sampling))
    height = max(1,round((bottom-top)*pen.sy*sampling))
    sprite = part.resize((width,height),Image.Resampling.LANCZOS)
    if abs(pen.angle) > .05:
        sprite = sprite.rotate(-pen.angle,Image.Resampling.BICUBIC,expand=True)
    x,y = pen.point((left+right)/2,(top+bottom)/2)
    image.alpha_composite(sprite,(round(x*sampling-sprite.width/2),round(y*sampling-sprite.height/2)))


def head_box(art, skin, pose):
    width = 115 if skin == "british" else 113
    height = width*art.head.height/art.head.width
    # Register the nose above the existing food contact, in the same local
    # coordinate space as the head pivot.
    left = pose.get("gaze",0)*3.5-art.nose[0]*width
    top = 14+pose.get("look_down",0)*3-art.nose[1]*height
    return left,top,left+width,top+height


def tail_box(skin, angle):
    width,height = TAIL_SIZE[skin]
    box = (-.86*width,-.83*height,.14*width,.17*height)
    left,top,right,bottom = box
    projected_left = min(x*cos(angle)-y*sin(angle) for x in (left,right) for y in (top,bottom))
    return box,projected_left

