import { useEffect, useMemo, useState } from 'react';
import { Check, FileDown, Printer, Search, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

const SHEET_ORDER = ['residential', 'pashupalak', 'commercial'];
const GU = '૦૧૨૩૪૫૬૭૮૯';
const ascii = (s) => String(s || '').replace(/[૦-૯]/g, (d) => GU.indexOf(d)).toLowerCase();
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const MODES = {
  full: { en: 'Complete files', gu: 'પૂરી ફાઈલ', help: 'All six documents. Only customers that are Ready.' },
  generated: { en: 'App documents only', gu: 'ફક્ત એપના દસ્તાવેજ', help: 'Payee certificate, panel datasheet and warranty card / inverter datasheet. DCR, Agreement and FL are left out.' },
};

export default function Print({ customers, onChanged }) {
  const [mode, setMode] = useState('full');
  const [sheet, setSheet] = useState('all');
  const [q, setQ] = useState('');
  const [hidePrinted, setHidePrinted] = useState(true);
  const [size, setSize] = useState(25);
  const [doubleSided, setDoubleSided] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [batches, setBatches] = useState(null);
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadBatches = () => api.get('/batches').then((d) => setBatches(d.batches)).catch((e) => setError(e.message));
  useEffect(() => {
    loadBatches();
  }, []);

  const sheets = useMemo(() => {
    const found = [...new Set((customers || []).map((c) => c.sheet))];
    const rank = (s) => SHEET_ORDER.indexOf(s.toLowerCase()) + 1 || 99;
    return found.sort((a, b) => rank(a) - rank(b));
  }, [customers]);

  // Customers that can be printed in this mode, in Excel order.
  const eligible = useMemo(
    () =>
      [...(customers || [])]
        .filter((c) => (mode === 'full' ? c.status.ready : c.status.generated))
        .sort((a, b) => sheets.indexOf(a.sheet) - sheets.indexOf(b.sheet) || a.excelRow - b.excelRow),
    [customers, mode, sheets]
  );
  const rows = useMemo(() => {
    const needle = ascii(q.trim());
    return eligible.filter((c) => {
      if (sheet !== 'all' && c.sheet !== sheet) return false;
      if (hidePrinted && c.printedAt) return false;
      return !needle || ascii([c.name, c.englishNameShown, c.village, c.taluka, ...(c.mobiles || [])].join(' ')).includes(needle);
    });
  }, [eligible, sheet, hidePrinted, q]);

  const visiblePicked = rows.filter((c) => picked.has(c._id));
  const toggle = (id) => setPicked((old) => {
    const next = new Set(old);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const pickNext = () => setPicked(new Set(rows.slice(0, size).map((c) => c._id)));
  const changeMode = (m) => {
    setMode(m);
    setPicked(new Set());
    setMade(null);
  };

  const make = async () => {
    setBusy(true);
    setError('');
    setMade(null);
    try {
      const d = await api.post('/batches', { customerIds: visiblePicked.map((c) => c._id), mode, doubleSided });
      setMade(d.batch);
      setPicked(new Set());
      loadBatches();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const mark = async (batch, printed) => {
    setError('');
    try {
      await api.post(`/batches/${batch._id}/printed`, { printed });
      if (made?._id === batch._id) setMade({ ...made, printedAt: printed ? new Date().toISOString() : null });
      loadBatches();
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!customers) return <div className="page"><p className="muted">Loading customers…</p></div>;

  return (
    <div className="page medium">
      <div className="page-head">
        <div>
          <h1><T en="Print files" gu="ફાઈલ પ્રિન્ટ" /></h1>
          <p className="prose">
            Choose 20 to 30 customers and make one PDF with every customer's documents in order. Print it, then mark the batch
            as printed so those customers are not printed twice.
          </p>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}

      <div className="toolbar">
        <div className="seg" role="group" aria-label="What to print">
          {Object.entries(MODES).map(([k, m]) => (
            <button key={k} aria-pressed={mode === k} onClick={() => changeMode(k)}><span><T en={m.en} gu={m.gu} /></span></button>
          ))}
        </div>
        <span className="hint">{MODES[mode].help}</span>
      </div>

      {made && (
        <section className="panel made">
          <div className="made-icon"><Check size={22} strokeWidth={3} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2>Batch {made.number} is ready to print</h2>
            <div className="hint">{made.customers.length} customers · {made.pages} pages{made.doubleSided ? ' · double-sided' : ''}</div>
          </div>
          <a className="btn primary" href={`/api/batches/${made._id}/file.pdf`} target="_blank" rel="noreferrer">
            <FileDown size={17} /> <T en="Open PDF" gu="PDF ખોલો" />
          </a>
          {made.printedAt ? (
            <span className="saved"><Check size={15} strokeWidth={3} /> Marked as printed</span>
          ) : (
            <button className="btn" onClick={() => mark(made, true)}><Printer size={16} /> <T en="Mark as printed" gu="પ્રિન્ટ થઈ ગઈ" /></button>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-head wrap">
          <div className="row">
            <div className="seg" role="group" aria-label="Sheet">
              {['all', ...sheets].map((s) => (
                <button key={s} aria-pressed={sheet === s} onClick={() => setSheet(s)}>{s === 'all' ? 'All sheets' : s}</button>
              ))}
            </div>
            <label className="search" style={{ flex: '0 1 260px' }}>
              <Search size={17} />
              <input type="search" aria-label="Search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <label className="check"><input type="checkbox" checked={hidePrinted} onChange={(e) => setHidePrinted(e.target.checked)} /> Hide already printed</label>
          </div>
          <div className="row">
            <select aria-label="How many" value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {[10, 20, 25, 30].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <button className="btn" disabled={!rows.length} onClick={pickNext}>Select the next {Math.min(size, rows.length) || size}</button>
            {picked.size > 0 && <button className="btn quiet" onClick={() => setPicked(new Set())}>Clear</button>}
          </div>
        </div>

        <div className="table-scroll" style={{ maxHeight: 460, overflowY: 'auto' }}>
          <table className="grid rows">
            <thead>
              <tr>
                <th aria-label="Select" style={{ width: 44 }} />
                <th>No.</th>
                <th><T en="Name" gu="નામ" /></th>
                <th><T en="Village" gu="ગામ" /></th>
                <th><T en="Mobile" gu="મોબાઈલ" /></th>
                <th>Sheet</th>
                <th>Printed</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((c) => (
                <tr key={c._id} onClick={() => toggle(c._id)}>
                  <td><input type="checkbox" className="tick" aria-label={`Select ${c.name}`} checked={picked.has(c._id)} onChange={() => toggle(c._id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="num">{c.srNo}</td>
                  <td><div className="name" lang="gu">{c.name}</div></td>
                  <td lang="gu" className="nw">{c.village}</td>
                  <td>{c.mobile}</td>
                  <td>{c.sheet}</td>
                  <td>{c.printedAt ? <span className="pill ok">Batch {c.printBatch} · {day(c.printedAt)}</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan="7" className="empty-row">
                    {eligible.length
                      ? 'Nobody left to print with these filters. Untick "Hide already printed" to see everyone.'
                      : mode === 'full'
                        ? 'No customer has a complete file yet. Upload the DCR, Agreement and FL PDFs first, or switch to "App documents only".'
                        : 'No customer has all three app documents ready yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-foot">
          <span>
            {rows.length} can be printed{rows.length > 300 ? ' (showing the first 300)' : ''} · <b>{visiblePicked.length} selected</b>
          </span>
          <div className="row">
            <label className="check" title="Adds a blank page after a document with an odd number of pages, so each document starts on a new sheet.">
              <input type="checkbox" checked={doubleSided} onChange={(e) => setDoubleSided(e.target.checked)} /> Printing on both sides
            </label>
            <button className="btn primary" disabled={busy || !visiblePicked.length} onClick={make}>
              <Printer size={17} /> {busy ? 'Making the PDF…' : `Make print file (${visiblePicked.length})`}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2><T en="Earlier batches" gu="અગાઉની બેચ" /></h2></div>
        {batches && !batches.length && <div className="panel-body muted">No print files yet. The ones you make are kept here so you can reprint them.</div>}
        {batches?.length > 0 && (
          <div className="table-scroll">
            <table className="grid">
              <thead><tr><th>Batch</th><th>Made</th><th>What</th><th className="r">Customers</th><th className="r">Pages</th><th>Printed</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b._id}>
                    <td><div className="name">Batch {b.number}</div></td>
                    <td className="nw">{day(b.createdAt)}</td>
                    <td>{MODES[b.mode]?.en || b.mode}{b.doubleSided ? ', both sides' : ''}</td>
                    <td className="r" title={b.customers.map((c) => c.name).join('\n')}>{b.customers.length}</td>
                    <td className="r">{b.pages}</td>
                    <td>{b.printedAt ? <span className="pill ok"><Check size={13} strokeWidth={3} /> {day(b.printedAt)}</span> : <span className="pill warn">Not yet</span>}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <a className="btn small" href={`/api/batches/${b._id}/file.pdf`} target="_blank" rel="noreferrer"><FileDown size={15} /> Open PDF</a>
                        {b.printedAt
                          ? <button className="btn quiet small" title="Un-mark: these customers go back to not printed" onClick={() => window.confirm(`Mark batch ${b.number} as NOT printed?`) && mark(b, false)}><Undo2 size={15} /> Undo</button>
                          : <button className="btn small" onClick={() => mark(b, true)}><Printer size={15} /> Mark as printed</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
