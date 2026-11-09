// 设置项定义与校验。设置存在 state.json 的 settings 里，不散落在别处。
export const COVER_STYLES = {
  'deep-ocean': { label: '深海蓝', bg: ['#071a2c', '#12466e'], accent: '#7fd4ff' },
  'violet-dusk': { label: '暮紫', bg: ['#1a1026', '#3c2352'], accent: '#ff86b3' },
  'pine': { label: '松林', bg: ['#0d1b2a', '#2a3f5f'], accent: '#9be7c4' },
  'kraft': { label: '牛皮纸', bg: ['#2a1e14', '#7a4b25'], accent: '#ffd166' },
  'solar': { label: '烈日', bg: ['#2b1200', '#c2621a'], accent: '#ffe08a' },
  'mono': { label: '石墨', bg: ['#101214', '#3a3f45'], accent: '#d7dde3' },
}

export const TID_LABELS = {
  201: '科学科普',
  208: '科技',
  188: '科技资讯',
  124: '社科·法律·心理',
  122: '野生技术协会',
}

export const DEFAULT_SETTINGS = {
  version: 1,
  schedule: {
    enabled: true,
    perWeek: 3,
    windows: [{ start: '19:00', end: '23:30' }],
    timezone: 'Asia/Shanghai',
    buildWithinWindowOnly: true,
  },
  content: {
    tid: 201,
    tags: ['AI', '科普', '自制'],
    descTemplate:
      '本期聊「{title}」。\n\n{summary}\n\n{tagsLine}\n\n本片由 dsh-bili-studio 自主制作，人工审核后发布。',
    coverStyle: 'deep-ocean',
    keywords: ['大模型', 'AI 工具', '效率', '硬件', '程序员日常'],
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '+4%',
    titleSuffix: '',
  },
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

function minutesOf(hhmm) {
  const m = HHMM.exec(hhmm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function normalizeSettings(input) {
  const errors = []
  const src = input && typeof input === 'object' ? input : {}
  const scheduleIn = src.schedule && typeof src.schedule === 'object' ? src.schedule : {}
  const contentIn = src.content && typeof src.content === 'object' ? src.content : {}
  const base = DEFAULT_SETTINGS

  let perWeek = Number(scheduleIn.perWeek ?? base.schedule.perWeek)
  if (!Number.isFinite(perWeek) || perWeek < 0 || perWeek > 14) {
    errors.push('每周发布条数必须是 0–14 的整数')
    perWeek = base.schedule.perWeek
  }
  perWeek = Math.round(perWeek)

  const rawWindows = Array.isArray(scheduleIn.windows) && scheduleIn.windows.length > 0 ? scheduleIn.windows : base.schedule.windows
  const windows = []
  for (const win of rawWindows) {
    const start = typeof win?.start === 'string' ? win.start.trim() : ''
    const end = typeof win?.end === 'string' ? win.end.trim() : ''
    const a = minutesOf(start)
    const b = minutesOf(end)
    if (a === null || b === null) {
      errors.push(`时段格式不对：${start}-${end}（要 HH:MM）`)
      continue
    }
    if (a >= b) {
      errors.push(`时段起点要早于终点：${start}-${end}`)
      continue
    }
    windows.push({ start, end })
  }
  if (windows.length === 0) windows.push(...base.schedule.windows)

  let tid = Number(contentIn.tid ?? base.content.tid)
  if (!Number.isInteger(tid) || tid <= 0) {
    errors.push('分区 tid 要是正整数')
    tid = base.content.tid
  }

  const tags = Array.isArray(contentIn.tags)
    ? contentIn.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
    : base.content.tags.slice()
  if (tags.length === 0) errors.push('至少留一个默认标签')

  const keywords = Array.isArray(contentIn.keywords)
    ? contentIn.keywords.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
    : base.content.keywords.slice()

  const coverStyle = COVER_STYLES[contentIn.coverStyle] ? contentIn.coverStyle : base.content.coverStyle

  return {
    settings: {
      version: 1,
      schedule: {
        enabled: scheduleIn.enabled !== false,
        perWeek,
        windows,
        timezone: typeof scheduleIn.timezone === 'string' && scheduleIn.timezone ? scheduleIn.timezone : base.schedule.timezone,
        buildWithinWindowOnly: scheduleIn.buildWithinWindowOnly !== false,
      },
      content: {
        tid,
        tags,
        descTemplate:
          typeof contentIn.descTemplate === 'string' && contentIn.descTemplate.trim()
            ? contentIn.descTemplate
            : base.content.descTemplate,
        coverStyle,
        keywords: keywords.length > 0 ? keywords : base.content.keywords.slice(),
        voice: typeof contentIn.voice === 'string' && contentIn.voice ? contentIn.voice : base.content.voice,
        rate: typeof contentIn.rate === 'string' && contentIn.rate ? contentIn.rate : base.content.rate,
        titleSuffix: typeof contentIn.titleSuffix === 'string' ? contentIn.titleSuffix : '',
      },
    },
    errors,
  }
}

export function describeSettings(settings) {
  const s = settings?.schedule || DEFAULT_SETTINGS.schedule
  return {
    perWeek: s.perWeek,
    windows: s.windows,
    timezone: s.timezone,
    enabled: s.enabled,
    text: `每周 ${s.perWeek} 条，时段 ${s.windows.map((w) => `${w.start}–${w.end}`).join(' / ')}（${s.timezone}）`,
  }
}