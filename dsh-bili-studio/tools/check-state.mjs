// 设置持久化 + 登录态/二维码冒烟：两次独立 createStudio 验证「重开不丢」。
import { createStudio } from '../lib/studio.js'

const first = createStudio({})
const saved = first.setSettings({
  schedule: { perWeek: 3, windows: [{ start: '19:00', end: '23:30' }], timezone: 'Asia/Shanghai' },
  content: { tid: 201, tags: ['AI', '科普', '自制'], coverStyle: 'deep-ocean' },
})
console.log('保存设置：', saved.ok, saved.errors.join('；'))
first.dispose()

const second = createStudio({})
const reread = second.getSettings().settings
console.log('重开后读到：', JSON.stringify(reread.schedule))
console.log('内容设置：', JSON.stringify({ tid: reread.content.tid, tags: reread.content.tags, coverStyle: reread.content.coverStyle }))

const login = await second.loginStatus({ force: true })
console.log('登录态：', JSON.stringify(login))

const qr = await second.loginStart()
console.log('二维码：', JSON.stringify({ ok: qr.ok, qrFile: qr.qrFile, expiresIn: qr.expiresIn, error: qr.error }))
if (qr.ok) {
  const poll = await second.loginPoll()
  console.log('轮询：', JSON.stringify({ state: poll.state, message: poll.message, ok: poll.ok }))
  console.log('再次读登录态：', JSON.stringify(await second.loginStatus({ force: true })))
}
second.dispose()