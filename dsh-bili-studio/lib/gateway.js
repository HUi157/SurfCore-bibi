// 唯一的动作入口：对话工具、设置页 HTTP、SurfCore 本地接口都走这里，
// 保证「有没有令牌才能发」这条规则只有一个实现。
export function createGateway(studio) {
  const actions = {
    topic: (args) => studio.topics(args),
    script: (args) => studio.script(args),
    build: (args) => studio.build(args),
    review: (args) => studio.review(args),
    approve: (args) => studio.issueToken(args),
    publish: (args) => studio.publish(args),
    status: (args) => studio.status({ withLogin: args?.withLogin !== false }),
    cancel: (args) => studio.cancel(args),
    skip: (args) => studio.skip(args),
    retitle: (args) => studio.updateTitle(args),
    'settings.get': () => studio.getSettings(),
    'settings.set': (args) => studio.setSettings(args?.settings || args || {}),
    'login.status': (args) => studio.loginStatus({ force: args?.force === true }),
    'login.qr': () => studio.loginStart(),
    'login.poll': () => studio.loginPoll(),
    'login.logout': () => studio.logout(),
    tick: () => studio.tickScheduled(),
  }

  return async function call(tool, args = {}) {
    const handler = actions[tool]
    if (!handler) {
      return { ok: false, error: `未知动作 ${tool}`, known: Object.keys(actions) }
    }
    try {
      const value = await handler(args || {})
      return value && typeof value === 'object' ? value : { ok: true, value }
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) }
    }
  }
}