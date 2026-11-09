// 收尾：把联调产生的条目全部取消，再干净地做一条 15 秒待审片。
import { createStudio } from '../lib/studio.js'

const studio = createStudio()
const before = studio.loadQueue()
for (const item of before.items) {
  if (item.status !== 'cancelled' && item.status !== 'published') {
    const result = studio.cancel({ itemId: item.id, reason: '联调收尾，取消旧的测试条目' })
    console.log('cancel', item.id, result.ok)
  }
}

const topics = studio.topics({ keyword: '科普' })
const created = studio.script({ topic: topics.candidates[0], targetSeconds: 15 })
console.log('新条目：', created.itemId, created.title)
const built = await studio.build({ itemId: created.itemId })
console.log('出片：', JSON.stringify({ ok: built.ok, duration: built.durationSeconds, sizeMB: built.sizeMB, video: built.video?.path, cover: built.cover?.path && `${built.cover.width}x${built.cover.height}` }))
const review = studio.review({ itemId: created.itemId })
console.log('可发布：', review.ready, '| title =', review.title, '| tid =', review.tid)
const status = await studio.status({ withLogin: false })
console.log('队列：', JSON.stringify(status.counts), '额度：', JSON.stringify(status.quota))
studio.dispose()