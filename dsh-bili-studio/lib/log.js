// 日志与回显的唯一出入口：任何要写盘、返回给模型或进事件流的字符串都先过这里。
// 规则：凭证字段整体替换；形如 SESSDATA=xxx / bili_jct=xxx 的片段只留键名。
const SECRET_FIELD = /^(sessdata|sessData|bili_jct|biliJct|buvid3|dedeuserid|csrf|access_key|refresh_token|token)$/i

const INLINE_SECRET =
  /((?:SESSDATA|sessdata|bili_jct|biliJct|buvid3|dedeuserid|csrf|access_key|refresh_token)\s*[=:]\s*)("?)([^"'&\s;,}]+)\2/g

export function maskSecrets(value) {
  if (typeof value !== 'string') return value
  let out = value.replace(INLINE_SECRET, (_m, head, quote) => `${head}${quote}***${quote}`)
  // Cookie 头里的整段 SESSDATA 值
  out = out.replace(/(SESSDATA=)[^;,\s]+/g, '$1***')
  return out
}

export function maskDeep(value, depth = 0) {
  if (depth > 8) return '[deep]'
  if (typeof value === 'string') return maskSecrets(value)
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, raw] of Object.entries(value)) {
      out[key] = SECRET_FIELD.test(key) ? '***' : maskDeep(raw, depth + 1)
    }
    return out
  }
  return value
}

export function maskJson(value) {
  return JSON.stringify(maskDeep(value))
}