// 本地冒烟：不经过宿主，直接驱动 studio 核心跑 选题 → 脚本 → 出片（10 秒测试片）。
// 用法：node tools/smoke.mjs [--seconds 10] [--no-voice]
import { createStudio } from '../lib/studio.js'

const args = process.argv.slice(2)
const secondsArg = args.indexOf('--seconds')
const seconds = secondsArg >= 0 ? Number(args[secondsArg + 1]) : 10
const voice = !args.includes('--no-voice')

const studio = createStudio({ onEvent: (event) => console.log('[event]', event.type) })
const topics = studio.topics({})
console.log('候选：', topics.candidates.map((item) => `${item.title}（${item.estimatedSeconds}s）`).join(' | '))

const created = studio.script({ topic: topics.candidates[0], targetSeconds: seconds })
console.log('脚本：', created.itemId, created.projectPath)
console.log('分镜：', created.shots.map((shot) => shot.id).join(','))

const built = await studio.build({ itemId: created.itemId, voice })
console.log('出片：', JSON.stringify(built, null, 2))

if (built.ok) {
  const review = studio.review({ itemId: created.itemId })
  console.log('审批材料：ready =', review.ready, '封面 =', review.cover && `${review.cover.width}x${review.cover.height}`)
  const denied = await studio.publish({ itemId: created.itemId })
  console.log('无令牌投稿：', JSON.stringify(denied))
  const approval = studio.issueToken({ itemId: created.itemId, quote: '同意，按此发布' })
  console.log('签发令牌：', approval.ok, approval.expiresAt)
  const dry = await studio.publish({ itemId: created.itemId, confirmToken: approval.confirmToken, dryRun: true })
  console.log('dry-run 投稿：', JSON.stringify(dry))
}

studio.dispose()