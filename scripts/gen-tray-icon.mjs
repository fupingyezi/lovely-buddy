// 生成 macOS 托盘模板图标（黑色 + alpha 的 template image，16/32px 音符）
// 纯 Node 实现，零依赖（zlib 内置），make setup 时执行一次
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop', 'resources')

// --- 最小 PNG 编码器（RGBA）---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// 音符：圆形符头 + 右侧符杆
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const cx = size * 0.35
  const cy = size * 0.72
  const r = size * 0.28
  const barX = size * 0.58
  const barW = Math.max(1, Math.round(size * 0.09))
  const barTop = size * 0.1
  const barBottom = size * 0.78
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
      const inBar = x >= barX && x < barX + barW && y >= barTop && y <= barBottom
      if (inCircle || inBar) {
        const i = (y * size + x) * 4
        px[i] = 0
        px[i + 1] = 0
        px[i + 2] = 0
        px[i + 3] = 255
      }
    }
  }
  return px
}

mkdirSync(outDir, { recursive: true })
for (const [name, size] of [
  ['trayTemplate.png', 16],
  ['trayTemplate@2x.png', 32]
]) {
  writeFileSync(join(outDir, name), encodePNG(size, drawIcon(size)))
  console.log('✔', join(outDir, name))
}
