// 最终自检（用最终源码直接驱动核心，不经过宿主）：
//   A. 10 秒测试片：topic → script → build
//   B. 15 秒小片 + 真投稿尝试（未登录时必须给出「去扫码」而不是乱重试）
import { createStudio } from '../lib/studio.js'

const log = (...args) => console.log(...args)
const studio = createStudio({ onEvent: (event) => log('[event]', event.type) })

// ---------- A. 10 秒测试片 ----------
const topicsA = studio.topics({})
log('A1 候选：', topicsA.candidates.map((c) => c.title).join(' | '))
const scriptA = studio.script({ topic: topicsA.candidates[0], targetSeconds: 10 })
log('A2 脚本：', scriptA.itemId, scriptA.projectPath)
const buildA = await studio.build({ itemId: scriptA.itemId })
log('A3 出片：', JSON.stringify({ ok: buildA.ok, duration: buildA.durationSeconds, sizeMB: buildA.sizeMB, cover: buildA.cover && `${buildA.cover.width}x${buildA.cover.height}`, srt: buildA.srt }))

// ---------- B. 15 秒小片 + 投稿 ----------
const topicsB = studio.topics({ keyword: '效率' })
const scriptB = studio.script({ topic: topicsB.candidates[0], targetSeconds: 15 })
const buildB = await studio.build({ itemId: scriptB.itemId })
log('B1 出片：', JSON.stringify({ ok: buildB.ok, duration: buildB.durationSeconds, sizeMB: buildB.sizeMB }))

const review = studio.review({ itemId: scriptB.itemId })
log('B2 审批材料：', JSON.stringify({ ready: review.ready, title: review.title, tid: review.tid, checks: review.checks.map((c) => `${c.name}:${c.ok}`).join(' ') }))

const noToken = await studio.publish({ itemId: scriptB.itemId })
log('B3 无令牌：', JSON.stringify(noToken))

const forged = await studio.publish({ itemId: scriptB.itemId, confirmToken: 'bt_deadbeef' })
log('B4 伪造令牌：', JSON.stringify(forged))

const approval = studio.issueToken({ itemId: scriptB.itemId, quote: '同意，按此发布' })
log('B5 令牌：', JSON.stringify({ ok: approval.ok, ttl: approval.ttlMinutes, expiresAt: approval.expiresAt }))

const dry = await studio.publish({ itemId: scriptB.itemId, confirmToken: approval.confirmToken, dryRun: true })
log('B6 dry-run：', JSON.stringify({ ok: dry.ok, tokenValid: dry.tokenValid, note: dry.note }))

const real = await studio.publish({ itemId: scriptB.itemId, confirmToken: approval.confirmToken })
log('B7 真投稿：', JSON.stringify(real))

const status = await studio.status({ withLogin: false })
log('C 队列：', JSON.stringify({ counts: status.counts, quota: status.quota }))
studio.dispose()