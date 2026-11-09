// 只读图片头拿尺寸：投稿校验要求封面 1920x1080，不引入图像库。
import { openSync, readSync, closeSync, statSync } from 'node:fs'

function readBytes(file, length) {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    const read = readSync(fd, buf, 0, length, 0)
    return buf.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

export function imageSize(file) {
  let size = 0
  try {
    size = statSync(file).size
  } catch {
    return null
  }
  const head = readBytes(file, Math.min(size, 64 * 1024))
  if (head.length >= 24 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), format: 'png' }
  }
  if (head.length >= 10 && head.toString('ascii', 0, 3) === 'GIF') {
    return { width: head.readUInt16LE(6), height: head.readUInt16LE(8), format: 'gif' }
  }
  if (head.length >= 30 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
    return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff, format: 'webp' }
  }
  if (head.length >= 4 && head[0] === 0xff && head[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < head.length) {
      if (head[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = head[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: head.readUInt16BE(offset + 5), width: head.readUInt16BE(offset + 7), format: 'jpeg' }
      }
      const length = head.readUInt16BE(offset + 2)
      if (length <= 0) break
      offset += 2 + length
    }
  }
  return null
}