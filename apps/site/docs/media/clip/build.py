#!/usr/bin/env python3
"""Cuts the 4:11 demo into a short vertical clip of the Fatline world.

Your own voice, cut to the strongest lines; each line over its scene from the world (slow zoom), captions in
Fraunces rendered by headless Chrome (this ffmpeg has no font support), a white flash between cuts, the
FATLINE title card and an end card. Usage:  python3 apps/site/docs/media/clip/build.py  ->  fatline-clip.mp4
"""
import json, os, re, subprocess, sys, tempfile, html

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../../..'))
SRC = os.path.join(ROOT, 'apps/site/docs/media/fatliners-demo.mp4')
SRT = os.path.join(ROOT, 'apps/site/docs/media/fatliners-demo.srt')
WORLD = os.path.join(ROOT, 'apps/site/img/world')
OUT = os.path.join(ROOT, 'apps/site/docs/media/fatline-clip.mp4')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
W, H, FPS = 720, 1280, 30
TMP = tempfile.mkdtemp(prefix='fatline-clip-')

# (from s, to s, scene, zoom: in|out|left|right). Scenes "title" and "end" are cards.
CUTS = [
    (10.8, 17.62, 'map-of-the-fatline', 'in'),
    (22.1, 28.2, 'hall-of-777', 'left'),
    (29.2, 38.72, 'the-weaving', 'in'),
    (72.54, 75.78, 'map-of-the-fatline', 'out'),
    (108.88, 114.94, 'the-sleeper', 'in'),
    (115.82, 118.52, 'title', None),
    (120.26, 127.02, 'hall-of-777', 'in'),
    (127.98, 136.06, 'the-archive', 'right'),
    (136.82, 138.56, 'you-are-your-fid', 'in'),
    (139.24, 145.80, 'a-node-is-born', 'out'),
    (146.6, 152.72, 'the-vault', 'in'),
    (153.4, 157.84, 'the-sleeper', 'out'),
    (176.88, 187.5, 'two-currents', 'in'),
    (195.38, 203.84, 'the-weaving', 'right'),
    (215.82, 219.32, 'aster', 'in'),
    (237.74, 243.34, 'end', None),
]
PAD = 0.15


def srt():
    out = []
    for block in open(SRT, encoding='utf8').read().strip().split('\n\n'):
        lines = block.strip().split('\n')
        m = re.match(r'(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)', lines[1])
        t = [int(x) for x in m.groups()]
        out.append((t[0] * 3600 + t[1] * 60 + t[2] + t[3] / 1000, t[4] * 3600 + t[5] * 60 + t[6] + t[7] / 1000, ' '.join(lines[2:])))
    return out


PAGE = '''<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=JetBrains+Mono:wght@500&display=block" rel="stylesheet">
<style>html,body{margin:0;width:%dpx;height:%dpx;background:transparent;overflow:hidden}
body{position:relative;font-family:Fraunces,serif;color:#fff4dc}
%s</style><body>%s</body>''' % (W, H, '%s', '%s')

CAPTION_CSS = '''
.cap{position:absolute;left:40px;right:40px;bottom:190px;text-align:center;font-weight:800;font-size:%dpx;line-height:1.08;
 font-variation-settings:'opsz' 96,'SOFT' 100,'WONK' 1;letter-spacing:-.01em;
 text-shadow:0 2px 0 rgba(40,22,8,.55),0 6px 24px rgba(20,10,4,.85),0 0 60px rgba(20,10,4,.6)}
.line{position:absolute;left:50%%;bottom:160px;width:140px;height:4px;margin-left:-70px;border-radius:4px;
 background:linear-gradient(90deg,#3d8bff,#fff 50%%,#ff5fa8);box-shadow:0 0 14px #ff5fa8}
.mark{position:absolute;top:56px;left:0;right:0;text-align:center;font:500 18px 'JetBrains Mono',monospace;letter-spacing:.42em;
 color:rgba(255,244,220,.85);text-shadow:0 2px 10px rgba(0,0,0,.6)}'''

CARD_CSS = '''
body{background:radial-gradient(900px 900px at 50%% 45%%,#2a1f14,#120d09)}
.t{position:absolute;left:0;right:0;top:%dpx;text-align:center;font-weight:800;font-size:%dpx;letter-spacing:-.02em;
 font-variation-settings:'opsz' 144,'SOFT' 100,'WONK' 1;color:#f6ecd7}
.p{position:absolute;left:12%%;right:9%%;top:%dpx;height:5px;border-radius:5px;
 background:linear-gradient(90deg,transparent,#3d8bff 20%%,#fff 50%%,#ff5fa8 80%%,transparent);box-shadow:0 0 18px #ff5fa8}
.p:after{content:"";position:absolute;right:-9px;top:-6px;width:17px;height:17px;border-radius:50%%;background:#fff;box-shadow:0 0 14px 4px #3d8bff,0 0 30px 8px #ff5fa8}
.s{position:absolute;left:50px;right:50px;top:%dpx;text-align:center;font:600 34px/1.3 Fraunces,serif;color:#e9d9b8}
.u{position:absolute;left:0;right:0;bottom:120px;text-align:center;font:500 30px 'JetBrains Mono',monospace;letter-spacing:.08em;color:#f6ecd7}
img{position:absolute;left:50%%;top:560px;width:300px;height:300px;margin-left:-150px;border-radius:50%%;object-fit:cover;box-shadow:0 0 0 4px rgba(255,244,220,.15),0 20px 60px rgba(0,0,0,.6)}'''


def chrome_png(markup, css, out):
    page = os.path.join(TMP, os.path.basename(out) + '.html')
    open(page, 'w').write(PAGE % (css, markup))
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--window-size={W},{H}',
                    '--default-background-color=00000000', '--virtual-time-budget=8000', f'--screenshot={out}', 'file://' + page],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def caption_png(text, out):
    size = 66 if len(text) < 40 else 56 if len(text) < 70 else 48
    chrome_png(f'<div class="mark">FATLINE</div><div class="cap">{html.escape(text)}</div><div class="line"></div>', CAPTION_CSS % size, out)


def card_png(kind, out):
    if kind == 'title':
        css = CARD_CSS % (470, 150, 560, 700)
        chrome_png('<div class="t">FATLINE</div><div class="p"></div><div class="s">Fatline is my answer.</div>', css, out)
    else:
        css = CARD_CSS % (170, 120, 255, 920)
        aster = 'file://' + os.path.join(WORLD, 'aster.jpg')
        chrome_png(f'<div class="t">FATLINE</div><div class="p"></div><img src="{aster}">'
                   '<div class="s">Run your own Farcaster node.<br>Open source. Come build it with us.</div><div class="u">fatline.ink</div>', css, out)


def ff(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def zoom_expr(kind, frames):
    # zoompan on an image scaled to cover W x H at 2x, so the zoom stays sharp.
    p = f'(on/{max(frames - 1, 1)})'
    z = {'in': f'1.0+0.16*{p}', 'out': f'1.16-0.16*{p}', 'left': '1.12', 'right': '1.12'}[kind]
    x = {'in': 'iw/2-(iw/zoom/2)', 'out': 'iw/2-(iw/zoom/2)', 'left': f'(iw-iw/zoom)*(1-{p})', 'right': f'(iw-iw/zoom)*{p}'}[kind]
    return z, x, 'ih/2-(ih/zoom/2)'


def main():
    subs = srt()
    parts = []
    for i, (a, b, scene, kind) in enumerate(CUTS):
        a0, b0 = max(0, a - PAD), b + PAD
        dur = b0 - a0
        frames = round(dur * FPS)
        seg = os.path.join(TMP, f'seg{i:02d}.mp4')
        if scene in ('title', 'end'):
            card = os.path.join(TMP, f'card{i}.png'); card_png(scene, card)
            base = ['-loop', '1', '-t', f'{dur:.3f}', '-i', card]
            vf = f'[0:v]scale={W}:{H},format=yuv420p,fps={FPS}'
            # the card breathes a little
            vf += f",zoompan=z='1.0+0.03*sin(on/{FPS}*2.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS}[v]"
            overlays = []
        else:
            img = os.path.join(WORLD, scene + '.jpg')
            z, x, y = zoom_expr(kind, frames)
            base = ['-loop', '1', '-t', f'{dur:.3f}', '-i', img]
            vf = (f"[0:v]scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},"
                  f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={W}x{H}:fps={FPS},"
                  "eq=saturation=1.12:contrast=1.04,vignette=PI/5,format=yuv420p[bg]")
            overlays = [s for s in subs if s[1] > a and s[0] < b]
        inputs = list(base)
        chain = vf
        last = 'bg' if overlays else 'v'
        for j, (s0, s1, text) in enumerate(overlays):
            png = os.path.join(TMP, f'cap{i}_{j}.png'); caption_png(text, png)
            inputs += ['-i', png]
            t0 = max(0, s0 - a0)
            nxt_start = overlays[j + 1][0] - a0 if j + 1 < len(overlays) else dur
            t1 = min(dur, s1 - a0 + 0.25, nxt_start - 0.01)  # never two captions at once
            nxt = f'o{j}'
            chain += f";[{last}][{j + 1}:v]overlay=0:0:enable='between(t,{t0:.2f},{t1:.2f})'[{nxt}]"
            last = nxt
        # a short white flash at the start of every cut but the first
        if i > 0:
            chain += f";[{last}]fade=t=in:st=0:d=0.18:color=white[f]"; last = 'f'
        inputs += ['-ss', f'{a0:.3f}', '-t', f'{dur:.3f}', '-i', SRC]
        ai = len([x for x in inputs if x == '-i']) - 1
        chain += f";[{ai}:a]afade=t=in:d=0.05,afade=t=out:st={dur - 0.08:.3f}:d=0.08,aresample=48000[a]"
        ff(*inputs, '-filter_complex', chain, '-map', f'[{last}]', '-map', '[a]', '-t', f'{dur:.3f}',
           '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', str(FPS),
           '-c:a', 'aac', '-b:a', '160k', seg)
        parts.append(seg)
        print(f'  cut {i + 1}/{len(CUTS)}  {scene:<20} {dur:5.2f}s  {len(overlays)} captions', flush=True)
    lst = os.path.join(TMP, 'list.txt')
    open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
    ff('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', OUT)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
