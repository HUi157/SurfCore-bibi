// 外部进程调用：统一超时、统一重试上限、统一把 stderr 压成一句话。
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { maskSecrets } from './log.js'

export const RETRY_LIMIT = 3
export const BUILD_TIMEOUT_MS = 15 * 60 * 1000
export const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000

export function runProcess(command, args, options = {}) {
  const {
    cwd,
    timeoutMs = 120000,
    env = {},
    maxBuffer = 32 * 1024 * 1024,
    input,
  } = options
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const child = execFile(
      command,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer,
        windowsHide: true,
        env: { ...process.env, ...env },
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (settled) return
        settled = true
        const timedOut = Boolean(error && (error.killed || error.signal === 'SIGTERM')) && Date.now() - started >= timeoutMs - 250
        resolve({
          ok: !error,
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          timedOut,
          stdout: maskSecrets(String(stdout || '')),
          stderr: maskSecrets(String(stderr || '')),
          ms: Date.now() - started,
          error: error ? maskSecrets(String(error.message || error)) : '',
        })
      },
    )
    if (input !== undefined && child.stdin) {
      child.stdin.end(input)
    }
  })
}

export function pathsForPython(paths) {
  const sep = ';'
  const parts = [paths.ffmpegDir, process.env.PATH || ''].filter(Boolean)
  return { ...process.env, PATH: parts.join(sep) }
}

export function ffmpegPresent(paths) {
  return existsSync(`${paths.ffmpegDir}\\ffmpeg.exe`) && existsSync(`${paths.ffmpegDir}\\ffprobe.exe`)
}

export function lastJsonLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (line.startsWith('{')) {
      try {
        return JSON.parse(line)
      } catch {
        // 继续往上找
      }
    }
  }
  return null
}

export async function withRetry(label, fn, { limit = RETRY_LIMIT, onRetry } = {}) {
  const attempts = []
  for (let i = 1; i <= limit; i += 1) {
    const result = await fn(i)
    attempts.push({ attempt: i, ok: result.ok, reason: result.ok ? '' : result.error || result.reason || '' })
    if (result.ok) return { ...result, attempts }
    if (result.fatal) return { ...result, attempts }
    if (onRetry) await onRetry(i, result)
  }
  return { ok: false, error: `${label} 连续失败 ${limit} 次`, attempts }
}