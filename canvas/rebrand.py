#!/usr/bin/env python3
"""
Turn a draw.io web app folder into HarNova Canvas.

draw.io is open source (Apache License 2.0, (c) JGraph Ltd / draw.io AG). Its
licence lets us modify and redistribute it, but not use its name or logo, so
this script swaps the product name, logos, page text and app manifest, keeps
the licence, and adds a NOTICE crediting the original authors.

Usage: rebrand.py <webapp-folder>
"""
import json
import pathlib
import re
import shutil
import sys

NAME = 'HarNova Canvas'
HERE = pathlib.Path(__file__).resolve().parent
BRAND = HERE / 'brand'


def main(web: pathlib.Path) -> None:
    img = web / 'images'

    # ---- logos and icons
    logo_svg = (BRAND / 'logo.svg').read_text()
    for n in ['drawlogo.svg', 'drawlogo-color.svg', 'drawlogo-gray.svg', 'drawlogo-text-bottom.svg']:
        (img / n).write_text(logo_svg)
    for size in ['48', '80', '128', '144', '256']:
        shutil.copy(BRAND / f'logo{size}.png', img / f'drawlogo{size}.png')
    shutil.copy(BRAND / 'logo48.png', img / 'drawlogo48-gray.png')
    for n in ['icon-192.png', 'icon-512.png', 'icon-192-maskable.png', 'icon-512-maskable.png', 'apple-touch-icon.png', 'favicon-16x16.png', 'favicon-32x32.png']:
        shutil.copy(BRAND / n, img / n)
    shutil.copy(BRAND / 'favicon.ico', web / 'favicon.ico')

    # ---- main page
    idx = web / 'index.html'
    html = idx.read_text()
    html = re.sub(r'<title>.*?</title>', f'<title>{NAME}</title>', html, flags=re.S)
    html = re.sub(r'<meta name="Description" content="[^"]*">', f'<meta name="Description" content="{NAME}: diagrams, flowcharts, network and cloud architecture drawings. Part of HarNova Studio.">', html)
    html = re.sub(r'<meta itemprop="name" content="[^"]*">', f'<meta itemprop="name" content="{NAME}">', html)
    html = re.sub(r'<meta itemprop="description" content="[^"]*">', f'<meta itemprop="description" content="{NAME}: diagrams, flowcharts, network and cloud architecture drawings.">', html, flags=re.S)
    splash = logo_svg.replace('<svg ', '<svg class="geSplashLogo" role="img" aria-label="HarNova Canvas" ', 1).replace('width="64" height="64"', '')
    html = re.sub(r'<svg class="geSplashLogo".*?</svg>', splash, html, flags=re.S)
    html = re.sub(r'<noscript>.*?</noscript>', f'<noscript><h1>{NAME}</h1><p>{NAME} needs JavaScript. It is based on draw.io (Apache License 2.0).</p></noscript>', html, flags=re.S)
    html = html.replace('draw.io', NAME)
    idx.write_text(html)

    # ---- installable app manifest
    mf = img / 'manifest.json'
    m = json.loads(mf.read_text())
    m.update({'name': NAME, 'short_name': 'Canvas', 'description': f'{NAME} diagram editor', 'theme_color': '#2fb3a8', 'background_color': '#ffffff'})
    mf.write_text(json.dumps(m, indent=4))

    # ---- interface text, every language: replace the product name in values only
    for f in (web / 'resources').glob('dia*.txt'):
        out = []
        for line in f.read_text(encoding='utf-8').splitlines():
            k, sep, v = line.partition('=')
            if sep and not line.lstrip().startswith('#'):
                v = v.replace('draw.io', NAME).replace('Draw.io', NAME).replace('app.diagrams.net', 'canvas')
                line = f'{k}={v}'
            out.append(line)
        f.write_text('\n'.join(out) + '\n', encoding='utf-8')

    # ---- configuration (loaded before and after the app)
    shutil.copy(HERE / 'PreConfig.js', web / 'js' / 'PreConfig.js')
    shutil.copy(HERE / 'PostConfig.js', web / 'js' / 'PostConfig.js')

    # ---- licence and credit
    shutil.copy(HERE / 'NOTICE', web / 'NOTICE')
    print(f'{NAME}: rebranded {web}')


if __name__ == '__main__':
    main(pathlib.Path(sys.argv[1]))
