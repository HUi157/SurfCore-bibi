// B 站通道：所有 B 站动作都过 python 子进程，凭证从不进 Node 进程的可回显结构。
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProcess, lastJsonLine, UPLOAD_TIMEOUT_MS } from './runner.js'
import { maskSecrets } from './log.js'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'python', 'bili_studio.py')

export function createBili({ paths, env }) {
  async function call(command, args = [], { timeoutMs = 60000 } = {}) {
    mkdirSync(paths.dataDir, { recursive: true })
    const result = await runProcess(paths.python, [SCRIPT, command, ...args], {
      timeoutMs,
      env: { STUDIO_DATA_DIR: paths.dataDir, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...env },
    })
    const parsed = lastJsonLine(result.stdout)
    if (!parsed) {
      const reason = result.timedOut
        ? `${command} 超时（${Math.round(timeoutMs / 1000)}s）`
        : maskSecrets(result.stderr.trim().split(/\r?\n/).pop() || result.error || '没有任何输出')
      return { ok: false, error: reason, stderr: maskSecrets(result.stderr.slice(-1500)) }
    }
    return parsed
  }

  return {
    available: true,
    status: () => call('status', [], { timeoutMs: 30000 }),
    qrStart: () => call('qr-start', [], { timeoutMs: 40000 }),
    qrPoll: () => call('qr-poll', [], { timeoutMs: 40000 }),
    logout: () => call('logout', [], { timeoutMs: 20000 }),
    async upload(payload) {
      const file = join(paths.dataDir, 'upload-payload.json')
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
      try {
        return await call('upload', ['--payload', file], { timeoutMs: UPLOAD_TIMEOUT_MS })
      } finally {
        // 投稿参数（标题/简介/标签）不需要留在盘上
        try {
          rmSync(file, { force: true })
        } catch {
          // 删不掉就算了
        }
      }
    },
    deleteVideo: (bvid) => call('delete', ['--bvid', bvid], { timeoutMs: 60000 }),
  }
}