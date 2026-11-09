// 插件自己的存储层：state.json / queue.json / history.jsonl 全在这里，
// 一律原子写（tmp + rename），凭证文件额外收紧 ACL。
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, appendFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { DATA_FILES } from './paths.js'

export function restrictFile(file) {
  try {
    chmodSync(file, 0o600)
  } catch {
    // Windows 上 chmod 只是只读位，忽略
  }
  if (process.platform === 'win32') {
    const user = process.env.USERNAME
    if (!user) return
    try {
      execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${user}:F`], {
        stdio: 'ignore',
        timeout: 10000,
        windowsHide: true,
      })
    } catch {
      // 收紧失败不影响读写；README 里写明了这是 best-effort
    }
  }
}

function readJsonRaw(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function createStore(dir) {
  mkdirSync(dir, { recursive: true })

  const pathOf = (name) => {
    const mapped = DATA_FILES[name] || name
    return join(dir, mapped)
  }

  // 同步原子写：文件很小，同步写换来的好处是「写完立刻能被另一个进程/下一次读看到」。
  function writeJson(name, value, { restrict = false } = {}) {
    const file = pathOf(name)
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, file)
    if (restrict) restrictFile(file)
  }

  function readJson(name, fallback = null) {
    return readJsonRaw(pathOf(name), fallback)
  }

  function appendLine(name, value) {
    appendFileSync(pathOf(name), JSON.stringify(value) + '\n', 'utf8')
  }

  function readLines(name) {
    const file = pathOf(name)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }

  function remove(name) {
    const file = pathOf(name)
    if (existsSync(file)) rmSync(file, { force: true })
  }

  return { dir, pathOf, writeJson, readJson, appendLine, readLines, remove, readJsonRaw, exists: (name) => existsSync(pathOf(name)) }
}