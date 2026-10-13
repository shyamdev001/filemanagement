import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

const BRAND = { adani: 'Adani', waaree: 'Waaree', aps: 'APS', tata: 'Tata' };
const blank = { label: '', brand: 'adani', topcon: null, minWatt: '', maxWatt: '', file: null };

const FileSelect = ({ rule, files, onPick }) => (
  <select className={rule.file ? '' : 'needs'} aria-label={`Datasheet for ${rule.label}`} value={rule.file || ''} onChange={(e) => onPick(rule.id, e.target.value)}>
    <option value="">Not chosen yet</option>
    {files.map((f) => <option key={f} value={f}>{f}</option>)}
  </select>
);

/** Which pages of the PDF go into the customer file; empty means the whole PDF. Saves when you leave the box. */
const PagesInput = ({ rule, onSave }) => (
  <input
    key={rule.pages || ''}
    type="text"
    aria-label={`Pages to print for ${rule.label}`}
    placeholder="all"
    title="Leave empty to print the whole PDF, or type the pages to print, for example 2-3"
    style={{ width: 76 }}
    defaultValue={rule.pages || ''}
    onBlur={(e) => e.target.value.trim() !== (rule.pages || '') && onSave(rule.id, e.target.value.trim())}
  />
);

export default function Settings({ customers, onChanged }) {
  const [cfg, setCfg] = useState(null);
  const [files, setFiles] = useState([]);
  const [folder, setFolder] = useState('');
  const [rules, setRules] = useState([]);
  const [draft, setDraft] = useState(blank);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/settings/datasheets')
      .then((d) => {
        setCfg(d.config);
        setRules(d.config.rules);
        setFiles(d.files);
        setFolder(d.folder);
      })
      .catch((e) => setError(e.message));
  }, []);

  // What is still blocking customers, most common first.
  const blockers = useMemo(() => {
    const m = new Map();
    for (const c of customers || []) {
      for (const p of [...c.status.datasheet.problems, ...(c.status.inverter.type === 'datasheet' ? c.status.inverter.problems : [])]) {
        const key = p.replace(/^Panel ".*?": /, '').replace(/ \(Settings.*\)$/, '');
        m.set(key, (m.get(key) || 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [customers]);

  const save = async (next) => {
    setError('');
    try {
      const d = await api.put('/settings/datasheets', { rules: next });
      setRules(d.config.rules);
      setMsg('Saved');
      setTimeout(() => setMsg(''), 2500);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  const setFile = (id, file) => save(rules.map((r) => (r.id === id ? { ...r, file: file || null } : r)));
  const setPages = (id, pages) => save(rules.map((r) => (r.id === id ? { ...r, pages } : r)));
  const remove = (r) => window.confirm(`Remove the rule "${r.label}"?`) && save(rules.filter((x) => x.id !== r.id));
  const add = (e) => {
    e.preventDefault();
    const label = draft.label || `${BRAND[draft.brand]} ${draft.minWatt}–${draft.maxWatt} W`;
    save([...rules, { ...draft, kind: 'panel', id: '', label }]).then(() => setDraft(blank));
  };

  if (!cfg) return <div className="page narrow">{error ? <Notice>{error}</Notice> : <p className="muted">Loading settings…</p>}</div>;

  return (
    <div className="page medium">
      <div className="page-head">
        <div>
          <h1><T en="Datasheets" gu="ડેટાશીટ સેટિંગ" /></h1>
          <p className="prose">
            The app picks a datasheet from the panel written in Excel. PDFs are read from <b>{folder}</b> ({files.length} found).
            To add one, put the PDF in that folder, refresh this page and choose it below. Every change saves immediately.
          </p>
        </div>
        {msg && <span className="saved"><Check size={15} strokeWidth={3} /> {msg}</span>}
      </div>
      {error && <Notice>{error}</Notice>}

      {blockers.length > 0 && (
        <Notice kind="warn">
          <b>Still holding customers back</b>
          <ul>
            {blockers.slice(0, 12).map(([p, count]) => <li key={p}><b>{count}</b> {count === 1 ? 'customer' : 'customers'}: {p}</li>)}
          </ul>
        </Notice>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2><T en="Panel datasheets" gu="પેનલ ડેટાશીટ" /></h2>
          <span className="hint">Checked from top to bottom; the first rule that fits is used.</span>
        </div>
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>Rule</th><th>Type</th><th className="r">Watt</th><th>Datasheet PDF</th><th>Pages</th><th aria-label="Remove" /></tr></thead>
            <tbody>
              {rules.filter((r) => r.kind === 'panel').map((r) => (
                <tr key={r.id}>
                  <td><div className="name">{r.label}</div></td>
                  <td>{r.topcon === true ? 'TOPCon only' : r.topcon === false ? 'Not TOPCon' : 'Any'}</td>
                  <td className="r">{r.minWatt}–{r.maxWatt}</td>
                  <td><FileSelect rule={r} files={files} onPick={setFile} /></td>
                  <td><PagesInput rule={r} onSave={setPages} /></td>
                  <td><button className="btn quiet small" aria-label={`Remove ${r.label}`} title="Remove this rule" onClick={() => remove(r)}><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="table-foot" onSubmit={add}>
          <span><b>Add a rule</b></span>
          <div className="row">
            <select aria-label="Brand" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })}>
              {Object.keys(cfg.panelBrands).map((b) => <option key={b} value={b}>{BRAND[b] || b}</option>)}
            </select>
            <select
              aria-label="Type"
              value={draft.topcon === null ? 'any' : String(draft.topcon)}
              onChange={(e) => setDraft({ ...draft, topcon: e.target.value === 'any' ? null : e.target.value === 'true' })}
            >
              <option value="any">Any type</option>
              <option value="true">TOPCon only</option>
              <option value="false">Not TOPCon</option>
            </select>
            <input type="number" aria-label="From watt" placeholder="From W" required style={{ width: 96 }} value={draft.minWatt} onChange={(e) => setDraft({ ...draft, minWatt: e.target.value })} />
            <input type="number" aria-label="To watt" placeholder="To W" required style={{ width: 96 }} value={draft.maxWatt} onChange={(e) => setDraft({ ...draft, maxWatt: e.target.value })} />
            <select aria-label="Datasheet PDF" style={{ maxWidth: 260 }} value={draft.file || ''} onChange={(e) => setDraft({ ...draft, file: e.target.value || null })}>
              <option value="">Datasheet PDF…</option>
              {files.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <button className="btn"><Plus size={16} /> Add</button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2><T en="Inverter datasheets" gu="ઇન્વર્ટર ડેટાશીટ" /></h2>
          <span className="hint">SOLARYAAN gets the warranty card; every other brand gets the PDF chosen here.</span>
        </div>
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>Brand</th><th>Datasheet PDF</th><th>Pages</th></tr></thead>
            <tbody>
              {rules.filter((r) => r.kind === 'inverter').map((r) => (
                <tr key={r.id}><td><div className="name">{r.label}</div></td><td><FileSelect rule={r} files={files} onPick={setFile} /></td><td><PagesInput rule={r} onSave={setPages} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
