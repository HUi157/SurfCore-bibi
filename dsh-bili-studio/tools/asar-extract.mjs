// 把 app.asar 里的一个成员解到工作区，方便用 grep 看（asar 是普通归档：8 字节 pickle + header JSON + 数据）。
// 用法：node tools/asar-extract.mjs <asar> <内含路径> <输出文件>
import { readFileSync, writeFileSync } from 'node:fs'

const [asarPath, innerPath, outPath] = process.argv.slice(2)
const buf = readFileSync(asarPath)
const headerSize = buf.readUInt32LE(4) // 含 4 字节长度前缀的 header pickle 总长
const jsonLength = buf.readUInt32LE(8)
const headerJson = buf.toString('utf8', 12, 12 + jsonLength)
const header = JSON.parse(headerJson)
const dataStart = 8 + headerSize

let node = header
for (const part of innerPath.split('/').filter(Boolean)) {
  if (!node.files || !node.files[part]) {
    console.error('没找到：', part)
    process.exit(1)
  }
  node = node.files[part]
}
if (!node.offset) {
  console.error('这是目录，不是文件')
  process.exit(1)
}
const start = dataStart + Number(node.offset)
const size = Number(node.size)
writeFileSync(outPath, buf.subarray(start, start + size))
console.log(outPath, size, 'bytes')