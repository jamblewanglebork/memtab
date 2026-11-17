"""Generate the repo-native MemTab grid mark as PNGs using only Python's standard library."""
from pathlib import Path
import struct
import zlib

def inside_round(x, y, left, top, width, radius):
    if not left <= x < left + width or not top <= y < top + width:
        return False
    cx = min(max(x, left + radius), left + width - radius)
    cy = min(max(y, top + radius), top + width - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2

def chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)

output = Path('public/icons')
output.mkdir(parents=True, exist_ok=True)
for size in (16, 48, 128):
    lines = bytearray()
    for y in range(size):
        lines.append(0)
        for x in range(size):
            samples = []
            for sy in range(4):
                for sx in range(4):
                    px, py = (x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size
                    color = (0, 0, 0, 0)
                    if inside_round(px, py, 0.03, 0.03, 0.94, 0.25):
                        color = (43, 118, 91, 255)
                        for row in range(2):
                            for col in range(2):
                                if inside_round(px, py, 0.235 + col * 0.30, 0.235 + row * 0.30, 0.22, 0.035):
                                    color = ((232, 247, 233) if row == col else (155, 205, 170)) + (255,)
                    samples.append(color)
            alpha = sum(c[3] for c in samples) / len(samples)
            rgb = [round(sum(c[i] * c[3] for c in samples) / (alpha * len(samples))) if alpha else 0 for i in range(3)]
            lines.extend(rgb + [round(alpha)])
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(lines))) + chunk(b'IEND', b'')
    (output / f'icon{size}.png').write_bytes(data)
print('Created 16px, 48px, and 128px icons.')
