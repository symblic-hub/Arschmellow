"""Erzeugt die Pixel-Art-Icons für Marshmellow Mayhem.

    python3 assets/make_icon.py

Ausgabe: assets/icon.png (16:9, 960x540), assets/icon-square.png (512x512) und assets/icon-192.png (192x192).
Gezeichnet wird auf einem winzigen Raster (32x18 bzw. 20x20) und dann pixelgenau hochskaliert.
"""
from pathlib import Path

from PIL import Image

PALETTE = {
    '.': '#7a2050',  # Hintergrund (Pflaume)
    ',': '#a8487e',  # helles Schachbrett
    'm': '#561a3c',  # Boden mittel
    'd': '#34102a',  # Boden dunkel
    'W': '#fff4e6',  # Marshmallow
    'w': '#ead2b8',  # Marshmallow-Schatten
    'e': '#3a2416',  # Augen / Mund
    'k': '#ff8fb8',  # Bäckchen
    'P': '#ff7aa9',  # Kartenrücken
    'p': '#d94f86',  # Kartenrand
    'c': '#fff4e6',  # Kartenmitte
    'o': '#ff7a1f',  # Flamme außen
    'y': '#ffd23f',  # Flamme innen
    's': '#ff9fc6',  # Funkel rosa
    'z': '#ffe9c4',  # Funkel creme
}

MALLOW = [
    '..WWWWWW..',
    '.WWWWWWWW.',
    'WWWWWWWWWW',
    'WWeWWWWeWW',
    'WkWWWWWWkW',
    'WWWeWWeWWW',
    'WWWWeeWWWW',
    'wWWWWWWWWw',
    '.wwwwwwww.',
]

FLAME = [
    '.o..o...',
    '.oo.oyo.',
    'oyoyyyoo',
    'oyyyyyyo',
]

def card(w=6, h=8):
    """Kartenrücken wie im Spiel: cremefarbener Rand, rosa Diagonalstreifen."""
    rows = []
    for y in range(h):
        row = ''
        for x in range(w):
            if x in (0, w - 1) or y in (0, h - 1):
                row += 'c'
            else:
                row += 'p' if (x + y) % 3 == 0 else 'P'
        rows.append(row)
    return rows


CARD = card()


def canvas(w, h):
    return [['.'] * w for _ in range(h)]


def stamp(grid, sprite, x, y):
    """Setzt ein Sprite; '.' im Sprite ist durchsichtig."""
    for dy, row in enumerate(sprite):
        for dx, ch in enumerate(row):
            if ch != '.' and 0 <= y + dy < len(grid) and 0 <= x + dx < len(grid[0]):
                grid[y + dy][x + dx] = ch


def ground(grid, band_top, bumps):
    """Schachbrett-Band als Horizont, darunter Boden mit dunkler Hügel-Silhouette."""
    h, w = len(grid), len(grid[0])
    for y in range(band_top, band_top + 2):
        for x in range(w):
            if grid[y][x] == '.' and (x + y) % 2 == 0:
                grid[y][x] = ','
    for x in range(w):
        for y in range(band_top + 2, h):
            if grid[y][x] in '.,':
                hill = y >= band_top + 3 - bumps[x % len(bumps)]
                grid[y][x] = 'd' if hill else 'm'


def sparkles(grid, points):
    for x, y, ch in points:
        if grid[y][x] == '.':
            grid[y][x] = ch


def render(grid, scale, path):
    h, w = len(grid), len(grid[0])
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = Image.new('RGB', (1, 1), PALETTE[grid[y][x]]).getpixel((0, 0))
    img.resize((w * scale, h * scale), Image.NEAREST).save(path)
    print('geschrieben:', path)


def wide():
    g = canvas(32, 18)
    ground(g, 13, [0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0])
    stamp(g, CARD, 3, 7)
    stamp(g, CARD, 23, 6)
    stamp(g, MALLOW, 11, 5)
    stamp(g, FLAME, 12, 1)
    sparkles(g, [(2, 2, 'z'), (7, 1, 's'), (10, 4, 's'), (21, 1, 'z'), (27, 2, 's'),
                 (30, 4, 'z'), (1, 10, 's'), (30, 11, 's'), (20, 3, 's')])
    return g


def square():
    g = canvas(20, 20)
    ground(g, 15, [0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0])
    stamp(g, MALLOW, 5, 7)
    stamp(g, FLAME, 6, 3)
    sparkles(g, [(2, 2, 'z'), (16, 2, 's'), (3, 9, 's'), (17, 8, 'z'), (13, 1, 'z'), (1, 13, 'z'), (18, 12, 's')])
    return g


if __name__ == '__main__':
    here = Path(__file__).parent
    render(wide(), 30, here / 'icon.png')
    # Quadratische Icons (Startbildschirm): Raster pixelgenau skaliert, mit Hintergrundrand auf Standardgröße
    for name, scale, size in (('icon-square.png', 25, 512), ('icon-192.png', 9, 192)):
        path = here / name
        render(square(), scale, path)
        img = Image.open(path)
        framed = Image.new('RGB', (size, size), PALETTE['.'])
        framed.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
        framed.save(path)
