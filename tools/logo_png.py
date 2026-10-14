"""Vykreslí ikony LearnIQ (rovnaký tvar ako img/logo.svg) bez externých nástrojov – iba Pillow."""
from PIL import Image, ImageDraw, ImageFilter
import sys, os

S = 4  # prekreslenie pre hladké hrany

def quad(p0, p1, p2, n=24):
    return [((1-t)**2*p0[0]+2*(1-t)*t*p1[0]+t*t*p2[0], (1-t)**2*p0[1]+2*(1-t)*t*p1[1]+t*t*p2[1]) for t in [i/n for i in range(n+1)]]

def outline():
    pts = [(20, 90), (20, 34)]
    pts += quad((20, 34), (20, 26), (28, 26))
    pts += [(92, 26)]
    pts += quad((92, 26), (100, 26), (100, 34))
    pts += [(100, 86)]
    pts += quad((100, 86), (100, 98), (110, 106))
    pts += quad((110, 106), (96, 104), (88, 100))
    pts += [(30, 100)]
    pts += quad((30, 100), (20, 100), (20, 90))
    return pts

def cap_base():
    return [(46, 57), (46, 68)] + quad((46, 68), (60, 77), (74, 68)) + [(74, 57), (60, 63.5)]

def render(size, pad, bg=(17, 17, 19, 255), round_bg=False):
    W = size * S
    img = Image.new("RGBA", (W, W), bg if not round_bg else (0, 0, 0, 0))
    if round_bg:
        ImageDraw.Draw(img).rounded_rectangle([0, 0, W - 1, W - 1], radius=W * 0.22, fill=(17, 17, 19, 255))
    k = (W - 2 * pad * S) / 120.0
    off = pad * S
    tr = lambda pts: [(off + x * k, off + y * k) for x, y in pts]
    # prechod farieb (fialová → ružová) po uhlopriečke
    grad = Image.new("RGBA", (W, W))
    gp = grad.load()
    a, b = (0x8b, 0x5c, 0xf6), (0xec, 0x48, 0x99)
    for y in range(W):
        for x in range(0, W):
            t = max(0, min(1, ((x + y) / 2 - off - 18 * k) / (90 * k)))
            gp[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
    mask = Image.new("L", (W, W), 0)
    md = ImageDraw.Draw(mask)
    o = tr(outline())
    w = int(8 * k)
    md.line(o + [o[0]], fill=255, width=w, joint="curve")
    for p in o:
        md.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    d.polygon(tr([(60, 40), (84, 51), (60, 62), (36, 51)]), fill=white)
    d.line(tr([(60, 40), (84, 51), (60, 62), (36, 51), (60, 40)]), fill=white, width=int(3 * k), joint="curve")
    d.polygon(tr(cap_base()), fill=white)
    d.line(tr([(84, 51), (84, 66)]), fill=white, width=int(3 * k))
    x0, y0 = tr([(80.5, 65)])[0]; x1, y1 = tr([(87.5, 73)])[0]
    d.rounded_rectangle([x0, y0, x1, y1], radius=2 * k, fill=white)
    return img.resize((size, size), Image.LANCZOS)

out = sys.argv[1] if len(sys.argv) > 1 else "img"
os.makedirs(out, exist_ok=True)
render(512, 36).save(f"{out}/icon-512.png")
render(192, 13).save(f"{out}/icon-192.png")
render(512, 90).save(f"{out}/icon-maskable-512.png")
render(180, 14).save(f"{out}/apple-touch-icon.png")
render(48, 2, round_bg=True).save(f"{out}/favicon-48.png")
print("ikony hotové")

# logo s nápisom (na web, do dokumentov)
from PIL import ImageFont
icon = render(360, 30)
W, H = 1240, 400
wide = Image.new("RGBA", (W, H), (17, 17, 19, 255))
wide.paste(icon, (20, 20))
f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 150)
d = ImageDraw.Draw(wide)
d.text((400, 110), "Learn", font=f, fill=(255, 255, 255, 255))
x = 400 + d.textlength("Learn", font=f)
txt = Image.new("L", (W, H), 0)
ImageDraw.Draw(txt).text((x, 110), "IQ", font=f, fill=255)
g = Image.new("RGBA", (W, H))
gp = g.load()
for yy in range(H):
    for xx in range(int(x), min(W, int(x) + 260)):
        t = (xx - x) / 230
        t = max(0, min(1, t))
        gp[xx, yy] = (int(0x8b + (0xec - 0x8b) * t), int(0x5c + (0x48 - 0x5c) * t), int(0xf6 + (0x99 - 0xf6) * t), 255)
wide.paste(g, (0, 0), txt)
d.text((404, 280), "e-learning BOZP · koncept Keylo", font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 40), fill=(165, 157, 190, 255))
wide.convert("RGB").save(f"{out}/logo-learniq.png")
