"""Make an animated GIF of a Scratch sprite's costumes and put it in the README.

Env:
  PROJECT_ID  Scratch project to read (must be shared)
  SPRITE      sprite name to animate (blank = the sprite with the most costumes)
  DELAY_MS    milliseconds per frame
  WIDTH       max GIF width in px
"""
import hashlib, html, io, json, os, re, urllib.request

import cairosvg
from PIL import Image

PROJECT_ID = os.environ["PROJECT_ID"]
SPRITE = os.environ.get("SPRITE", "").strip()
DELAY = int(os.environ.get("DELAY_MS") or 100)
WIDTH = int(os.environ.get("WIDTH") or 485)
OUT = "scratch-project.gif"
UA = {"User-Agent": "blockblock2-readme-gif"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


meta = json.loads(get(f"https://api.scratch.mit.edu/projects/{PROJECT_ID}"))
project = json.loads(get(f"https://projects.scratch.mit.edu/{PROJECT_ID}?token={meta['project_token']}"))

sprites = [t for t in project["targets"] if not t.get("isStage")]
if SPRITE:
    matches = [t for t in sprites if t["name"].lower() == SPRITE.lower()]
    if not matches:
        raise SystemExit(f"No sprite named {SPRITE!r}. Sprites: {[t['name'] for t in sprites]}")
    sprite = matches[0]
else:
    sprite = max(sprites, key=lambda t: len(t["costumes"]))
print(f"Animating sprite {sprite['name']!r} ({len(sprite['costumes'])} costumes) from {meta['title']!r}")

SCALE = 2  # px per Scratch unit (stage is 480x360 units)


def render(c, size=1.0):
    """Costume as an RGBA image at SCALE, plus its rotation centre in px."""
    data = get(f"https://assets.scratch.mit.edu/internalapi/asset/{c['md5ext']}/get/")
    res = c.get("bitmapResolution") or 1
    if c["dataFormat"] == "svg":
        img = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=data, scale=SCALE * size))).convert("RGBA")
        f = SCALE * size
    else:
        img = Image.open(io.BytesIO(data)).convert("RGBA")
        f = SCALE * size / res
        if f != 1:
            img = img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS)
    return img, c["rotationCenterX"] * f, c["rotationCenterY"] * f


# Draw each frame the way Scratch shows it: the stage's backdrop, with the
# sprite on top at its saved position and size.
stage = next(t for t in project["targets"] if t.get("isStage"))
W, H = 480 * SCALE, 360 * SCALE
backdrop = Image.new("RGBA", (W, H), (255, 255, 255, 255))
if stage["costumes"]:
    bimg, bx, by = render(stage["costumes"][stage.get("currentCostume", 0)])
    backdrop.alpha_composite(bimg, (round(W / 2 - bx), round(H / 2 - by)))

size = (sprite.get("size") or 100) / 100
px, py = (240 + sprite.get("x", 0)) * SCALE, (180 - sprite.get("y", 0)) * SCALE

out = []
for c in sprite["costumes"]:
    img, cx, cy = render(c, size)
    frame = backdrop.copy()
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.paste(img, (round(px - cx), round(py - cy)), img)
    frame.alpha_composite(layer)
    if frame.width > WIDTH:
        frame = frame.resize((WIDTH, round(frame.height * WIDTH / frame.width)), Image.LANCZOS)
    out.append(frame.convert("RGB").quantize(colors=96, method=Image.MEDIANCUT))

out[0].save(OUT, save_all=True, append_images=out[1:], duration=DELAY, loop=0, optimize=True, disposal=2)
print(f"Wrote {OUT}: {len(out)} frames, {out[0].width}x{out[0].height}")

# Point the README at the GIF (cache-busted so GitHub shows the new one).
readme = open("README.md", encoding="utf-8").read()
ver = hashlib.md5(open(OUT, "rb").read()).hexdigest()[:8]
new_img = f'<img src="{OUT}?v={ver}" width="{min(WIDTH, out[0].width)}" alt="{html.escape(meta["title"])} — play on Scratch">'
readme, n = re.subn(
    r'<img src="(?:https://cdn2\.scratch\.mit\.edu/get_image/project/\d+_\d+x\d+\.png|scratch-project\.gif[^"]*)"[^>]*>',
    new_img,
    readme,
    count=1,
)
if not n:
    raise SystemExit("Couldn't find the project image in README.md")
open("README.md", "w", encoding="utf-8").write(readme)
