// 在 app.asar 的字节流里找关键词，打印附近的源码片段（不解析 header，避免处理几百 MB 的 JSON）。
// 用法：node tools/asar-slice.mjs <asar> <关键词> [前后字节数] [最多几处]
import { openSync, readSync, fstatSync, closeSync } from 'node:fs'

const [asarPath, needle, spanArg, countArg] = process.argv.slice(2)
const span = Number(spanArg) || 3000
const maxHits = Number(countArg) || 3
const fd = openSync(asarPath, 'r')
const size = fstatSync(fd).size
const chunk = Buffer.alloc(16 * 1024 * 1024)
let carry = Buffer.alloc(0)
let offset = 0
let hits = 0
const target = Buffer.from(needle, 'utf8')

while (offset < size && hits < maxHits) {
  const read = readSync(fd, chunk, 0, chunk.length, offset)
  if (read <= 0) break
  const buf = Buffer.concat([carry, chunk.subarray(0, read)])
  let from = 0
  for (;;) {
    const index = buf.indexOf(target, from)
    if (index < 0) break
    const start = Math.max(0, index - span)
    const end = Math.min(buf.length, index + span)
    console.log(`\n===== hit ${hits + 1} @ ${offset + index - (buf.length - read)} =====`)
    console.log(buf.toString('utf8', start, end))
    hits += 1
    from = index + target.length
    if (hits >= maxHits) break
  }
  carry = buf.subarray(Math.max(0, buf.length - span - target.length - 1))
  offset += read
}
closeSync(fd)
if (hits === 0) console.error('没有命中：' + needle)