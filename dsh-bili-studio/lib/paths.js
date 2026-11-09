// 路径与环境事实集中在这里：只读常量，不写配置。
// 三个可被 plugin Config / state.json 覆盖的路径通过 resolvePaths() 计算。
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR = join(homedir(), '.dsh', 'plugin-data', 'dsh-bili-studio')

export const DEFAULT_WORKSPACE = 'D:\\deepseek\\工作区1'
export const PYTHON_DEFAULT =
  'C:\\Users\\schui\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe'
export const FFMPEG_DIR_DEFAULT = 'C:\\Users\\schui\\AppData\\Local\\Programs\\ffmpeg\\bin'

export const DATA_FILES = {
  state: 'state.json',
  queue: 'queue.json',
  history: 'history.jsonl',
  credentials: 'credentials.json',
  api: 'studio-api.json',
  loginSession: 'login-session.json',
  uploadJournal: 'upload-journal.json',
  events: 'events.jsonl',
}

export function resolvePaths(overrides = {}) {
  const workspace = overrides.workspace || DEFAULT_WORKSPACE
  return {
    dataDir: DATA_DIR,
    workspace,
    videoMaker: join(workspace, 'video_maker'),
    outRoot: join(workspace, 'video_maker', 'out'),
    python: overrides.python || PYTHON_DEFAULT,
    ffmpegDir: overrides.ffmpegDir || FFMPEG_DIR_DEFAULT,
    editScript: join(workspace, 'video_maker', 'edit.py'),
    ttsScript: join(workspace, 'video_maker', 'tts_edge.py'),
  }
}

export function dateStamp(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}