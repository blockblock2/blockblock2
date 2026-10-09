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

# Render every costume at the same scale, keyed to its rotation centre.
SCALE = 2  # px per Scratch unit
frames = []
for c in sprite["costumes"]:
    data = get(f"https://assets.scratch.mit.edu/internalapi/asset/{c['md5ext']}/get/")
    res = c.get("bitmapResolution") or 1
    if c["dataFormat"] == "svg":
        img = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=data, scale=SCALE))).convert("RGBA")
        cx, cy = c["rotationCenterX"] * SCALE, c["rotationCenterY"] * SCALE
    else:
        img = Image.open(io.BytesIO(data)).convert("RGBA")
        f = SCALE / res
        if f != 1:
            img = img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS)
        cx, cy = c["rotationCenterX"] * f, c["rotationCenterY"] * f
    frames.append((img, cx, cy))

# Union bounding box of all frames around the shared centre, then trim empty space.
left = min(-cx for _, cx, _ in frames)
top = min(-cy for _, _, cy in frames)
right = max(i.width - cx for i, cx, _ in frames)
bottom = max(i.height - cy for i, _, cy in frames)
W, H = round(right - left), round(bottom - top)

canvases = []
for img, cx, cy in frames:
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(img, (round(-cx - left), round(-cy - top)))
    canvases.append(canvas)

box = None
for c in canvases:
    b = c.getbbox()
    if b:
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
pad = 8
box = (max(0, box[0] - pad), max(0, box[1] - pad), min(W, box[2] + pad), min(H, box[3] + pad))

out = []
for c in canvases:
    c = c.crop(box)
    if c.width > WIDTH:
        c = c.resize((WIDTH, round(c.height * WIDTH / c.width)), Image.LANCZOS)
    bg = Image.new("RGBA", c.size, (255, 255, 255, 255))
    bg.alpha_composite(c)
    out.append(bg.convert("RGB").quantize(colors=255, method=Image.MEDIANCUT))

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
