// 工作室核心：选题 → 脚本 → 出片 → 审批 → 投稿，以及节奏调度与状态读写。
// 所有对外方法都返回纯 JSON（可以直接给工具、HTTP、SurfCore 用）。
import { randomBytes } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePaths } from './paths.js'
import { createStore } from './store.js'
import { createBili } from './bili.js'
import { runProcess, pathsForPython as buildPathsEnv, BUILD_TIMEOUT_MS } from './runner.js'
import { maskSecrets } from './log.js'
import { DEFAULT_SETTINGS, normalizeSettings, describeSettings, COVER_STYLES, TID_LABELS } from './settings.js'
import { generateTopics, topicForScript } from './topics.js'
import { composeProject, writeProject, buildDescription } from './script.js'
import { imageSize } from './imaging.js'

const APPROVAL_PHRASES = /(同意|按此发布|可以发|发布吧|确认发布|准了|就这么发)/
const TOKEN_TTL_MS = 30 * 60 * 1000

function nowIso() {
  return new Date().toISOString()
}

function defaultState() {
  const { settings } = normalizeSettings(DEFAULT_SETTINGS)
  return {
    version: 1,
    settings,
    counters: { topicSeed: Math.floor(Date.now() / 3600000), seq: 0 },
    tokens: [],
    missed: [],
    autoBuilds: [],
    week: { key: '', built: 0 },
    login: { checkedAt: 0, status: null },
    lastTickAt: 0,
  }
}

function zoneParts(date, timeZone) {
  let fmt
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  const parts = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: hour,
    mm: Number(parts.minute),
    minutes: hour * 60 + Number(parts.minute),
    dateKey: `${parts.year}${parts.month}${parts.day}`,
  }
}

function weekKeyOf(parts) {
  const utc = Date.UTC(parts.y, parts.m - 1, parts.d)
  const day = new Date(utc).getUTCDay() || 7
  const thursday = new Date(utc + (4 - day) * 86400000)
  const year = thursday.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  const firstDay = firstThursday.getUTCDay() || 7
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime() - (4 - firstDay) * 86400000) / (7 * 86400000))
  return `${year}-W${String(week).padStart(2, '0')}`
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

function slugSafe(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .slice(0, 60)
}

export function createStudio({ ctx, options = {}, onEvent = () => {} } = {}) {
  const paths = resolvePaths(options)
  const store = createStore(paths.dataDir)
  const bili = createBili({ paths, env: {} })
  const busy = new Set()
  let stateCache = null
  let queueCache = null
  let stateStamp = 0
  let queueStamp = 0

  function stampOf(name) {
    try {
      const stat = statSync(store.pathOf(name))
      return `${stat.mtimeMs}:${stat.size}`
    } catch {
      return '0:0'
    }
  }

  // ---------------------------------------------------------------- 状态
  function loadState() {
    const stamp = stampOf('state')
    if (stateCache && stamp === stateStamp) return stateCache
    const raw = store.readJson('state', null)
    stateStamp = stamp
    const base = defaultState()
    if (!raw || typeof raw !== 'object') {
      stateCache = base
      return stateCache
    }
    const { settings } = normalizeSettings(raw.settings)
    stateCache = {
      ...base,
      ...raw,
      settings,
      tokens: Array.isArray(raw.tokens) ? raw.tokens : [],
      missed: Array.isArray(raw.missed) ? raw.missed : [],
      autoBuilds: Array.isArray(raw.autoBuilds) ? raw.autoBuilds : [],
      counters: { ...base.counters, ...(raw.counters || {}) },
      week: { ...base.week, ...(raw.week || {}) },
      login: { ...base.login, ...(raw.login || {}) },
    }
    return stateCache
  }

  function saveState() {
    const state = loadState()
    const cutoff = Date.now() - 48 * 3600 * 1000
    state.tokens = state.tokens.filter((token) => Date.parse(token.issuedAt) > cutoff)
    state.missed = state.missed.slice(-50)
    state.autoBuilds = state.autoBuilds.slice(-50)
    store.writeJson('state', state)
    stateStamp = stampOf('state')
  }

  function loadQueue() {
    const stamp = stampOf('queue')
    if (queueCache && stamp === queueStamp) return queueCache
    const raw = store.readJson('queue', null)
    queueStamp = stamp
    if (!raw || !Array.isArray(raw.items)) {
      queueCache = { items: [] }
      return queueCache
    }
    queueCache = { items: raw.items }
    return queueCache
  }

  function saveQueue(queue) {
    queueCache = queue
    store.writeJson('queue', queue)
    queueStamp = stampOf('queue')
    return queue
  }

  function findItem(queue, itemId) {
    return queue.items.find((item) => item.id === itemId)
  }

  function logEvent(type, payload) {
    const record = { at: nowIso(), type, ...payload }
    store.appendLine('events', record)
    try {
      onEvent(record)
    } catch {
      // 事件订阅者出错不影响主流程
    }
  }

  function nextId() {
    const state = loadState()
    const queue = loadQueue()
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    let id = ''
    // 跨进程/跨重启也可能撞号：撞了就继续加，保证 id 唯一
    do {
      state.counters.seq = (state.counters.seq || 0) + 1
      id = `Q-${stamp}-${String(state.counters.seq).padStart(3, '0')}`
    } while (queue.items.some((item) => item.id === id))
    saveState()
    return id
  }

  async function probeDuration(file) {
    const result = await runProcess(
      join(paths.ffmpegDir, 'ffprobe.exe'),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { timeoutMs: 30000 },
    )
    const value = Number.parseFloat(String(result.stdout).trim())
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
  }

  // ---------------------------------------------------------------- 账号
  async function loginStatus({ force = false } = {}) {
    const state = loadState()
    const fresh = Date.now() - (state.login.checkedAt || 0) < 60 * 1000
    if (!force && fresh && state.login.status) return state.login.status
    const result = await bili.status()
    const status = {
      loggedIn: Boolean(result.loggedIn),
      uname: result.uname || '',
      mid: result.mid || '',
      expired: Boolean(result.expired),
      reason: result.reason ? maskSecrets(String(result.reason)) : '',
      checkedAt: nowIso(),
      hasPython: existsSync(paths.python),
    }
    state.login = { checkedAt: Date.now(), status }
    saveState()
    return status
  }

  // ---------------------------------------------------------------- 选题
  function topics({ keyword } = {}) {
    const state = loadState()
    const queue = loadQueue()
    const recent = queue.items
      .slice(-20)
      .map((item) => item.topic?.title)
      .filter(Boolean)
      .concat(store.readLines('history').filter((row) => row.type === 'build').slice(-10).map((row) => row.title))
    state.counters.topicSeed = (state.counters.topicSeed || 0) + 1
    saveState()
    const candidates = generateTopics({
      settings: state.settings,
      recentTitles: recent,
      count: 3,
      seed: state.counters.topicSeed,
      keyword,
    })
    return { candidates, source: 'offline-template', settings: describeSettings(state.settings) }
  }

  // ---------------------------------------------------------------- 脚本
  function script(args = {}) {
    const state = loadState()
    const incoming = typeof args.topic === 'string' ? { title: args.topic } : args.topic
    let topic = incoming ? topicForScript(incoming) : null
    if (!topic) {
      const picked = topics({ keyword: args.keyword })
      topic = topicForScript(picked.candidates[0])
    }
    if (!topic) return { ok: false, error: '没有可用的选题' }
    const targetSeconds = Number(args.targetSeconds) > 0 ? Number(args.targetSeconds) : null
    const composed = composeProject({ topic, settings: state.settings, targetSeconds })
    const written = writeProject({ paths, topic, project: composed.project, meta: composed.meta })
    const queue = loadQueue()
    const item = {
      id: nextId(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: 'planned',
      source: args.source || 'manual',
      topic,
      dir: written.dir,
      projectPath: written.projectPath,
      meta: {
        title: composed.meta.title,
        desc: buildDescription({
          template: state.settings.content.descTemplate,
          title: composed.meta.title,
          summary: composed.meta.summary,
          tags: composed.meta.tags,
        }),
        tags: composed.meta.tags,
        tid: composed.meta.tid,
      },
      estimate: { seconds: composed.estimatedSeconds, shots: composed.project.shots.length },
      build: { attempts: 0 },
      publish: null,
      approval: null,
    }
    queue.items.push(item)
    saveQueue(queue)
    logEvent('script', { itemId: item.id, title: item.meta.title })
    return {
      ok: true,
      itemId: item.id,
      dir: written.dir,
      projectPath: written.projectPath,
      title: item.meta.title,
      tags: item.meta.tags,
      tid: item.meta.tid,
      estimatedSeconds: composed.estimatedSeconds,
      shots: composed.project.shots.map((shot) => ({ id: shot.id, title: shot.title, narration: shot.narration })),
      nextStep: `studio_build({ itemId: '${item.id}' }) 出片`,
    }
  }

  // ---------------------------------------------------------------- 出片
  async function build({ itemId, voice = true } = {}) {
    const queue = loadQueue()
    const item = findItem(queue, itemId)
    if (!item) return { ok: false, error: `队列里没有 ${itemId}` }
    if (item.status === 'building') return { ok: false, error: `${itemId} 正在制作中` }
    if (!['planned', 'failed', 'pending_review'].includes(item.status)) {
      return { ok: false, error: `${itemId} 当前状态 ${item.status} 不能制作` }
    }
    if (!existsSync(paths.python)) return { ok: false, error: `找不到 Python：${paths.python}` }
    if (busy.has(item.id)) return { ok: false, error: `${itemId} 正在跑` }
    busy.add(item.id)
    const state = loadState()
    const env = buildPathsEnv(paths)
    try {
      item.status = 'building'
      item.build = { ...(item.build || {}), startedAt: nowIso(), attempts: (item.build?.attempts || 0) + 1, lastError: '' }
      item.updatedAt = nowIso()
      saveQueue(queue)
      logEvent('build-start', { itemId: item.id })

      let voiceNote = ''
      if (voice) {
        const tts = await runProcess(
          paths.python,
          [paths.ttsScript, 'project.json', state.settings.content.voice, state.settings.content.rate],
          { cwd: item.dir, timeoutMs: 180000, env },
        )
        if (!tts.ok) {
          voiceNote = `配音失败（继续出无声版）：${maskSecrets(tts.stderr.slice(-400) || tts.error)}`
          logEvent('tts-failed', { itemId: item.id, reason: voiceNote })
        }
      }

      const edit = await runProcess(paths.python, [paths.editScript, 'project.json'], {
        cwd: item.dir,
        timeoutMs: BUILD_TIMEOUT_MS,
        env,
      })
      if (!edit.ok) {
        item.status = 'failed'
        item.build.lastError = edit.timedOut ? '剪辑超时' : maskSecrets(edit.stderr.slice(-1200) || edit.error)
        item.updatedAt = nowIso()
        saveQueue(queue)
        logEvent('build-failed', { itemId: item.id, reason: item.build.lastError })
        return { ok: false, error: `出片失败：${item.build.lastError}`, itemId: item.id }
      }

      const videoPath = join(item.dir, 'film.mp4')
      const coverPath = join(item.dir, 'cover-final.png')
      const srtPath = join(item.dir, '字幕.srt')
      if (!existsSync(videoPath)) {
        item.status = 'failed'
        item.build.lastError = 'edit.py 跑完但没有 film.mp4'
        saveQueue(queue)
        return { ok: false, error: item.build.lastError, itemId: item.id }
      }
      const duration = await probeDuration(videoPath)
      const sizeBytes = statSync(videoPath).size
      const coverSize = existsSync(coverPath) ? imageSize(coverPath) : null
      item.video = { path: videoPath, duration, sizeBytes }
      item.cover = coverPath && existsSync(coverPath) ? { path: coverPath, ...(coverSize || {}) } : null
      item.srtPath = existsSync(srtPath) ? srtPath : ''
      item.status = 'pending_review'
      item.build.finishedAt = nowIso()
      item.build.voiceNote = voiceNote
      item.updatedAt = nowIso()
      state.lastBuildAt = nowIso()
      saveState()
      saveQueue(queue)
      logEvent('build', { itemId: item.id, title: item.meta?.title, duration, sizeBytes })
      return {
        ok: true,
        itemId: item.id,
        status: item.status,
        video: item.video,
        cover: item.cover,
        srt: item.srtPath,
        durationSeconds: duration,
        sizeMB: Math.round((sizeBytes / 1048576) * 100) / 100,
        voiceNote,
        nextStep: `studio_review({ itemId: '${item.id}' }) 打包审批材料`,
      }
    } finally {
      busy.delete(item.id)
    }
  }

  // ---------------------------------------------------------------- 审批材料
  function validationsFor(item) {
    const checks = []
    const push = (name, ok, detail) => checks.push({ name, ok, detail })
    const videoPath = item.video?.path || ''
    push('视频文件存在', Boolean(videoPath && existsSync(videoPath)), videoPath || '没有成片')
    const duration = Number(item.video?.duration || 0)
    push('时长可读', duration > 0, `${duration}s`)
    const cover = item.cover
    push('封面存在', Boolean(cover?.path && existsSync(cover.path)), cover?.path || '没有封面')
    push(
      '封面 1920x1080',
      cover?.width === 1920 && cover?.height === 1080,
      cover ? `${cover.width}x${cover.height}` : '无',
    )
    const title = String(item.meta?.title || '')
    push('标题 ≤80 字', title.length > 0 && title.length <= 80, `${title.length} 字`)
    const desc = String(item.meta?.desc || '')
    push('简介 ≤2000 字', desc.length <= 2000, `${desc.length} 字`)
    push('标签 ≥1 个', Array.isArray(item.meta?.tags) && item.meta.tags.length >= 1, `${item.meta?.tags?.length || 0} 个`)
    push('分区 tid', Number.isInteger(Number(item.meta?.tid)) && Number(item.meta.tid) > 0, String(item.meta?.tid))
    return checks
  }

  function review({ itemId } = {}) {
    const queue = loadQueue()
    const item = findItem(queue, itemId)
    if (!item) return { ok: false, error: `队列里没有 ${itemId}` }
    if (!item.video) return { ok: false, error: `${itemId} 还没出片，先 studio_build` }
    const checks = validationsFor(item)
    const state = loadState()
    const timeline = item.video?.duration
      ? [{ from: 0, to: item.video.duration, label: `${item.topic?.title || item.meta?.title}`, shots: item.estimate?.shots || 0 }]
      : []
    const window = state.settings.schedule.windows[0]
    return {
      ok: true,
      itemId: item.id,
      status: item.status,
      approvalRequired: true,
      title: item.meta?.title,
      desc: item.meta?.desc,
      tags: item.meta?.tags,
      tid: item.meta?.tid,
      tidLabel: TID_LABELS[item.meta?.tid] || '其它',
      cover: item.cover,
      video: item.video,
      srt: item.srtPath,
      timeline,
      checks,
      ready: checks.every((check) => check.ok),
      advice: {
        publishWindow: window ? `${window.start}–${window.end}` : '未设置',
        whyNow: `本周已安排 ${state.settings.schedule.perWeek} 条，这条按${item.topic?.formatLabel || '常规'}形态排在${window ? window.start : '晚间'}档`,
        titleLength: `${String(item.meta?.title || '').length}/80`,
      },
      approval: {
        required: true,
        howTo: '在右侧栏点「同意发布」，或在对话里明确说「按此发布 / 同意」；插件会发一次性 confirm_token（30 分钟）',
        tokenTtlMinutes: 30,
      },
    }
  }

  function issueToken({ itemId, source = 'chat', quote = '' } = {}) {
    const queue = loadQueue()
    const item = findItem(queue, itemId)
    if (!item) return { ok: false, error: `队列里没有 ${itemId}` }
    if (item.status !== 'pending_review') return { ok: false, error: `${itemId} 当前状态 ${item.status}，不在待审队列` }
    if (source !== 'ui') {
      const text = String(quote || '')
      if (text.length < 2 || !APPROVAL_PHRASES.test(text)) {
        return {
          ok: false,
          error: '没有看到明确同意。需要用户原话里出现「同意 / 按此发布 / 可以发」这类表述，并把原话放进 quote。',
        }
      }
    }
    const state = loadState()
    const token = `bt_${randomBytes(16).toString('hex')}`
    const issuedAt = new Date()
    const expiresAt = new Date(issuedAt.getTime() + TOKEN_TTL_MS)
    state.tokens.push({
      token,
      itemId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      used: false,
      source,
      quote: maskSecrets(String(quote || '').slice(0, 200)),
    })
    item.approval = { issuedAt: issuedAt.toISOString(), source, expiresAt: expiresAt.toISOString() }
    item.updatedAt = nowIso()
    saveState()
    saveQueue(queue)
    logEvent('approve', { itemId, source })
    return {
      ok: true,
      itemId,
      confirmToken: token,
      expiresAt: expiresAt.toISOString(),
      ttlMinutes: 30,
      note: '一次性令牌：用过即废；30 分钟过期。只有拿到它才能调 studio_publish。',
    }
  }

  // ---------------------------------------------------------------- 投稿
  function consumeToken(token, itemId) {
    const state = loadState()
    const entry = state.tokens.find((row) => row.token === token)
    if (!entry) return { ok: false, error: 'confirm_token 不存在（可能已被使用或从未签发）' }
    if (entry.used) return { ok: false, error: 'confirm_token 已经用过，一次性令牌作废' }
    if (entry.itemId !== itemId) return { ok: false, error: `confirm_token 属于 ${entry.itemId}，不是 ${itemId}` }
    if (Date.parse(entry.expiresAt) < Date.now()) return { ok: false, error: 'confirm_token 已过期（有效期 30 分钟），请重新审批' }
    entry.used = true
    entry.usedAt = nowIso()
    saveState()
    return { ok: true, entry }
  }

  async function publish({ itemId, confirmToken, cleanup = 'none', dryRun = false } = {}) {
    const queue = loadQueue()
    const item = findItem(queue, itemId)
    if (!item) return { ok: false, error: `队列里没有 ${itemId}` }
    if (!confirmToken) {
      return {
        ok: false,
        rejected: true,
        error: '缺 confirm_token：投稿必须先在右侧栏点「同意发布」或对话里明确同意，插件签发一次性令牌后才能发。',
        required: 'confirmToken',
        how: 'studio_approve({ itemId, quote: "用户原话" }) 或设置页「同意发布」按钮',
      }
    }
    if (item.status === 'published') return { ok: false, error: `${itemId} 已经发布过了：${item.publish?.bvid || ''}` }
    if (item.status !== 'pending_review') return { ok: false, error: `${itemId} 当前状态 ${item.status}，不在待审队列` }

    // 先做只读校验：校验不过不该烧掉令牌
    const checks = validationsFor(item)
    const failed = checks.filter((check) => !check.ok)
    if (failed.length > 0) {
      return { ok: false, error: `投稿前校验没过：${failed.map((c) => `${c.name}（${c.detail}）`).join('、')}`, checks }
    }

    // dry-run：只报告会传什么，不消耗令牌、不发请求
    if (dryRun) {
      const peek = loadState().tokens.find((row) => row.token === confirmToken)
      return {
        ok: true,
        dryRun: true,
        itemId,
        tokenValid: Boolean(peek && !peek.used && peek.itemId === itemId && Date.parse(peek.expiresAt) > Date.now()),
        wouldUpload: {
          video: item.video.path,
          cover: item.cover.path,
          title: item.meta.title,
          desc: item.meta.desc,
          tags: item.meta.tags,
          tid: item.meta.tid,
        },
        checks,
        note: 'dry-run 不消耗令牌、不发起上传',
      }
    }

    const tokenCheck = consumeToken(confirmToken, itemId)
    if (!tokenCheck.ok) {
      return { ok: false, rejected: true, error: tokenCheck.error, required: 'valid confirmToken' }
    }

    item.status = 'publishing'
    item.updatedAt = nowIso()
    saveQueue(queue)
    logEvent('publish-start', { itemId })

    const result = await bili.upload({
      video: item.video.path,
      cover: item.cover.path,
      title: item.meta.title,
      desc: item.meta.desc,
      tags: item.meta.tags,
      tid: Number(item.meta.tid),
    })

    if (!result.ok) {
      item.status = 'pending_review'
      item.publish = {
        ...(item.publish || {}),
        lastError: maskSecrets(String(result.error || '上传失败')),
        attempts: (item.publish?.attempts || 0) + 1,
        at: nowIso(),
      }
      saveQueue(queue)
      const expired = /code=-101|未登录|登录态/.test(String(result.error || ''))
      if (expired) {
        const state = loadState()
        state.login = { checkedAt: Date.now(), status: { loggedIn: false, expired: true, reason: '登录态失效' } }
        saveState()
      }
      logEvent('publish-failed', { itemId, reason: item.publish.lastError })
      return {
        ok: false,
        itemId,
        error: item.publish.lastError,
        loginExpired: expired,
        hint: expired ? 'B 站登录态失效：重新扫码登录，不要反复重试上传' : '令牌已作废，重试需要重新审批',
        attempts: result.attempts || [],
      }
    }

    item.status = 'published'
    item.publish = {
      ...(item.publish || {}),
      bvid: result.bvid || '',
      aid: result.aid || null,
      at: nowIso(),
      attempts: (item.publish?.attempts || 0) + 1,
    }
    item.updatedAt = nowIso()
    saveQueue(queue)
    logEvent('publish', { itemId, bvid: item.publish.bvid, aid: item.publish.aid })
    store.appendLine('history', {
      at: nowIso(),
      type: 'publish',
      itemId,
      title: item.meta.title,
      bvid: item.publish.bvid,
      aid: item.publish.aid,
      tid: item.meta.tid,
    })

    let cleanupResult = null
    if (cleanup === 'delete' && item.publish.bvid) {
      cleanupResult = await bili.deleteVideo(item.publish.bvid)
      logEvent('cleanup', { itemId, bvid: item.publish.bvid, ok: cleanupResult.ok })
    }

    return {
      ok: true,
      itemId,
      bvid: item.publish.bvid,
      aid: item.publish.aid,
      url: item.publish.bvid ? `https://www.bilibili.com/video/${item.publish.bvid}` : '',
      cleanup: cleanupResult,
    }
  }

  // ---------------------------------------------------------------- 状态
  async function status({ withLogin = true } = {}) {
    const queue = loadQueue()
    const state = loadState()
    const byStatus = (name) => queue.items.filter((item) => item.status === name)
    const login = withLogin ? await loginStatus() : state.login.status
    const history = store.readLines('history').slice(-20)
    return {
      ok: true,
      settings: describeSettings(state.settings),
      settingsFull: state.settings,
      login,
      counts: {
        planned: byStatus('planned').length,
        pendingReview: byStatus('pending_review').length,
        published: byStatus('published').length,
        failed: byStatus('failed').length,
        cancelled: byStatus('cancelled').length,
        building: byStatus('building').length,
      },
      planned: byStatus('planned').map(summarize),
      pendingReview: byStatus('pending_review').map(summarize),
      published: byStatus('published').map(summarize),
      failed: byStatus('failed').map(summarize),
      history,
      missed: state.missed.slice(-10),
      nextWindow: nextWindowLabel(),
      quota: weekQuota(),
    }
  }

  function summarize(item) {
    return {
      id: item.id,
      status: item.status,
      title: item.meta?.title,
      createdAt: item.createdAt,
      dir: item.dir,
      video: item.video ? { path: item.video.path, duration: item.video.duration } : null,
      cover: item.cover ? { path: item.cover.path, width: item.cover.width, height: item.cover.height } : null,
      bvid: item.publish?.bvid || '',
      tid: item.meta?.tid,
      tags: item.meta?.tags,
    }
  }

  // ---------------------------------------------------------------- 排期
  function weekQuota() {
    const state = loadState()
    const zone = state.settings.schedule.timezone
    const parts = zoneParts(new Date(), zone)
    const key = weekKeyOf(parts)
    const queue = loadQueue()
    const built = queue.items.filter((item) => {
      if (item.status === 'cancelled') return false
      const created = new Date(item.createdAt)
      if (Number.isNaN(created.getTime())) return false
      return weekKeyOf(zoneParts(created, zone)) === key
    }).length
    return { week: key, built, perWeek: state.settings.schedule.perWeek, remaining: Math.max(0, state.settings.schedule.perWeek - built) }
  }

  function windowsForToday() {
    const state = loadState()
    const zone = state.settings.schedule.timezone
    const parts = zoneParts(new Date(), zone)
    return state.settings.schedule.windows.map((win) => ({
      ...win,
      startMinutes: minutesOf(win.start),
      endMinutes: minutesOf(win.end),
      dateKey: parts.dateKey,
      nowMinutes: parts.minutes,
    }))
  }

  function nextWindowLabel() {
    const state = loadState()
    const zone = state.settings.schedule.timezone
    const parts = zoneParts(new Date(), zone)
    for (const win of state.settings.schedule.windows) {
      if (minutesOf(win.start) > parts.minutes) return `今天 ${win.start}–${win.end}`
    }
    return `明天 ${state.settings.schedule.windows[0]?.start || '19:00'}–${state.settings.schedule.windows[0]?.end || '23:30'}`
  }

  /** 下一次该醒来的毫秒数：窗口边界优先，最长 30 分钟兜底。 */
  function nextWakeMs() {
    const state = loadState()
    if (!state.settings.schedule.enabled) return 30 * 60 * 1000
    const zone = state.settings.schedule.timezone
    const parts = zoneParts(new Date(), zone)
    const boundaries = []
    for (const win of state.settings.schedule.windows) {
      const start = minutesOf(win.start)
      const end = minutesOf(win.end)
      if (start > parts.minutes) boundaries.push((start - parts.minutes) * 60000)
      if (end > parts.minutes) boundaries.push((end - parts.minutes) * 60000)
    }
    const earliest = boundaries.length > 0 ? Math.min(...boundaries) : 6 * 3600 * 1000
    return Math.max(60000, Math.min(earliest, 30 * 60 * 1000))
  }

  async function tickScheduled() {
    const state = loadState()
    const schedule = state.settings.schedule
    if (!schedule.enabled) return { ran: false, reason: 'disabled' }
    const zone = schedule.timezone
    const parts = zoneParts(new Date(), zone)
    const quota = weekQuota()

    // 1) 记漏掉的窗口：今天已经结束、且当时这条窗口里没有自动制作
    for (const win of schedule.windows) {
      const key = `${parts.dateKey}:${win.start}-${win.end}`
      const ended = parts.minutes >= minutesOf(win.end)
      const had = state.autoBuilds.some((entry) => entry.windowKey === key)
      if (ended && !had && quota.remaining > 0 && !state.missed.some((row) => row.windowKey === key)) {
        state.missed.push({ at: nowIso(), windowKey: key, window: `${win.start}–${win.end}`, reason: '窗口结束时没有排到制作（漏掉不补跑）' })
        saveState()
      }
    }

    if (quota.remaining <= 0) {
      state.lastTickAt = Date.now()
      saveState()
      return { ran: false, reason: '本周额度已满', quota }
    }

    const current = schedule.windows.find((win) => {
      const start = minutesOf(win.start)
      const end = minutesOf(win.end)
      return parts.minutes >= start && parts.minutes < end
    })
    if (!current) {
      state.lastTickAt = Date.now()
      saveState()
      return { ran: false, reason: '不在制作时段', next: nextWindowLabel() }
    }

    const windowKey = `${parts.dateKey}:${current.start}-${current.end}`
    if (state.autoBuilds.some((entry) => entry.windowKey === windowKey)) {
      state.lastTickAt = Date.now()
      saveState()
      return { ran: false, reason: '这个时段已经做过一条' }
    }

    // 2) 真跑：选题 → 脚本 → 出片，停在待审
    try {
      const picked = topics({})
      const created = script({ topic: picked.candidates[0], source: 'schedule' })
      if (!created.ok) throw new Error(created.error || '脚本失败')
      const built = await build({ itemId: created.itemId, voice: true })
      state.autoBuilds.push({ at: nowIso(), windowKey, itemId: created.itemId, ok: built.ok })
      state.lastTickAt = Date.now()
      saveState()
      logEvent('scheduled-build', { itemId: created.itemId, windowKey, ok: built.ok })
      return { ran: true, itemId: created.itemId, build: built.ok, status: built.ok ? 'pending_review' : 'failed', error: built.error }
    } catch (error) {
      state.lastTickAt = Date.now()
      saveState()
      logEvent('scheduled-error', { reason: maskSecrets(String(error)) })
      return { ran: false, reason: maskSecrets(String(error)) }
    }
  }

  // ---------------------------------------------------------------- 取消
  function cancel({ itemId, reason = '' } = {}) {
    const queue = loadQueue()
    const item = findItem(queue, itemId)
    if (!item) return { ok: false, error: `队列里没有 ${itemId}` }
    if (['published', 'publishing'].includes(item.status)) {
      return { ok: false, error: `${itemId} 已经发布或正在发布，不能取消（要下架请到 B 站后台操作）` }
    }
    item.status = 'cancelled'
    item.cancelledAt = nowIso()
    item.cancelReason = reason
    item.updatedAt = nowIso()
    saveQueue(queue)
    logEvent('cancel', { itemId, reason })
    return { ok: true, itemId, status: 'cancelled' }
  }

  function skip({ itemId } = {}) {
    return cancel({ itemId, reason: '人工跳过' })
  }

  function updateTitle({ itemId, title } = {}) {
    const queue = loadQueue()
    const item = findItem(queue, itemId)
    if (!item) return { ok: false, error: `队列里没有 ${itemId}` }
    const next = String(title || '').trim()
    if (!next || next.length > 80) return { ok: false, error: '标题要 1–80 字' }
    item.meta.title = next
    item.updatedAt = nowIso()
    saveQueue(queue)
    return { ok: true, itemId, title: next }
  }

  // ---------------------------------------------------------------- 设置
  function getSettings() {
    const state = loadState()
    return { ok: true, settings: state.settings, coverStyles: COVER_STYLES, tids: TID_LABELS }
  }

  function setSettings(patch) {
    const state = loadState()
    const merged = {
      schedule: { ...state.settings.schedule, ...(patch?.schedule || {}) },
      content: { ...state.settings.content, ...(patch?.content || {}) },
    }
    const normalized = normalizeSettings(merged)
    state.settings = normalized.settings
    saveState()
    logEvent('settings', { errors: normalized.errors })
    return { ok: normalized.errors.length === 0, settings: normalized.settings, errors: normalized.errors }
  }

  async function loginStart() {
    const result = await bili.qrStart()
    if (result.ok) {
      const state = loadState()
      state.login = { checkedAt: 0, status: { loggedIn: false, pending: true, qrFile: result.qrFile, checkedAt: nowIso() } }
      saveState()
    }
    return result
  }

  async function loginPoll() {
    const result = await bili.qrPoll()
    if (result.state === 'done') {
      const state = loadState()
      state.login = { checkedAt: 0, status: null }
      saveState()
      const fresh = await loginStatus({ force: true })
      return { ...result, status: fresh }
    }
    return result
  }

  async function logout() {
    const result = await bili.logout()
    const state = loadState()
    state.login = { checkedAt: Date.now(), status: { loggedIn: false, reason: '已退出登录' } }
    saveState()
    return result
  }

  function dispose() {
    stateCache = null
  }

  return {
    paths,
    store,
    bili,
    topics,
    script,
    build,
    review,
    issueToken,
    publish,
    status,
    cancel,
    skip,
    updateTitle,
    getSettings,
    setSettings,
    loginStatus,
    loginStart,
    loginPoll,
    logout,
    nextWakeMs,
    tickScheduled,
    weekQuota,
    summarize,
    loadQueue,
    logEvent,
    dispose,
  }
}