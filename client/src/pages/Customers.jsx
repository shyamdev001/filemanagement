import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Printer, Search, Send, SlidersHorizontal, StickyNote, UserPlus, X } from 'lucide-react';
import { Mark, Notice, ReadyPill, T } from '../ui.jsx';
import { matcher, panelBrands } from '../search.js';

const PAGE = 50;
const SHEET_ORDER = ['residential', 'pashupalak', 'commercial'];
const GU = '૦૧૨૩૪૫૬૭૮૯';
const ascii = (s) => String(s || '').replace(/[૦-૯]/g, (d) => GU.indexOf(d)).toLowerCase();
const n = (v) => v.toLocaleString('en-IN');

const HEADS = (
  <tr>
    <th>No.</th>
    <th><T en="Name" gu="નામ" /></th>
    <th><T en="Village" gu="ગામ" /></th>
    <th><T en="Mobile" gu="મોબાઈલ" /></th>
    <th className="r">kW</th>
    <th><T en="Panel" gu="પેનલ" /></th>
    <th><T en="Inverter" gu="ઇન્વર્ટર" /></th>
    <th className="d" title="Payee certificate">Payee</th>
    <th className="d" title="Panel datasheet">Sheet</th>
    <th className="d" title="Inverter warranty card or datasheet">Inv.</th>
    <th className="d" title="DCR certificate">DCR</th>
    <th className="d" title="Model Agreement">Agr.</th>
    <th className="d" title="Feasibility Letter">FL</th>
    <th className="d" title="Bill and insurance policy put in the file by hand">Bill · Ins.</th>
    <th><T en="Status" gu="સ્થિતિ" /></th>
    <th className="d" title="Tick when the printed file is sent">Sent</th>
    <th aria-label="Open" />
  </tr>
);

/** The Sent tick, right in the list: only a printed file can be ticked. Click again to undo. */
function SentTick({ c, onChanged, onError }) {
  const [busy, setBusy] = useState(false);
  const set = async (sent) => {
    setBusy(true);
    try {
      onChanged((await api.patch(`/customers/${c._id}`, { sent })).customer);
    } catch (e) {
      onError(e.message);
    }
    setBusy(false);
  };
  const stop = (e) => e.stopPropagation(); // a click on the tick does not open the customer
  if (c.sentAt) {
    return (
      <button
        className="tick on"
        disabled={busy}
        title={`Sent ${new Date(c.sentAt).toLocaleDateString('en-IN')}${c.sentBy ? ` by ${c.sentBy}` : ''}. Click to undo.`}
        aria-label="Sent. Click to undo"
        onClick={(e) => { stop(e); if (window.confirm(`Mark ${c.name} as NOT sent?`)) set(false); }}
        onKeyDown={stop}
      >
        <Send size={14} />
      </button>
    );
  }
  if (!c.printedAt) return <span className="tick off" title="Not printed yet: print the file first" aria-label="Not printed yet" />;
  return (
    <button className="tick" disabled={busy} title="Printed. Click when the file is sent" aria-label="Mark as sent" onClick={(e) => { stop(e); set(true); }} onKeyDown={stop}>
      {busy ? '…' : ''}
    </button>
  );
}

export default function Customers({ customers, onChanged }) {
  const [tickError, setTickError] = useState('');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const sheet = params.get('sheet') || 'all';
  const q = params.get('q') || '';
  const show = params.get('show') || 'all';
  const page = Number(params.get('page')) || 1;
  // advanced filters
  const f = {
    village: params.get('village') || '',
    taluka: params.get('taluka') || '',
    inv: params.get('inv') || '',
    pan: params.get('pan') || '',
    miss: params.get('miss') || '',
    kmin: params.get('kmin') || '',
    kmax: params.get('kmax') || '',
    notes: params.get('notes') || '',
  };
  const activeFilters = Object.values(f).filter(Boolean).length;
  const [open, setOpen] = useState(activeFilters > 0);

  const set = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ page: '', ...changes })) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  // Same order as the sheets in the Excel file.
  const sheets = useMemo(() => {
    const found = [...new Set((customers || []).map((c) => c.sheet))];
    const rank = (s) => (SHEET_ORDER.indexOf(s.toLowerCase()) + 1 || 99);
    return found.sort((a, b) => rank(a) - rank(b));
  }, [customers]);

  const inSheet = useMemo(
    () =>
      [...(customers || [])]
        .filter((c) => sheet === 'all' || c.sheet === sheet)
        .sort((a, b) => sheets.indexOf(a.sheet) - sheets.indexOf(b.sheet) || a.excelRow - b.excelRow),
    [customers, sheets, sheet]
  );

  // what the filter boxes can offer, from the customers themselves
  const options = useMemo(() => {
    const count = (get) => {
      const m = new Map();
      for (const c of customers || []) {
        const v = get(c);
        if (v) m.set(v, (m.get(v) || 0) + 1);
      }
      return m;
    };
    const place = (field, en) => {
      const labels = new Map();
      for (const c of customers || []) if (c[field] && !labels.has(c[field])) labels.set(c[field], c[en] || '');
      return [...count((c) => c[field]).entries()]
        .map(([value, n]) => ({ value, n, label: `${labels.get(value) || ''} · ${value}` }))
        .sort((a, b) => a.label.localeCompare(b.label));
    };
    return {
      villages: place('village', 'villageEnglish'),
      talukas: place('taluka', 'talukaEnglish'),
      inverters: [...count((c) => c.status.inverter.brand).entries()].sort(),
    };
  }, [customers]);

  const rows = useMemo(() => {
    const fits = matcher(q);
    const kmin = f.kmin === '' ? null : Number(f.kmin);
    const kmax = f.kmax === '' ? null : Number(f.kmax);
    const missing = { dcr: (c) => !c.status.dcr.ok, fl: (c) => !c.status.fl.ok, agreement: (c) => !c.status.agreement.ok, payee: (c) => !c.status.payee.ok, datasheet: (c) => !c.status.datasheet.ok, serial: (c) => c.status.inverter.type === 'warranty' && !c.inverterSerial, bill: (c) => !c.status.bill?.inFile, insurance: (c) => !c.status.insurance?.inFile };
    return inSheet.filter((c) => {
      if (show === 'ready' && !c.status.ready) return false;
      if (show === 'notready' && c.status.ready) return false;
      if (show === 'printed' && !c.printedAt) return false;
      if (show === 'sent' && !c.sentAt) return false;
      if (show === 'notsent' && (!c.printedAt || c.sentAt)) return false;
      if (f.village && c.village !== f.village) return false;
      if (f.taluka && c.taluka !== f.taluka) return false;
      if (f.inv && c.status.inverter.brand !== f.inv) return false;
      if (f.pan && !panelBrands(c.panelRaw).includes(f.pan)) return false;
      if (f.miss && missing[f.miss] && !missing[f.miss](c)) return false;
      if (kmin != null && !(c.kw >= kmin)) return false;
      if (kmax != null && !(c.kw <= kmax)) return false;
      if (f.notes === '1' && !(c.notes || []).length) return false;
      return fits(c);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSheet, q, show, params]);

  if (!customers) {
    return (
      <div className="page">
        <div className="page-head"><h1><T en="Customers" gu="ગ્રાહકો" /></h1></div>
        <div className="panel table-scroll" aria-busy="true">
          <table className="grid skeleton">
            <thead>{HEADS}</thead>
            <tbody>
              {Array.from({ length: 10 }, (_, i) => (
                <tr key={i}>{Array.from({ length: 16 }, (_, j) => <td key={j}><span style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (!customers.length) {
    return (
      <div className="page narrow">
        <div className="panel empty">
          <div className="drop-icon"><FileSpreadsheet size={26} /></div>
          <h2>No customers yet</h2>
          <p>Import the Excel working list and every customer will appear here with the documents that are ready or missing.</p>
          <Link className="btn primary" to="/import"><T en="Import Excel" gu="એક્સેલ ઈમ્પોર્ટ" /></Link>
        </div>
      </div>
    );
  }

  const readyCount = inSheet.filter((c) => c.status.ready).length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const first = (current - 1) * PAGE;
  const visible = rows.slice(first, first + PAGE);

  const tiles = [
    { id: 'all', en: 'All customers', gu: 'બધા ગ્રાહકો', value: inSheet.length, dot: '' },
    { id: 'ready', en: 'Ready to print', gu: 'તૈયાર', value: readyCount, dot: 'ok' },
    { id: 'notready', en: 'Not ready', gu: 'બાકી', value: inSheet.length - readyCount, dot: 'no' },
    { id: 'printed', en: 'Printed', gu: 'પ્રિન્ટ થયેલ', value: inSheet.filter((c) => c.printedAt).length, dot: 'ok' },
    { id: 'notsent', en: 'Printed, not sent', gu: 'મોકલવાની બાકી', value: inSheet.filter((c) => c.printedAt && !c.sentAt).length, dot: 'no' },
    { id: 'sent', en: 'Sent', gu: 'મોકલેલ', value: inSheet.filter((c) => c.sentAt).length, dot: 'ok' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1><T en="Customers" gu="ગ્રાહકો" /></h1>
        <Link className="btn" to="/customer/new"><UserPlus size={16} /> <T en="Add customer" gu="નવો ગ્રાહક" /></Link>
      </div>

      {tickError && <Notice>{tickError}</Notice>}
      <div className="panel summary">
        {tiles.map((t) => (
          <button key={t.id} aria-pressed={show === t.id} onClick={() => set({ show: t.id === 'all' ? '' : t.id })}>
            <span className="k"><i className={`dot ${t.dot}`} /><span><T en={t.en} gu={t.gu} /></span></span>
            <span className="v">{n(t.value)}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Sheet">
          {['all', ...sheets].map((s) => (
            <button key={s} aria-pressed={sheet === s} onClick={() => set({ sheet: s === 'all' ? '' : s })}>
              {s === 'all' ? 'All sheets' : s}
              <span className="n">{n(customers.filter((c) => s === 'all' || c.sheet === s).length)}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search customers"
            placeholder="Search name (any order), village, mobile  ·  શોધો"
            value={q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>
        <button className={`btn${activeFilters ? ' primary' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          <SlidersHorizontal size={16} /> <T en="Filters" gu="ફિલ્ટર" />{activeFilters > 0 && ` (${activeFilters})`}
        </button>
      </div>

      {open && (
        <section className="panel filters">
          <div className="panel-body">
            <div className="filter-grid">
              <label className="field"><span><T en="Village" gu="ગામ" /></span>
                <select value={f.village} onChange={(e) => set({ village: e.target.value })}>
                  <option value="">Any village</option>
                  {options.villages.map((o) => <option key={o.value} value={o.value}>{o.label} ({o.n})</option>)}
                </select></label>
              <label className="field"><span><T en="Taluka" gu="તાલુકો" /></span>
                <select value={f.taluka} onChange={(e) => set({ taluka: e.target.value })}>
                  <option value="">Any taluka</option>
                  {options.talukas.map((o) => <option key={o.value} value={o.value}>{o.label} ({o.n})</option>)}
                </select></label>
              <label className="field"><span>Missing</span>
                <select value={f.miss} onChange={(e) => set({ miss: e.target.value })}>
                  <option value="">Anything</option>
                  <option value="dcr">DCR</option>
                  <option value="fl">FL</option>
                  <option value="agreement">Model Agreement</option>
                  <option value="serial">Inverter serial</option>
                  <option value="payee">Payee certificate</option>
                  <option value="datasheet">Panel datasheet</option>
                  <option value="bill">Bill (Tally invoice)</option>
                  <option value="insurance">Insurance policy</option>
                </select></label>
              <label className="field"><span>Inverter</span>
                <select value={f.inv} onChange={(e) => set({ inv: e.target.value })}>
                  <option value="">Any inverter</option>
                  {options.inverters.map(([b, k]) => <option key={b} value={b}>{b.toUpperCase()} ({k})</option>)}
                </select></label>
              <label className="field"><span>Panels</span>
                <select value={f.pan} onChange={(e) => set({ pan: e.target.value })}>
                  <option value="">Any panels</option>
                  <option value="adani">Adani</option>
                  <option value="waaree">Waaree</option>
                  <option value="aps">APS</option>
                  <option value="tata">Tata</option>
                </select></label>
              <div className="field"><span>System size (kW)</span>
                <div className="row" style={{ gap: 6 }}>
                  <input type="number" step="0.01" min="0" placeholder="from" style={{ width: 84 }} value={f.kmin} onChange={(e) => set({ kmin: e.target.value })} />
                  <span>to</span>
                  <input type="number" step="0.01" min="0" placeholder="to" style={{ width: 84 }} value={f.kmax} onChange={(e) => set({ kmax: e.target.value })} />
                </div></div>
              <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                <input type="checkbox" checked={f.notes === '1'} onChange={(e) => set({ notes: e.target.checked ? '1' : '' })} /> <span>Has a note</span>
              </label>
            </div>
            {activeFilters > 0 && (
              <button className="btn quiet small" style={{ marginTop: 10 }} onClick={() => set({ village: '', taluka: '', inv: '', pan: '', miss: '', kmin: '', kmax: '', notes: '' })}>
                <X size={14} /> Clear all filters
              </button>
            )}
          </div>
        </section>
      )}
      <p className="muted" style={{ margin: '-4px 2px 10px' }}>
        {rows.length === inSheet.length ? `${n(rows.length)} customers` : `${n(rows.length)} of ${n(inSheet.length)} customers match`}
      </p>

      <div className="panel">
        <div className="table-scroll">
          <table className="grid rows">
            <thead>{HEADS}</thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c._id}
                  className={c.inExcel || c.manual ? '' : 'gone'}
                  tabIndex={0}
                  onClick={() => navigate(`/customer/${c._id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/customer/${c._id}`)}
                >
                  <td className="num">{c.srNo}</td>
                  <td>
                    <div className="name" lang="gu">{c.name}</div>
                    {c.englishNameShown && <div className="sub">{c.englishNameShown}</div>}
                    {c.manual && <div className="sub">Added by hand</div>}
                    {!c.inExcel && !c.manual && <div className="sub warn">No longer in Excel</div>}
                  </td>
                  <td lang="gu" className="nw">
                    {c.village}
                    <div className="sub">{c.taluka}</div>
                  </td>
                  <td>{c.mobile || <span className="sub warn">missing</span>}</td>
                  <td className="r">{c.kw}</td>
                  <td lang="gu" className="wrap">{c.panelRaw}</td>
                  <td lang="gu" className="nw">{c.inverterRaw}</td>
                  <td className="d"><Mark doc={c.status.payee} label="Payee certificate" /></td>
                  <td className="d"><Mark doc={c.status.datasheet} label="Panel datasheet" /></td>
                  <td className="d"><Mark doc={c.status.inverter} label={c.status.inverter.type === 'warranty' ? 'Warranty card' : 'Inverter datasheet'} /></td>
                  <td className="d"><Mark doc={c.status.dcr} label="DCR certificate" /></td>
                  <td className="d"><Mark doc={c.status.agreement} label="Model Agreement" /></td>
                  <td className="d"><Mark doc={c.status.fl} label="Feasibility Letter" /></td>
                  <td className="d nw">
                    <i className={`dot ${c.status.bill?.inFile ? 'ok' : 'off'}`} title={c.status.bill?.uploaded ? 'Bill uploaded, printed with the file' : c.billAttached ? 'Paper bill added by hand' : 'No bill (optional)'} />{' '}
                    <i className={`dot ${c.status.insurance?.inFile ? 'ok' : 'off'}`} title={c.status.insurance?.uploaded ? 'Insurance policy uploaded, printed with the file' : c.insuranceAttached ? 'Paper policy added by hand' : 'No insurance policy (optional)'} />
                  </td>
                  <td className="nw">
                    {c.printedAt ? <span className="pill ok" title={c.printBatch ? `Batch ${c.printBatch}` : `Marked printed${c.printedBy ? ` by ${c.printedBy}` : ''}`}><Printer size={13} /> Printed</span> : <ReadyPill ok={c.status.ready} />}
                    {c.notes?.length > 0 && (
                      <span className="note-dot" title={`Note: ${c.notes[c.notes.length - 1].text}${c.notes[c.notes.length - 1].by ? ` (${c.notes[c.notes.length - 1].by})` : ''}`}>
                        <StickyNote size={15} aria-label="Has notes" />
                      </span>
                    )}
                  </td>
                  <td className="d"><SentTick c={c} onChanged={onChanged} onError={setTickError} /></td>
                  <td><ChevronRight size={18} className="go" /></td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan="16" className="empty-row">
                    No customer matches this search. Try the mobile number, or part of the name or village.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>
            {rows.length ? `Showing ${n(first + 1)}–${n(first + visible.length)} of ${n(rows.length)}` : 'Nothing to show'}
          </span>
          <div className="row">
            <button className="btn small" disabled={current <= 1} onClick={() => set({ page: String(current - 1) })}>
              <ChevronLeft size={16} /> Previous
            </button>
            <span>Page {current} of {pages}</span>
            <button className="btn small" disabled={current >= pages} onClick={() => set({ page: String(current + 1) })}>
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
