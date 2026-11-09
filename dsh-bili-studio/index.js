// dsh-bili-studio —— 宿主半边。
//
// 注册的东西：
//   studio_topic / studio_script / studio_build / studio_review / studio_approve
//   studio_publish / studio_status / studio_cancel        8 个工具（发布必须带一次性令牌）
//   浏览器设置页的 /dsh-bili-studio/api/*
//   给 SurfCore 用的 127.0.0.1:随机端口 + token（studio-api.json）
//   节奏调度：单个定时器，到窗口边界才醒来
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createStudio } from './lib/studio.js'
import { createGateway } from './lib/gateway.js'
import { registerWebRoutes, createLocalApi } from './lib/http.js'
import { startScheduler } from './lib/scheduler.js'

export const name = 'dsh-bili-studio'
// webServer 必须是硬依赖：用 ctx.get('webServer') 在 apply 里取，取到 undefined 就永远不注册路由，
// 设置页会一路 405（浏览器 POST 落到 SPA 静态兜底，那个只接 GET/HEAD）。
export const inject = ['tools', 'webServer']

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function makeTool(gateway, definition) {
  return defineTool({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters || {},
    output: OUTPUT,
    async execute(args) {
      return gateway(definition.action, args || {})
    },
  })
}

export function apply(ctx) {
  const studio = createStudio({ ctx })
  const gateway = createGateway(studio)

  ctx.effect(() => () => studio.dispose())

  const tools = [
    {
      name: 'studio_topic',
      action: 'topic',
      description:
        '生成 3 个 B 站选题候选（每个带一句话卖点、内容形态、预估时长、建议标签）。不落盘、不投稿，只给候选；' +
        '关键词可以不传（用设置里的默认关键词），会给 keyword 就围绕它出。选好之后用 studio_script 写成脚本。',
      parameters: {
        keyword: { type: 'string', description: '可选：围绕这个词出选题，例如「大模型」' },
      },
    },
    {
      name: 'studio_script',
      action: 'script',
      description:
        '按选题写脚本 + 分镜表，落成 video_maker 兼容的 project.json（含封面配置），并把它排进队列（待制作）。' +
        'topic 传 studio_topic 返回的某个候选对象；不传就自动取当前第一候选。targetSeconds 可以指定目标时长（做 10 秒测试片传 10）。',
      parameters: {
        topic: { type: 'object', additionalProperties: true, description: '选题对象（来自 studio_topic.candidates[i]）' },
        keyword: { type: 'string', description: '没传 topic 时用来现挑一个选题' },
        targetSeconds: { type: 'number', description: '目标时长（秒）；不传按选题预估时长' },
      },
    },
    {
      name: 'studio_build',
      action: 'build',
      description:
        '调 tts_edge.py 配音 + edit.py 出片（不重写剪辑逻辑），返回成片 / 封面 / SRT 路径、时长、体积。' +
        '成功后队列状态变成 pending_review（待审），不会自动发布。配音失败会降级出无声版并在 voiceNote 里说明。',
      parameters: {
        itemId: { type: 'string', description: '队列条目 id（studio_script 返回的 itemId）' },
        voice: { type: 'boolean', description: '是否配音，默认 true；断网时可传 false' },
      },
    },
    {
      name: 'studio_review',
      action: 'review',
      description:
        '打包审批材料：标题 / 简介 / 标签 / 分区 / 封面（含 1920x1080 校验）/ 成片（路径 + 时长 + 体积）/ ' +
        '时长轴 / 发布建议 / 投稿前检查清单。这个工具不发令牌，也不投稿。',
      parameters: {
        itemId: { type: 'string', description: '队列条目 id' },
      },
    },
    {
      name: 'studio_approve',
      action: 'approve',
      description:
        '签发一次性投稿令牌（30 分钟、用后作废）。只能在用户明确同意之后调用：quote 必须是用户的原话，' +
        '里面要有「同意 / 按此发布 / 可以发」这类明确表述。用户没说同意就不要调这个工具。',
      parameters: {
        itemId: { type: 'string', description: '要批准发布的条目 id' },
        quote: { type: 'string', description: '用户明确同意的原话（例如「同意，按此发布」）' },
        source: { type: 'string', description: '来源：chat（默认）或 ui' },
      },
    },
    {
      name: 'studio_publish',
      action: 'publish',
      description:
        '真正投稿到 B 站。没有 confirm_token 会被直接拒绝（这是硬闸门，设置里也关不掉）。' +
        '投稿前会校验：视频存在、时长、封面 1920x1080、标题 ≤80 字、简介 ≤2000 字、标签 ≥1。' +
        '上传超时 10 分钟、最多重试 3 次、支持断点续传日志；登录态失效（-101）会提示重新扫码且不重试。',
      parameters: {
        itemId: { type: 'string', description: '队列条目 id' },
        confirmToken: { type: 'string', description: 'studio_approve 签发的一次性令牌' },
        cleanup: { type: 'string', enum: ['none', 'delete'], description: '投稿成功后是否立即删除（验收用 delete）' },
        dryRun: { type: 'boolean', description: 'true 只做校验、不消耗令牌、不上传' },
      },
    },
    {
      name: 'studio_status',
      action: 'status',
      description:
        '队列与历史：待制作 / 待审 / 已发布 / 失败各有多少、本周额度还剩几条、下一个时段、漏掉的窗口、登录态、最近历史。',
      parameters: {},
    },
    {
      name: 'studio_cancel',
      action: 'cancel',
      description: '取消一条排期或一条待发（已发布/发布中的不能取消）。reason 会记进队列。',
      parameters: {
        itemId: { type: 'string', description: '队列条目 id' },
        reason: { type: 'string', description: '取消原因（可选）' },
      },
    },
  ]

  for (const definition of tools) {
    ctx.effect(() => ctx.tools.register(makeTool(gateway, definition)))
  }

  // 浏览器设置页
  ctx.effect(() => {
    const dispose = registerWebRoutes(ctx.webServer, { studio, gateway })
    studio.logEvent('web-route', { path: '/dsh-bili-studio/api', ok: true })
    return () => {
      studio.logEvent('web-route', { path: '/dsh-bili-studio/api', ok: false, reason: 'disposed' })
      dispose()
    }
  })

  // 本地面（SurfCore）
  const localApi = createLocalApi({ studio, gateway })
  ctx.effect(() => {
    let stopped = false
    localApi.start().catch((error) => {
      studio.logEvent('local-api-failed', { reason: String(error) })
    })
    return () => {
      if (stopped) return
      stopped = true
      localApi.stop().catch(() => {})
    }
  })

  // 节奏调度
  ctx.effect(() =>
    startScheduler({
      studio,
      log: (message) => studio.logEvent('scheduler', { message }),
    }),
  )
}