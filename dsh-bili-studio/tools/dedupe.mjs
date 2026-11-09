// 只做一件事：把队列里「重复 id」和「遗留 planned」的条目删掉（测试遗留，不是功能）。
import { readFileSync, writeFileSync } from 'node:fs'

const file = 'C:/Users/schui/.dsh/plugin-data/dsh-bili-studio/queue.json'
const queue = JSON.parse(readFileSync(file, 'utf8'))
const seen = new Set()
const keep = []
for (const item of queue.items) {
  const duplicate = seen.has(item.id)
  seen.add(item.id)
  if (duplicate && item.status === 'planned') continue
  if (item.status === 'planned' && item.id !== 'Q-20261109-008') continue
  keep.push(item)
}
queue.items = keep
writeFileSync(file, JSON.stringify(queue, null, 2), 'utf8')
console.log('保留：', keep.map((item) => `${item.id}:${item.status}`).join(', '))