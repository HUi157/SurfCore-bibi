// 选题引擎：离线、可复现，不依赖任何在线模型。
// 由「默认关键词 × 内容形态」组合出候选，避开最近做过的标题。
import { createHash } from 'node:crypto'

const FORMATS = [
  {
    key: 'explainer',
    label: '讲清楚',
    est: 75,
    titles: ['{kw}到底怎么用？我把它拆成 {n} 件事', '把 {kw} 讲明白：从「听起来很玄」到「今天就能用」'],
    pitch: (kw) => `不做大而全的综述，只回答「${kw} 对我有什么用」，每一段都能落到一个具体动作上。`,
    outline: ['先给结论：它解决的是哪一类具体麻烦', '拆开看：它到底在做什么', '今天就能试的一步'],
  },
  {
    key: 'fieldtest',
    label: '实测',
    est: 100,
    titles: ['我拿 {kw} 干了一整天活，这几件事它真帮上了', '{kw} 实测：省下来的时间和多花掉的时间'],
    pitch: (kw) => `用真实任务压一遍 ${kw}，把「宣传口径」和「我实际用到的」分开讲，包含失败的部分。`,
    outline: ['任务是什么，为什么值得测', '过程中的三个现场', '省下什么、赔上什么'],
  },
  {
    key: 'myth',
    label: '拆误区',
    est: 90,
    titles: ['关于 {kw} 的三个误解，第二个我也中过', '{kw} 不是万能药：三个最容易踩的坑'],
    pitch: (kw) => `把 ${kw} 周围最常见的三个误解摆出来，一个个对照实际情况，不推销任何工具。`,
    outline: ['误解一：它等于什么', '误解二：它能替你做决定吗', '误解三：成本被谁承担'],
  },
  {
    key: 'shortestpath',
    label: '入门路线',
    est: 120,
    titles: ['{kw} 入门，先别急着装工具', '{kw} 从 0 到 1：一条能跑通的最短路径'],
    pitch: (kw) => `给完全没接触过 ${kw} 的人一条最短路径：先做什么、后做什么、哪些可以先跳过。`,
    outline: ['最少需要准备什么', '第一步跑通的最小闭环', '后面再补的三块'],
  },
  {
    key: 'tradeoff',
    label: '聊取舍',
    est: 85,
    titles: ['{kw} 值不值得投入？先算清这三笔账', '我为什么没有把 {kw} 用在所有事情上'],
    pitch: (kw) => `不站队，只算账：${kw} 在时间、金钱、注意力上的三种成本，以及什么情况下干脆不用。`,
    outline: ['第一笔账：上手成本', '第二笔账：维护成本', '什么情况下应该放弃'],
  },
]

const HOOKS = [
  '先说结论，省得你看到一半还在猜。',
  '这条视频不劝你上车，只把账算清楚。',
  '如果你也在纠结这件事，接下来的两分钟可能有用。',
]

function hashOf(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 8)
}

function normalizeTitle(title) {
  return String(title || '')
    .replace(/[\s，。！？、,.!?：:；;“”"'（）()【】\[\]]/g, '')
    .toLowerCase()
}

function recentlyUsed(title, recentTitles) {
  const target = normalizeTitle(title)
  return recentTitles.some((item) => {
    const other = normalizeTitle(item)
    if (!other) return false
    return other === target || other.includes(target) || target.includes(other)
  })
}

export function generateTopics({ settings, recentTitles = [], count = 3, seed, keyword } = {}) {
  const content = settings?.content || {}
  const keywords = keyword ? [keyword] : content.keywords || ['AI 工具']
  const cursor = Number.isFinite(seed) ? seed : Math.floor(Date.now() / 3600000)
  const candidates = []

  for (let step = 0; step < FORMATS.length * keywords.length && candidates.length < count; step += 1) {
    const fmt = FORMATS[(cursor + step) % FORMATS.length]
    const kw = keywords[(cursor + step * 3) % keywords.length]
    const titleTemplate = fmt.titles[(cursor + step) % fmt.titles.length]
    const title = titleTemplate
      .replace('{kw}', kw)
      .replace('{n}', String(3 + ((cursor + step) % 2)))
    if (recentlyUsed(title, recentTitles)) continue
    if (candidates.some((item) => normalizeTitle(item.title) === normalizeTitle(title))) continue

    const estimatedSeconds = fmt.est + ((cursor + step) % 3) * 10 - 10
    candidates.push({
      id: `T-${hashOf(title)}`,
      title,
      pitch: fmt.pitch(kw),
      format: fmt.key,
      formatLabel: fmt.label,
      keyword: kw,
      hook: HOOKS[(cursor + step) % HOOKS.length],
      outline: fmt.outline.slice(),
      tags: Array.from(new Set([...(content.tags || []), kw])).slice(0, 6),
      estimatedSeconds,
    })
  }

  return candidates
}

export function topicForScript(source) {
  if (!source || typeof source !== 'object') return null
  const title = String(source.title || '').trim()
  if (!title) return null
  return {
    id: String(source.id || `T-${hashOf(title)}`),
    title: title.slice(0, 80),
    pitch: String(source.pitch || ''),
    format: String(source.format || 'explainer'),
    formatLabel: String(source.formatLabel || '讲清楚'),
    keyword: String(source.keyword || ''),
    hook: String(source.hook || HOOKS[0]),
    outline: Array.isArray(source.outline) && source.outline.length > 0 ? source.outline.map(String) : FORMATS[0].outline.slice(),
    tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
    estimatedSeconds: Number(source.estimatedSeconds) > 0 ? Number(source.estimatedSeconds) : 90,
  }
}