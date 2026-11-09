/**
 * SurfCore 扩展（胶水层，只转发）。
 *
 * 挂载点来自 SurfCore 自己的扩展接口：api.registerRoute(method, path, handler)
 * → 对外是 /dsh-surfcore/ext/dsh-bili-studio/<path>（只接受本机回环）。
 *
 * 它不读、不存、不回显任何 B 站凭证：只读 plugin-data 里的 studio-api.json
 * （127.0.0.1 随机端口 + 一次性 token），把请求转给 dsh-bili-studio。
 *
 * 打开方式：把本目录整体拷到
 *   C:\Users\schui\.dsh\plugins\surfcore\extensions\dsh-bili-studio\
 * 然后在 SurfCore 设置窗口「扩展」页里打开它（manifest.enabled 默认 false）。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const API_FILE = join(homedir(), '.dsh', 'plugin-data', 'dsh-bili-studio', 'studio-api.json')

async function studioInfo() {
  const raw = await readFile(API_FILE, 'utf8')
  const info = JSON.parse(raw)
  if (!info || !info.url || !info.token) throw new Error('studio-api.json 不完整（插件没启动？）')
  return info
}

async function studioCall(tool, args) {
  const info = await studioInfo()
  const resp = await fetch(info.url + '/studio/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-studio-token': info.token },
    body: JSON.stringify({ tool, args: args || {} }),
    signal: AbortSignal.timeout(120000),
  })
  return await resp.json()
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 2 * 1024 * 1024) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function activate(api) {
  api.log('dsh-bili-studio 转发扩展已激活')

  // GET /dsh-surfcore/ext/dsh-bili-studio/state
  api.registerRoute('GET', '/state', async (req, res) => {
    try {
      const info = await studioInfo()
      const resp = await fetch(info.url + '/studio/state', {
        headers: { 'x-studio-token': info.token },
        signal: AbortSignal.timeout(30000),
      })
      json(res, 200, await resp.json())
    } catch (error) {
      json(res, 503, { ok: false, error: String(error && error.message ? error.message : error) })
    }
  })

  // POST /dsh-surfcore/ext/dsh-bili-studio/call   body: {"tool":"...","args":{...}}
  api.registerRoute('POST', '/call', async (req, res) => {
    try {
      const payload = JSON.parse((await readBody(req)) || '{}')
      json(res, 200, await studioCall(payload.tool, payload.args || {}))
    } catch (error) {
      json(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
    }
  })

  // 便捷入口：B 站侧说「做一条视频」→ 一步选题+脚本+出片（仍停在待审）
  api.registerRoute('POST', '/make-one', async (req, res) => {
    try {
      const payload = JSON.parse((await readBody(req)) || '{}')
      const picked = await studioCall('topic', { keyword: payload.keyword })
      if (!picked.ok) return json(res, 200, picked)
      const created = await studioCall('script', { topic: picked.candidates[0], targetSeconds: payload.targetSeconds })
      if (!created.ok) return json(res, 200, created)
      const built = await studioCall('build', { itemId: created.itemId })
      json(res, 200, { ok: built.ok, itemId: created.itemId, title: created.title, build: built, note: '停在待审，不会被自动发布' })
    } catch (error) {
      json(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
    }
  })

  // 便捷入口：待审清单
  api.registerRoute('GET', '/pending', async (req, res) => {
    try {
      const status = await studioCall('status', { withLogin: false })
      json(res, 200, { ok: true, pendingReview: status.pendingReview || [], counts: status.counts || {} })
    } catch (error) {
      json(res, 503, { ok: false, error: String(error && error.message ? error.message : error) })
    }
  })
}