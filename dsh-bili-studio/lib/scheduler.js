// 节奏调度：一次只挂一个定时器，到窗口边界才醒来；不轮询、不补跑。
export function startScheduler({ studio, log = () => {} }) {
  let timer = null
  let stopped = false
  let running = false

  function schedule(delay) {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, Math.max(1000, delay))
    if (typeof timer.unref === 'function') timer.unref()
  }

  async function run() {
    if (stopped) return
    if (running) {
      schedule(60000)
      return
    }
    running = true
    try {
      const result = await studio.tickScheduled()
      if (result.ran) log(`窗口内已自动出片：${result.itemId}（${result.status}）`)
    } catch (error) {
      log(`调度出错：${error && error.message ? error.message : error}`)
    } finally {
      running = false
    }
    if (!stopped) schedule(studio.nextWakeMs())
  }

  // 启动后一分钟做第一次检查（不立刻跑，避免和宿主启动抢资源）
  schedule(60000)

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }
}