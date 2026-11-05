import { useEffect, useState } from 'react';
import type { translator } from '../shared/i18n.ts';
import { estimatedCost, summarizeUsage, type ModelPrice, type UsageData } from '../shared/usage.ts';
import { desktop } from './common.tsx';

export function UsagePanel({ t, locale }: { t: ReturnType<typeof translator>; locale: string }) {
  const [data, setData] = useState<UsageData>();
  const [range, setRange] = useState('today');
  const [source, setSource] = useState('all');
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [model, setModel] = useState('');
  const [rates, setRates] = useState({ input: '', output: '', cached: '', cacheWrite: '' });
  async function refresh() {
    try { setData(await desktop.getUsage()); setError(false); }
    catch { setError(true); }
  }
  useEffect(() => {
    let mounted = true;
    let loading = false;
    const load = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try { const value = await desktop.getUsage(); if (mounted) { setData(value); setError(false); } }
      catch { if (mounted) setError(true); }
      finally { loading = false; }
    };
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    document.addEventListener('visibilitychange', load);
    return () => { mounted = false; clearInterval(interval); document.removeEventListener('visibilitychange', load); };
  }, []);
  const number = (value: number) => value.toLocaleString(locale);
  const dollars = (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const since = range === 'today' ? midnight.getTime() : range === 'week' ? Date.now() - 7 * 86_400_000 : 0;
  const records = data?.records.filter(row => row.at >= since && (source === 'all' || row.source === source)) ?? [];
  const summary = summarizeUsage(records, data?.prices ?? []);
  const models = [...new Set([...(data?.records.map(row => row.model) ?? []), ...(data?.prices.map(row => row.model) ?? [])])].sort();
  const priceFor = (id: string) => data?.prices.find(price => price.model === id);
  function chooseModel(id: string) {
    setModel(id);
    const price = priceFor(id);
    setRates({ input: price ? String(price.input) : '', output: price ? String(price.output) : '',
      cached: price ? String(price.cached) : '', cacheWrite: price ? String(price.cacheWrite) : '' });
  }
  async function savePrice(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const price: ModelPrice = { model: model.trim(), input: Number(rates.input), output: Number(rates.output),
        cached: Number(rates.cached), cacheWrite: Number(rates.cacheWrite) };
      await desktop.setUsagePrice(price);
      await refresh();
    } catch { setError(true); }
    finally { setSaving(false); }
  }
  return <div className="usage-panel">
    <section className="setting-card">
      <h2>{t('用量概览', 'Usage overview')}</h2>
      <p className="muted">{t('此设备上猫博士和已导入的 Claude Code / Codex 请求，含所有账号。Token 来自服务或本地日志；金额是按自定义单价计算的 API 等值估算，不是订阅账单或剩余额度。',
        'Meow and imported Claude Code / Codex requests on this device, across accounts. Tokens come from the service or local logs. Costs are API-equivalent estimates using your rates, not your subscription bill or remaining quota.')}</p>
      <div className="data-buttons">
        <label>{t('时间范围', 'Period')} <select value={range} onChange={event => setRange(event.target.value)}>
          <option value="today">{t('今天', 'Today')}</option><option value="week">{t('最近 7 天', 'Last 7 days')}</option>
          <option value="all">{t('全部', 'All time')}</option>
        </select></label>
        <label>{t('来源', 'Source')} <select value={source} onChange={event => setSource(event.target.value)}>
          <option value="all">{t('全部', 'All')}</option><option value="meow">Meow</option>
          <option value="claude">Claude Code</option><option value="codex">Codex</option>
        </select></label>
        <button className="secondary" onClick={() => void refresh()}>{t('刷新', 'Refresh')}</button>
        <button className="secondary" onClick={() => desktop.openUsage()}>{t('ChatGPT 用量', 'ChatGPT usage')}</button>
      </div>
      {error && <p role="alert" className="message-error">{t('无法加载或保存用量，请重试。', 'Could not load or save usage. Try again.')}</p>}
      {!data ? <p role="status">{t('正在加载用量…', 'Loading usage…')}</p> : <>
        <dl className="usage-totals">
          <div><dt>{t('请求', 'Requests')}</dt><dd>{number(summary.requests)}</dd></div>
          <div><dt>{t('已知 Token', 'Reported tokens')}</dt><dd>{number(summary.input + summary.output)}</dd></div>
          <div><dt>{t('已定价部分估算', 'Priced portion estimate')}</dt><dd>{summary.requests - summary.unknown - summary.unpriced > 0 ? dollars(summary.cost) : '—'}</dd></div>
          <div><dt>{t('缓存命中', 'Cache hit rate')}</dt><dd>{summary.input ? `${(100 * summary.cached / summary.input).toFixed(1)}%` : '—'}</dd></div>
        </dl>
        <p className="muted">{t('输入', 'Input')}: {number(summary.input)} · {t('输出', 'Output')}: {number(summary.output)} · {t('缓存读取', 'Cache reads')}: {number(summary.cached)} · {t('缓存写入', 'Cache writes')}: {number(summary.cacheWrite)}</p>
        <p className="muted">{t('未报告 Token 的请求', 'Requests without reported tokens')}: {summary.unknown} · {t('未定价请求', 'Unpriced requests')}: {summary.unpriced}</p>
        {!records.length && <p>{t('这个时间范围内还没有请求。新对话将自动记录，不会推算旧聊天的用量。',
          'No requests in this period yet. New model requests are recorded automatically; old chats are not estimated.')}</p>}
      </>}
    </section>
    <section className="setting-card">
      <h2>{t('本地编程工具', 'Local coding tools')}</h2>
      <p className="muted">{t('扫描 Claude Code projects 和 Codex sessions 目录中的 JSONL 日志，只保存模型、时间和 Token 计数，不保存提示词或工具输出。无需代理。首次启用会导入可读取的历史记录。',
        'Scan JSONL logs in Claude Code projects and Codex sessions. Only model, time, and token counters are stored; prompts and tool output are not saved. No proxy is needed. Enabling imports readable history.')}</p>
      <label className="setting-row toggle-row"><span><strong>{t('导入本地用量', 'Import local usage')}</strong>
        <small>{t('打开此页时每分钟扫描，后台每 10 分钟扫描', 'Scan each minute while viewing usage, every 10 minutes in the background')}</small></span>
        <input type="checkbox" className="switch" checked={data?.scan.enabled ?? false} disabled={saving || !data}
          onChange={async event => {
            const enabled = event.target.checked;
            setSaving(true);
            try { await desktop.setUsageScanning(enabled); await refresh(); }
            catch { setError(true); } finally { setSaving(false); }
          }} /></label>
      <button className="secondary" disabled={saving || !data?.scan.enabled} onClick={async () => {
        setSaving(true);
        try { await desktop.syncUsage(); await refresh(); }
        catch { setError(true); } finally { setSaving(false); }
      }}>{saving ? t('处理中…', 'Working…') : t('立即同步', 'Sync now')}</button>
      {data?.scan.at && <p className="muted">{t('上次扫描', 'Last scan')}: {new Date(data.scan.at).toLocaleString(locale)} · {data.scan.files} {t('个文件', 'files')}</p>}
      {data && (data.scan.skipped + data.scan.malformed + data.scan.unavailable > 0) && <p role="status" className="muted">
        {t('日志导入不完整', 'Log import is partial')}: {data.scan.skipped} {t('已跳过', 'skipped')} · {data.scan.malformed} {t('无法解析的行', 'unreadable lines')} · {data.scan.unavailable} {t('无法访问', 'inaccessible')}.
      </p>}
    </section>
    <section className="setting-card">
      <h2>{t('模型单价', 'Model pricing')}</h2>
      <p className="muted">{t('每百万 Token 的美元单价，按服务返回的完整模型名称匹配。留空的模型显示未定价。修改单价会重算历史估算；搜索等工具费用不包含在内。',
        'USD per million tokens, matched to the exact returned model name. Models without rates stay unpriced. Changing rates recalculates history; search and other tool fees are excluded.')}</p>
      <form onSubmit={event => void savePrice(event)}>
        <label className="field">{t('模型', 'Model')}
          <input required maxLength={180} value={model} list="usage-models" onChange={event => chooseModel(event.target.value)} />
          <datalist id="usage-models">{models.map(id => <option key={id} value={id} />)}</datalist>
        </label>
        <div className="usage-rates">{([['input', t('输入', 'Input')], ['output', t('输出', 'Output')],
          ['cached', t('缓存读取', 'Cache read')], ['cacheWrite', t('缓存写入', 'Cache write')]] as const).map(([key, label]) =>
          <label key={key} className="field">{label}<input type="number" min="0" max="1000000" step="any" required
            value={rates[key]} onChange={event => setRates({ ...rates, [key]: event.target.value })} /></label>)}</div>
        <button className="secondary" disabled={saving || !model.trim()} type="submit">{saving ? t('保存中…', 'Saving…') : t('保存单价', 'Save rates')}</button>
      </form>
    </section>
    <section className="setting-card">
      <h2>{t('最近请求', 'Recent requests')}</h2>
      <ul className="usage-requests">{records.slice(0, 50).map(row => {
        const cost = estimatedCost(row.tokens, priceFor(row.model));
        return <li key={row.id}><strong>{row.model}</strong>
          <small>{row.source === 'claude' ? 'Claude Code' : row.source === 'codex' ? 'Codex' : 'Meow'}</small>
          <small>{new Date(row.at).toLocaleString(locale)} · {row.status === 'running' ? t('进行中', 'Running') : row.status === 'complete' ? t('完成', 'Complete') : row.status === 'cancelled' ? t('已取消', 'Cancelled') : t('失败', 'Error')}</small>
          <span>{row.tokens ? `${number(row.tokens.input + row.tokens.output)} tokens` : t('Token 未报告', 'Tokens not reported')} · {cost === undefined ? t('未定价', 'Unpriced') : `≈ ${dollars(cost)}`}</span>
        </li>;
      })}</ul>
      <p className="muted">{t('最多显示最近 50 条。用量记录独立于聊天保存，重试会新增请求。清空聊天不会删除用量；清除全部本地数据会同时删除记录和单价。',
        'Shows the latest 50. Usage survives chat deletion, and retries count as new requests. Clearing all local data removes usage and rates.')}</p>
      {confirmClear ? <div className="data-buttons"><span>{t('清空全部用量记录并暂停日志导入？保留单价，旧记录不会重新导入。', 'Clear all usage and pause log import? Rates are kept; old records will not be re-imported.')}</span>
        <button className="secondary" disabled={saving} onClick={async () => {
          setSaving(true);
          try { await desktop.clearUsage(); setConfirmClear(false); await refresh(); }
          catch { setError(true); } finally { setSaving(false); }
        }}>{t('确认清空', 'Confirm clear')}</button>
        <button className="secondary" onClick={() => setConfirmClear(false)}>{t('取消', 'Cancel')}</button></div>
        : <button className="secondary" onClick={() => setConfirmClear(true)}>{t('清空用量记录', 'Clear usage history')}</button>}
    </section>
  </div>;
}
