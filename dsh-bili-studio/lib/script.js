// 把选题写成 video_maker 能直接吃的 project.json。
// 离线可跑：不调任何模型，只做模板排版；配音交给 tts_edge.py。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { dateStamp } from './paths.js'
import { COVER_STYLES } from './settings.js'

function hashOf(text) {
  return createHash('sha1').update(String(text)).digest('hex').slice(0, 6)
}

export function slugFor(topic) {
  const ascii = String(topic.id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 12)
  return `${ascii || 'topic'}-${hashOf(topic.title)}`
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

const SHOT_KICKERS = ['开场', '第 1 层', '第 2 层', '第 3 层', '收尾']

function narrationsFor(topic) {
  const outline = topic.outline.length > 0 ? topic.outline : ['先给结论', '拆开看', '怎么用']
  const kw = topic.keyword || '这件事'
  const lines = []
  lines.push(`${topic.hook}`)
  lines.push(`今天要聊的题目是，${topic.title.replace(/[?？!！。，,]/g, ' ').trim()}。`)
  for (const point of outline.slice(0, 3)) {
    lines.push(`${point}。这一层先说到这里，往下走。`)
  }
  lines.push(`关于${kw}，我个人最看重的是能不能落到今天的一个动作上。`)
  lines.push('这条就到这里，觉得有用就点个关注，下条接着拆。')
  return lines
}

function shortNarrations(topic, targetSeconds = 10) {
  const lines = [
    '链路测片：选题、脚本、配音、成片，一次跑通。',
    '发布前必须人工点头，这一步插件替不了。',
  ]
  if (Number(targetSeconds) > 12) {
    lines.push('这条只验链路，内容不追求好看，位置和时长达标就算过。')
  }
  return lines
}

export function composeProject({ topic, settings, targetSeconds = null, seed = 0 }) {
  const style = COVER_STYLES[settings?.content?.coverStyle] || COVER_STYLES['deep-ocean']
  const isShortTest = Number.isFinite(targetSeconds) && targetSeconds > 0 && targetSeconds <= 20
  const target = Number.isFinite(targetSeconds) && targetSeconds > 0 ? targetSeconds : topic.estimatedSeconds || 90

  const narration = isShortTest ? shortNarrations(topic, target) : narrationsFor(topic)
  const shotCount = isShortTest ? narration.length : clamp(Math.round(target / 18) + 2, 4, 6)
  const lines = narration.slice(0, shotCount)
  while (lines.length < shotCount) lines.push(narration[narration.length - 1])

  const perShot = Math.max(2.5, Math.round((target / shotsLength(lines)) * 10) / 10)

  const shots = lines.map((line, index) => {
    const outline = topic.outline[index - 1] || topic.outline[topic.outline.length - 1] || '收个尾'
    const isLast = index === lines.length - 1
    const title = isLast
      ? '先到这，下条接着拆'
      : index === 0
        ? topic.title.slice(0, 24)
        : String(outline).replace(/[。.]$/, '').slice(0, 18)
    return {
      id: `S${index + 1}`,
      duration: perShot,
      bg: index % 2 === 0 ? style.bg : [style.bg[1], style.bg[0]],
      kicker: `${String(index + 1).padStart(2, '0')} · ${SHOT_KICKERS[Math.min(index, SHOT_KICKERS.length - 1)]}`,
      title,
      sub: index === 0 ? topic.pitch.slice(0, 40) : `${topic.formatLabel} · ${topic.keyword || '科普'}`,
      narration: line,
    }
  })

  const project = {
    width: 1920,
    height: 1080,
    fps: 30,
    out: 'film.mp4',
    tail: 0.6,
    crossfade: 0.4,
    music: null,
    voiceDir: 'voice',
    cover: {
      out: 'cover-final.png',
      bg: style.bg,
      kicker: `B 站工作室 · ${topic.formatLabel}`,
      title: coverTitleOf(topic.title),
      sub: topic.pitch.slice(0, 46),
    },
    shots,
  }

  // 实际时长 ≈ 每镜配音时长（中文按 4.8 字/秒）+ 镜尾留白；比按选题拍脑袋准得多
  const narrationSeconds = shots.reduce(
    (sum, shot) => sum + (shot.narration ? shot.narration.length / 4.8 : Number(shot.duration) || 4) + 0.6,
    0,
  )

  return {
    project,
    estimatedSeconds: Math.max(1, Math.round(narrationSeconds)),
    meta: {
      title: `${topic.title}${settings?.content?.titleSuffix || ''}`.slice(0, 80),
      summary: topic.pitch,
      tags: topic.tags.length > 0 ? topic.tags : settings?.content?.tags || ['科普'],
      tid: settings?.content?.tid || 201,
    },
  }
}

function shotsLength(lines) {
  return Math.max(1, lines.length)
}

/** 封面标题只取第一个短句，避免在 1920 宽里被折成两行还折得很难看。 */
function coverTitleOf(title) {
  const text = String(title || '')
  if (text.length <= 18) return text
  const clause = text.split(/[，,。！？!?：:]/).filter((part) => part.trim().length > 0)[0] || text
  return clause.slice(0, 18)
}

export function buildDescription({ template, title, summary, tags }) {
  const tagsLine = (tags || []).map((tag) => `#${tag}`).join(' ')
  return String(template || '{title}')
    .replace(/\{title\}/g, title || '')
    .replace(/\{summary\}/g, summary || '')
    .replace(/\{tagsLine\}/g, tagsLine)
    .replace(/\{tags\}/g, (tags || []).join('、'))
    .slice(0, 2000)
}

export function writeProject({ paths, topic, project, meta }) {
  const dir = join(paths.outRoot, dateStamp(), slugFor(topic))
  mkdirSync(dir, { recursive: true })
  const projectPath = join(dir, 'project.json')
  writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8')
  return { dir, projectPath, meta }
}