// 两个 HTTP 面：
//   1) 浏览器设置页要的 /dsh-bili-studio/api/*（挂宿主 webServer，同源）
//   2) SurfCore / 其它本地进程要的 127.0.0.1:随机端口 + 一次性 token（写进 studio-api.json）
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { maskSecrets } from './log.js'

const PREFIX = '/dsh-bili-studio/api'

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendFile(res, file, contentType) {
  if (!file || !existsSync(file)) {
    sendJson(res, 404, { ok: false, error: '文件不存在' })
    return
  }
  try {
    const stat = statSync(file)
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': stat.size,
      'cache-control': 'no-store',
    })
    res.end(readFileSync(file))
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error) })
  }
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
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

function findItemMedia(studio, itemId, kind) {
  const queue = studio.loadQueue()
  const item = queue.items.find((row) => row.id === itemId)
  if (!item) return null
  if (kind === 'cover') return item.cover?.path || null
  if (kind === 'video') return item.video?.path || null
  return null
}

export function registerWebRoutes(webServer, { studio, gateway, localApi }) {
  const disposers = []

  disposers.push(
    webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url || PREFIX, 'http://127.0.0.1')
        const path = url.pathname.slice(PREFIX.length) || '/'
        try {
          if (req.method === 'GET' && path === '/state') return sendJson(res, 200, await gateway('status'))
          if (req.method === 'GET' && path === '/settings') return sendJson(res, 200, studio.getSettings())
          if (req.method === 'POST' && path === '/settings') {
            const payload = JSON.parse((await readBody(req)) || '{}')
            return sendJson(res, 200, studio.setSettings(payload.settings || payload))
          }
          if (req.method === 'GET' && path === '/qr.png') {
            const status = await studio.loginStatus()
            const qrFile = status?.qrFile || join(studio.paths.dataDir, 'login-qr.png')
            return sendFile(res, qrFile, 'image/png')
          }
          if (req.method === 'GET' && path === '/cover') {
            const itemId = url.searchParams.get('itemId') || ''
            return sendFile(res, findItemMedia(studio, itemId, 'cover'), 'image/png')
          }
          if (req.method === 'POST' && path === '/call') {
            const payload = JSON.parse((await readBody(req)) || '{}')
            const result = await gateway(payload.tool, payload.args || {})
            return sendJson(res, 200, result)
          }
          return sendJson(res, 404, { ok: false, error: `未知路径 ${path}` })
        } catch (error) {
          return sendJson(res, 400, { ok: false, error: maskSecrets(String(error && error.message ? error.message : error)) })
        }
      },
    }),
  )

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 卸载时忽略
      }
    }
  }
}

export function createLocalApi({ studio, gateway, log = () => {} }) {
  const token = randomBytes(24).toString('hex')
  let server = null
  let port = 0
  const file = join(studio.paths.dataDir, 'studio-api.json')

  function authorized(req) {
    const header = String(req.headers.authorization || '')
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    const direct = String(req.headers['x-studio-token'] || '')
    const query = (() => {
      try {
        return new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('token') || ''
      } catch {
        return ''
      }
    })()
    return [bearer, direct, query].some((value) => value && value === token)
  }

  function loopbackOnly(req) {
    const address = req.socket.remoteAddress || ''
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  }

  async function handle(req, res) {
    if (!loopbackOnly(req)) return sendJson(res, 403, { ok: false, error: '只接受本机回环访问' })
    if (!authorized(req)) return sendJson(res, 401, { ok: false, error: '缺少或错误的 studio token（见 studio-api.json）' })
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname
    try {
      if (req.method === 'GET' && path === '/studio/state') return sendJson(res, 200, await gateway('status'))
      if (req.method === 'GET' && path === '/studio/qr.png') {
        const status = await studio.loginStatus()
        return sendFile(res, status?.qrFile || join(studio.paths.dataDir, 'login-qr.png'), 'image/png')
      }
      if (req.method === 'POST' && path === '/studio/call') {
        const payload = JSON.parse((await readBody(req)) || '{}')
        return sendJson(res, 200, await gateway(payload.tool, payload.args || {}))
      }
      if (req.method === 'GET' && path === '/studio/tools') {
        return sendJson(res, 200, {
          ok: true,
          tools: ['topic', 'script', 'build', 'review', 'approve', 'publish', 'status', 'cancel', 'skip', 'retitle', 'settings.get', 'settings.set', 'login.status', 'login.qr', 'login.poll', 'login.logout', 'tick'],
        })
      }
      return sendJson(res, 404, { ok: false, error: `未知路径 ${path}` })
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: maskSecrets(String(error && error.message ? error.message : error)) })
    }
  }

  return {
    get info() {
      return { port, url: port ? `http://127.0.0.1:${port}` : '', startedAt: server ? new Date().toISOString() : '' }
    },
    get token() {
      return token
    },
    start() {
      if (server) return Promise.resolve()
      return new Promise((resolve, reject) => {
        server = createServer((req, res) => {
          handle(req, res).catch((error) => sendJson(res, 500, { ok: false, error: String(error) }))
        })
        server.on('error', reject)
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port
          const payload = {
            port,
            token,
            url: `http://127.0.0.1:${port}`,
            endpoints: {
              state: 'GET /studio/state',
              call: 'POST /studio/call  body: {"tool": "...", "args": {...}}',
              qr: 'GET /studio/qr.png',
              tools: 'GET /studio/tools',
            },
            pid: process.pid,
            startedAt: new Date().toISOString(),
          }
          studio.store.writeJson('api', payload, { restrict: true })
          log(`本地接口已就绪：http://127.0.0.1:${port}（token 见 studio-api.json）`)
          resolve()
        })
      })
    },
    stop() {
      return new Promise((resolve) => {
        if (!server) return resolve()
        server.close(() => {
          server = null
          port = 0
          resolve()
        })
      })
    },
  }
}