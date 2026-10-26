#!/usr/bin/env python3
"""zoom.py  (stdlib only)
Usage:
  zoom.py <input.png> <out.png> <x> <y> <w> <h> <scale>
Decodes a (non-interlaced RGB/RGBA/gray/palette) PNG, crops the given rect,
nearest-neighbor upscales, writes a new RGB PNG.
"""
import sys, zlib, struct


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8
    idat = b''
    w = h = bitdepth = color_type = None
    palette = None
    interlace = 0
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, bitdepth, color_type, comp, filt, interlace = struct.unpack('>IIBBBBB', chunk)
            assert interlace == 0, 'interlaced not supported'
            assert bitdepth in (1, 2, 4, 8, 16), f'bitdepth {bitdepth} not supported'
            bd = bitdepth
        elif typ == b'PLTE':
            palette = chunk
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    if bitdepth < 8:
        # sub-byte palette/gray: decode at bit level with spec filtering
        nsamp = w * channels
        bppb = max(1, (channels * bitdepth + 7) // 8)  # filter bpp in bytes
        stride_bits = nsamp * bitdepth
        out_bits = bytearray((stride_bits + 7) // 8 * h)

        def getbit(buf, i):
            return (buf[i >> 3] >> (7 - (i & 7))) & 1

        def setbit(buf, i, v):
            if v:
                buf[i >> 3] |= 1 << (7 - (i & 7))
        # filter bit-level: a = bit bpp*bitdepth back, b = same bit prev row
        abits = channels * bitdepth
        prev_bits = bytearray((stride_bits + 7) // 8)
        rpos = 0
        for y in range(h):
            # decode the row bytes first, then apply byte filters assuming
            # filter bytes are per byte of the packed row
            f = raw[rpos]; rpos += 1
            stride_b = (stride_bits + 7) // 8
            line = raw[rpos:rpos + stride_b]; rpos += stride_b
            row = bytearray(stride_b)
            for i in range(stride_b):
                a = row[i - bppb] if i >= bppb else 0
                b = prev_bits[i]
                c = prev_bits[i - bppb] if i >= bppb else 0
                x = line[i]
                if f == 0: v = x
                elif f == 1: v = (x + a) & 255
                elif f == 2: v = (x + b) & 255
                elif f == 3: v = (x + (a + b) // 2) & 255
                elif f == 4: v = (x + paeth(a, b, c)) & 255
                else: raise AssertionError('bad filter ' + str(f))
                row[i] = v
            out_bits[y * stride_b:(y + 1) * stride_b] = row
            prev_bits = row
        # unpack bits -> palette or gray -> RGB bytes
        out = bytearray(w * h * 3)
        for y in range(h):
            stride_b = (stride_bits + 7) // 8
            for x in range(nsamp):
                idx = 0
                base = y * stride_bits + x * bitdepth
                for k in range(bitdepth):
                    idx = (idx << 1) | getbit(out_bits, base + k)
                if color_type == 3:
                    r, g, b = palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]
                else:
                    mx = (1 << bitdepth) - 1
                    r = g = b = idx * 255 // mx
                o = (y * w + (x // channels)) * 3 + (x % channels)
                out[o] = r; out[o + 1] = g; out[o + 2] = b
        return w, h, bytes(out)
    channels = channels * (2 if bitdepth == 16 else 1)  # 16-bit: 2 bytes/chan
    bpp = channels  # bytes per pixel (8-bit)
    stride = w * bpp
    out = bytearray(w * h * bpp)

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        return a if pa <= pb and pa <= pc else (b if pb <= pc else c)

    rpos = 0
    for y in range(h):
        f = raw[rpos]; rpos += 1
        line = raw[rpos:rpos + stride]; rpos += stride
        prev = out[(y - 1) * stride: y * stride] if y else bytes(stride)
        for i in range(stride):
            a = out[y * stride + i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            x = line[i]
            if f == 0: v = x
            elif f == 1: v = (x + a) & 255
            elif f == 2: v = (x + b) & 255
            elif f == 3: v = (x + (a + b) // 2) & 255
            elif f == 4: v = (x + paeth(a, b, c)) & 255
            else: raise ValueError('filter')
            out[y * stride + i] = v
    # normalize to RGB
    if bitdepth == 16:
        # resample to 8-bit by taking the high byte of each channel
        rgb16 = bytearray(w * h * 3)
        for y in range(h):
            for x in range(w):
                i = (y * w + x)
                if color_type == 2:
                    o = i * 6; r = out[o]; g = out[o + 2]; b = out[o + 4]
                elif color_type == 6:
                    o = i * 8; r = out[o]; g = out[o + 2]; b = out[o + 4]
                else:  # gray16
                    o = i * 2; r = g = b = out[o]
                j = i * 3
                rgb16[j] = r; rgb16[j + 1] = g; rgb16[j + 2] = b
        return w, h, rgb16
    rgb = bytearray(w * h * 3)
    for y in range(h):
        for x in range(w):
            i = (y * w + x)
            if color_type == 2:
                r, g, b = out[i * 3], out[i * 3 + 1], out[i * 3 + 2]
            elif color_type == 6:
                r, g, b = out[i * 4], out[i * 4 + 1], out[i * 4 + 2]
            elif color_type == 0:
                r = g = b = out[i]
            elif color_type == 4:
                r = g = b = out[i * 2]
            else:  # palette
                p = out[i] * 3
                r, g, b = palette[p], palette[p + 1], palette[p + 2]
            j = i * 3
            rgb[j] = r; rgb[j + 1] = g; rgb[j + 2] = b
    return w, h, rgb


def write_png(path, w, h, rgb):
    def chunk(typ, payload):
        c = struct.pack('>I', len(payload)) + typ + payload
        return c + struct.pack('>I', zlib.crc32(typ + payload) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgb[y * w * 3:(y + 1) * w * 3]
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)


def main():
    path, outp, x, y, w, h, scale = sys.argv[1], sys.argv[2], *[int(v) for v in sys.argv[3:8]]
    W, H, rgb = read_png(path)
    x = max(0, x); y = max(0, y)
    w = min(w, W - x); h = min(h, H - y)
    ow, oh = w * scale, h * scale
    out = bytearray(ow * oh * 3)
    for oy in range(oh):
        sy = y + oy // scale
        for ox in range(ow):
            sx = x + ox // scale
            si = (sy * W + sx) * 3; di = (oy * ow + ox) * 3
            out[di] = rgb[si]; out[di + 1] = rgb[si + 1]; out[di + 2] = rgb[si + 2]
    write_png(outp, ow, oh, bytes(out))
    print(f'{outp}: {ow}x{oh}')


if __name__ == '__main__':
    main()
