// dsh-bili-studio —— 浏览器半边（右侧栏「B 站工作室」）。
// 纯 React.createElement，不引任何宿主内部包；样式只用 --dsw-alias-* token。
window.__ModuleLoader__.load({
  id: 'dsh-bili-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const API = '/dsh-bili-studio/api'
    const TAB_ID = 'bili-studio'

    async function call(tool, args) {
      const resp = await fetch(API + '/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool, args: args || {} }),
      })
      const text = await resp.text()
      if (!resp.ok) {
        const hint = resp.status === 405 ? '（后端路由没注册：重启一次 DSH 让插件重新 apply）' : ''
        throw new Error(`HTTP ${resp.status}${hint} ${text.slice(0, 120)}`)
      }
      try {
        return JSON.parse(text)
      } catch {
        throw new Error('返回不是 JSON：' + text.slice(0, 120))
      }
    }

    const CSS = `
      .bs-root { display:flex; flex-direction:column; height:100%; min-height:0; color:var(--dsw-alias-label-primary); }
      .bs-tabs { display:flex; gap:4px; padding:8px 10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
      .bs-tab { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px;
        padding:6px 10px; border-radius:8px 8px 0 0; cursor:pointer; }
      .bs-tab[data-active="true"] { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); font-weight:600; }
      .bs-body { flex:1; min-height:0; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:12px; }
      .bs-card { background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:10px; padding:10px 12px; }
      .bs-card h3 { margin:0 0 8px; font-size:13px; font-weight:600; }
      .bs-row { display:flex; align-items:center; gap:8px; margin:6px 0; flex-wrap:wrap; }
      .bs-row label { font-size:12px; color:var(--dsw-alias-label-secondary); min-width:88px; }
      .bs-input, .bs-select, .bs-textarea { flex:1; min-width:80px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary);
        border:1px solid var(--dsw-alias-border-l1); border-radius:7px; padding:5px 8px; font:inherit; font-size:12px; }
      .bs-textarea { min-height:64px; resize:vertical; width:100%; }
      .bs-btn { appearance:none; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2);
        color:var(--dsw-alias-label-primary); border-radius:7px; padding:5px 10px; font:inherit; font-size:12px; cursor:pointer; }
      .bs-btn:hover { border-color:var(--dsw-alias-brand-primary); }
      .bs-btn[data-kind="primary"] { background:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary); color:#fff; }
      .bs-btn[data-kind="danger"] { color:var(--dsw-alias-state-error-primary); }
      .bs-btn:disabled { opacity:.5; cursor:not-allowed; }
      .bs-muted { color:var(--dsw-alias-label-tertiary); font-size:11px; }
      .bs-error { color:var(--dsw-alias-state-error-primary); font-size:12px; }
      .bs-ok { color:var(--dsw-alias-state-success-primary); font-size:12px; }
      .bs-cols { display:flex; flex-direction:column; gap:12px; }
      .bs-col-title { font-size:12px; font-weight:600; margin:0 0 6px; color:var(--dsw-alias-label-secondary); }
      .bs-item { border:1px solid var(--dsw-alias-border-l1); border-radius:9px; padding:8px; margin-bottom:8px; background:var(--dsw-alias-bg-base); }
      .bs-item-head { display:flex; justify-content:space-between; gap:8px; align-items:flex-start; }
      .bs-item-title { font-size:12.5px; font-weight:600; line-height:1.35; }
      .bs-cover { width:100%; aspect-ratio:16/9; object-fit:cover; border-radius:7px; border:1px solid var(--dsw-alias-border-l1); margin:6px 0; background:var(--dsw-alias-bg-layer-2); }
      .bs-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
      .bs-chip { font-size:10.5px; padding:1px 6px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-tertiary); }
      .bs-qr { width:200px; height:200px; object-fit:contain; background:#fff; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); }
      .bs-toast { position:sticky; bottom:0; font-size:12px; padding:6px 10px; border-radius:8px;
        background:var(--dsw-alias-bg-overlay); border:1px solid var(--dsw-alias-border-l1); }
      .bs-warn { color:var(--dsw-alias-state-warn-primary); font-size:11.5px; }
    `

    function Field(props) {
      return h('div', { className: 'bs-row' }, h('label', null, props.label), props.children)
    }

    function Toast(props) {
      if (!props.text) return null
      return h('div', { className: props.kind === 'error' ? 'bs-toast bs-error' : 'bs-toast' }, props.text)
    }

    function WindowEditor(props) {
      const windows = props.windows || []
      const update = (index, key, value) => {
        const next = windows.map((win, i) => (i === index ? { ...win, [key]: value } : win))
        props.onChange(next)
      }
      return h(
        'div',
        null,
        windows.map((win, index) =>
          h(
            'div',
            { className: 'bs-row', key: index },
            h('input', {
              className: 'bs-input',
              style: { maxWidth: 86 },
              value: win.start,
              onChange: (event) => update(index, 'start', event.target.value),
              placeholder: '19:00',
            }),
            h('span', { className: 'bs-muted' }, '–'),
            h('input', {
              className: 'bs-input',
              style: { maxWidth: 86 },
              value: win.end,
              onChange: (event) => update(index, 'end', event.target.value),
              placeholder: '23:30',
            }),
            h(
              'button',
              {
                className: 'bs-btn',
                onClick: () => props.onChange(windows.filter((_, i) => i !== index)),
                disabled: windows.length <= 1,
              },
              '删除',
            ),
          ),
        ),
        h(
          'button',
          { className: 'bs-btn', onClick: () => props.onChange([...windows, { start: '19:00', end: '21:00' }]) },
          '+ 加一个时段',
        ),
      )
    }

    function ScheduleTab(props) {
      const settings = props.settings
      const [draft, setDraft] = useState(settings.schedule)
      useEffect(() => setDraft(settings.schedule), [settings])
      const dirty = JSON.stringify(draft) !== JSON.stringify(settings.schedule)
      return h(
        'div',
        { className: 'bs-card' },
        h('h3', null, '节奏'),
        h(
          Field,
          { label: '每周发布几条' },
          h('input', {
            className: 'bs-input',
            type: 'number',
            min: 0,
            max: 14,
            value: draft.perWeek,
            onChange: (event) => setDraft({ ...draft, perWeek: Number(event.target.value) }),
          }),
        ),
        h(Field, { label: '允许制作时段' }, h(WindowEditor, { windows: draft.windows, onChange: (windows) => setDraft({ ...draft, windows }) })),
        h(
          Field,
          { label: '时区' },
          h('input', {
            className: 'bs-input',
            value: draft.timezone,
            onChange: (event) => setDraft({ ...draft, timezone: event.target.value }),
          }),
        ),
        h(
          Field,
          { label: '自动制作' },
          h(
            'label',
            { className: 'bs-muted' },
            h('input', {
              type: 'checkbox',
              checked: draft.enabled !== false,
              onChange: (event) => setDraft({ ...draft, enabled: event.target.checked }),
            }),
            ' 到点自动做一条，停在待审（不会自动发）',
          ),
        ),
        h(
          'div',
          { className: 'bs-row' },
          h(
            'button',
            {
              className: 'bs-btn',
              'data-kind': 'primary',
              disabled: !dirty || props.busy,
              onClick: () => props.onSave({ schedule: draft }),
            },
            '保存',
          ),
          h('span', { className: 'bs-muted' }, dirty ? '有未保存的改动' : '已保存'),
        ),
      )
    }

    function ContentTab(props) {
      const settings = props.settings
      const [draft, setDraft] = useState(settings.content)
      useEffect(() => setDraft(settings.content), [settings])
      const dirty = JSON.stringify(draft) !== JSON.stringify(settings.content)
      return h(
        'div',
        { className: 'bs-card' },
        h('h3', null, '内容'),
        h(
          Field,
          { label: '默认分区' },
          h(
            'select',
            {
              className: 'bs-select',
              value: String(draft.tid),
              onChange: (event) => setDraft({ ...draft, tid: Number(event.target.value) }),
            },
            Object.entries(props.tids).map(([tid, label]) => h('option', { key: tid, value: tid }, `${tid} · ${label}`)),
          ),
        ),
        h(
          Field,
          { label: '默认标签' },
          h('input', {
            className: 'bs-input',
            value: (draft.tags || []).join(','),
            onChange: (event) => setDraft({ ...draft, tags: event.target.value.split(',').map((t) => t.trim()).filter(Boolean) }),
            placeholder: 'AI,科普,自制',
          }),
        ),
        h(
          Field,
          { label: '封面配色' },
          h(
            'select',
            {
              className: 'bs-select',
              value: draft.coverStyle,
              onChange: (event) => setDraft({ ...draft, coverStyle: event.target.value }),
            },
            Object.entries(props.coverStyles).map(([key, value]) => h('option', { key, value: key }, value.label)),
          ),
        ),
        h(Field, { label: '默认关键词' }, h('input', {
          className: 'bs-input',
          value: (draft.keywords || []).join(','),
          onChange: (event) => setDraft({ ...draft, keywords: event.target.value.split(',').map((t) => t.trim()).filter(Boolean) }),
        })),
        h('div', { className: 'bs-row' }, h('label', null, '简介模板')),
        h('textarea', {
          className: 'bs-textarea',
          value: draft.descTemplate,
          onChange: (event) => setDraft({ ...draft, descTemplate: event.target.value }),
        }),
        h('div', { className: 'bs-muted' }, '可用占位：{title} {summary} {tagsLine} {tags}'),
        h(
          'div',
          { className: 'bs-row' },
          h(
            'button',
            {
              className: 'bs-btn',
              'data-kind': 'primary',
              disabled: !dirty || props.busy,
              onClick: () => props.onSave({ content: draft }),
            },
            '保存',
          ),
          h('span', { className: 'bs-muted' }, dirty ? '有未保存的改动' : '已保存'),
        ),
      )
    }

    function AccountTab(props) {
      const login = props.login || {}
      const [qrTick, setQrTick] = useState(0)
      const [polling, setPolling] = useState(false)
      const [message, setMessage] = useState('')

      useEffect(() => {
        if (!polling) return undefined
        let alive = true
        const timer = setInterval(async () => {
          try {
            const result = await call('login.poll')
            if (!alive) return
            if (result.state === 'done') {
              setPolling(false)
              setMessage('登录成功，凭证已保存')
              props.onRefresh()
            } else if (result.state === 'timeout') {
              setPolling(false)
              setMessage('二维码过期了，重新点一次「扫码登录」')
            } else {
              setMessage(result.message || '等待扫码…')
            }
          } catch (error) {
            setMessage('轮询失败：' + String(error.message || error))
          }
        }, 2500)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [polling])

      const startScan = async () => {
        setMessage('正在生成二维码…')
        const result = await props.onCall('login.qr', {})
        if (!result.ok) {
          setMessage(result.error || '生成二维码失败')
          return
        }
        setQrTick(Date.now())
        setPolling(true)
        setMessage('用 B 站 App 扫码，然后手机上确认')
      }

      return h(
        'div',
        { className: 'bs-card' },
        h('h3', null, '账号'),
        h(
          'div',
          { className: 'bs-row' },
          h('span', { className: login.loggedIn ? 'bs-ok' : 'bs-warn' }, login.loggedIn ? `已登录：${login.uname || login.mid || 'B 站账号'}` : login.expired ? '登录态失效，请重新扫码' : '未登录'),
        ),
        login.reason ? h('div', { className: 'bs-muted' }, login.reason) : null,
        h(
          'div',
          { className: 'bs-row' },
          h('button', { className: 'bs-btn', 'data-kind': 'primary', onClick: startScan }, '扫码登录'),
          h(
            'button',
            {
              className: 'bs-btn',
              'data-kind': 'danger',
              onClick: async () => {
                await props.onCall('login.logout', {})
                props.onRefresh()
              },
            },
            '退出登录',
          ),
          h('button', { className: 'bs-btn', onClick: props.onRefresh }, '刷新状态'),
        ),
        qrTick ? h('img', { className: 'bs-qr', src: API + '/qr.png?t=' + qrTick, alt: 'B 站登录二维码' }) : null,
        message ? h('div', { className: 'bs-muted' }, message) : null,
      )
    }

    function ItemCard(props) {
      const item = props.item
      const [editing, setEditing] = useState(false)
      const [title, setTitle] = useState(item.title || '')
      const [token, setToken] = useState('')
      const [busy, setBusy] = useState(false)

      const run = async (fn) => {
        setBusy(true)
        try {
          await fn()
        } finally {
          setBusy(false)
        }
      }

      const approve = () =>
        run(async () => {
          const result = await props.onCall('approve', { itemId: item.id, source: 'ui' })
          if (!result.ok) {
            props.onToast(result.error || '审批失败', 'error')
            return
          }
          setToken(result.confirmToken)
          props.onToast('已签一次性令牌（30 分钟）。再点一次「确认上传」才真的投。')
        })

      const publish = () =>
        run(async () => {
          const result = await props.onCall('publish', { itemId: item.id, confirmToken: token })
          if (result.ok) {
            props.onToast('已发布：' + (result.bvid || '') + (result.url ? ' ' + result.url : ''))
            setToken('')
          } else {
            props.onToast(result.error || '发布失败', 'error')
          }
          props.onRefresh()
        })

      return h(
        'div',
        { className: 'bs-item' },
        h(
          'div',
          { className: 'bs-item-head' },
          editing
            ? h('input', {
                className: 'bs-input',
                value: title,
                onChange: (event) => setTitle(event.target.value),
                onBlur: async () => {
                  await props.onCall('retitle', { itemId: item.id, title })
                  setEditing(false)
                  props.onRefresh()
                },
              })
            : h('div', { className: 'bs-item-title' }, item.title || '(无标题)'),
          h('span', { className: 'bs-chip' }, item.id),
        ),
        item.cover
          ? h('img', { className: 'bs-cover', src: API + '/cover?itemId=' + encodeURIComponent(item.id) + '&t=' + Date.now(), alt: '封面' })
          : null,
        h(
          'div',
          { className: 'bs-muted' },
          [
            item.video ? `${item.video.duration}s` : '未出片',
            item.cover ? `${item.cover.width}x${item.cover.height}` : '',
            item.bvid || '',
            'tid ' + (item.tid || ''),
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        h(
          'div',
          { className: 'bs-actions' },
          item.status === 'planned'
            ? h('button', { className: 'bs-btn', 'data-kind': 'primary', disabled: busy, onClick: () => run(async () => {
                props.onToast('开始出片…')
                const result = await props.onCall('build', { itemId: item.id })
                props.onToast(result.ok ? `出片完成：${result.durationSeconds}s` : result.error || '出片失败', result.ok ? 'ok' : 'error')
                props.onRefresh()
              }) }, '现在做')
            : null,
          item.status === 'planned'
            ? h('button', { className: 'bs-btn', disabled: busy, onClick: () => run(async () => {
                await props.onCall('skip', { itemId: item.id })
                props.onRefresh()
              }) }, '跳过')
            : null,
          item.status === 'pending_review'
            ? h('button', { className: 'bs-btn', disabled: busy, onClick: approve }, '同意发布')
            : null,
          item.status === 'pending_review' && token
            ? h('button', { className: 'bs-btn', 'data-kind': 'primary', disabled: busy, onClick: publish }, '确认上传')
            : null,
          item.status === 'pending_review'
            ? h('button', { className: 'bs-btn', onClick: () => setEditing(true) }, '改标题')
            : null,
          item.status === 'pending_review'
            ? h('button', { className: 'bs-btn', 'data-kind': 'danger', disabled: busy, onClick: () => run(async () => {
                await props.onCall('skip', { itemId: item.id })
                props.onRefresh()
              }) }, '跳过')
            : null,
        ),
      )
    }

    function QueueTab(props) {
      const status = props.status || {}
      const groups = [
        ['待制作', status.planned || []],
        ['待审', status.pendingReview || []],
        ['已发布', status.published || []],
      ]
      return h(
        'div',
        { className: 'bs-cols' },
        groups.map(([label, items]) =>
          h(
            'div',
            { key: label },
            h('div', { className: 'bs-col-title' }, `${label} · ${items.length}`),
            items.length === 0
              ? h('div', { className: 'bs-muted', style: { marginBottom: 8 } }, label === '待审' ? '还没有待审的片子' : '空')
              : items.map((item) => h(ItemCard, { key: item.id, item, onCall: props.onCall, onToast: props.onToast, onRefresh: props.onRefresh })),
          ),
        ),
        (status.failed || []).length > 0
          ? h('div', null, h('div', { className: 'bs-col-title' }, `失败 · ${status.failed.length}`), status.failed.map((item) => h(ItemCard, { key: item.id, item, onCall: props.onCall, onToast: props.onToast, onRefresh: props.onRefresh })))
          : null,
        h(
          'div',
          { className: 'bs-muted' },
          `本周额度 ${status.quota ? `${status.quota.built}/${status.quota.perWeek}，还剩 ${status.quota.remaining}` : '-'} · 下一个时段 ${status.nextWindow || '-'}`,
        ),
        (status.missed || []).length > 0
          ? h('div', { className: 'bs-warn' }, `漏掉的窗口 ${status.missed.length} 个（不补跑）：${status.missed.slice(-2).map((row) => row.window).join(' / ')}`)
          : null,
      )
    }

    function StudioPanel() {
      const [view, setView] = useState('queue')
      const [status, setStatus] = useState({})
      const [settings, setSettings] = useState(null)
      const [coverStyles, setCoverStyles] = useState({})
      const [tids, setTids] = useState({})
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState({ text: '', kind: 'ok' })

      const refresh = useCallback(async () => {
        try {
          const next = await call('status')
          const conf = await call('settings.get')
          setStatus(next)
          setSettings(conf.settings)
          setCoverStyles(conf.coverStyles || {})
          setTids(conf.tids || {})
        } catch (error) {
          setToast({ text: '读取失败：' + String(error.message || error), kind: 'error' })
        }
      }, [])

      useEffect(() => {
        refresh()
        const timer = setInterval(refresh, 8000)
        return () => clearInterval(timer)
      }, [refresh])

      const onCall = useCallback(
        async (tool, args) => {
          try {
            return await call(tool, args)
          } catch (error) {
            return { ok: false, error: String(error.message || error) }
          }
        },
        [],
      )

      const onToast = useCallback((text, kind) => setToast({ text, kind: kind || 'ok' }), [])

      const saveSettings = async (patch) => {
        setBusy(true)
        const result = await onCall('settings.set', patch)
        setBusy(false)
        if (result.ok) {
          onToast('已保存')
          refresh()
        } else {
          onToast((result.errors || []).join('；') || '保存失败', 'error')
        }
      }

      const tabs = [
        ['queue', '队列'],
        ['schedule', '节奏'],
        ['content', '内容'],
        ['account', '账号'],
      ]

      return h(
        'div',
        { className: 'bs-root' },
        h(
          'div',
          { className: 'bs-tabs' },
          tabs.map(([key, label]) =>
            h('button', { key, className: 'bs-tab', 'data-active': view === key, onClick: () => setView(key) }, label),
          ),
        ),
        h(
          'div',
          { className: 'bs-body' },
          !settings
            ? h('div', { className: 'bs-muted' }, '加载中…')
            : view === 'schedule'
              ? h(ScheduleTab, { settings, busy, onSave: saveSettings })
              : view === 'content'
                ? h(ContentTab, { settings, busy, onSave: saveSettings, coverStyles, tids })
                : view === 'account'
                  ? h(AccountTab, { login: status.login, onCall, onRefresh: refresh })
                  : h(QueueTab, { status, onCall, onToast, onRefresh: refresh }),
          h(Toast, toast),
        ),
      )
    }

    function StudioTitle() {
      return h('span', null, '🎬 B 站工作室')
    }

    function apply(ctx) {
      const style = document.createElement('style')
      style.setAttribute('data-plugin', 'dsh-bili-studio')
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => {
        if (style.parentNode !== null) style.parentNode.removeChild(style)
      })

      ctx.effect(() =>
        ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_ID,
          title: () => 'B 站工作室',
          guide: [
            {
              order: 40,
              title: () => 'B 站工作室',
              description: () => '选题、出片、审批、投稿；节奏到点自动做',
            },
          ],
        }),
      )

      ctx.effect(() =>
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, StudioPanel)),
      )
      ctx.effect(() =>
        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, StudioTitle)),
      )
      // 不在 `sidebar.right.tab.guide.entry` 上注册自定义卡片：
      // 那个槽位只给「卡片内容」，点卡开页的动作由引导页自己的标准卡片负责；
      // 换成自己的 div 会让卡片变成点不动的死块。标题与描述由上面的 guide 数组提供。
    }

    return { inject: ['slots', 'sidebarRightTabs'], apply }
  },
})