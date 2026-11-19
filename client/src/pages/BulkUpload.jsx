import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Eye, FileUp, FolderSearch, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';
import { matcher } from '../search.js';

const TYPES = { dcr: 'DCR certificate', agreement: 'Model Agreement', fl: 'Feasibility Letter (FL)', bill: 'Bill (Tally invoice)', insurance: 'Insurance policy' };
const GU = '૦૧૨૩૪૫૬૭૮૯';
const ascii = (s) => String(s || '').replace(/[૦-૯]/g, (d) => GU.indexOf(d)).toLowerCase();

/** Type part of a name, village or mobile number and pick the customer from the list. */
function CustomerPicker({ customers, value, onChange }) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    if (q.trim().length < 2) return [];
    const fits = matcher(q);
    return customers.filter(fits).slice(0, 10);
  }, [q, customers]);

  if (value) {
    return (
      <span className="chosen">
        <span lang="gu">{value.name}</span> · {value.mobile || 'no mobile'}
        <button className="btn quiet small" aria-label="Choose a different customer" onClick={() => onChange(null)}><X size={15} /></button>
      </span>
    );
  }
  return (
    <div className="picker">
      <input type="search" aria-label="Find the customer" placeholder="Find the customer: name (any order), village or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <div className="picker-list">
          {matches.map((c) => (
            <button key={c._id} onClick={() => { onChange(c); setQ(''); }}>
              <b lang="gu">{c.name}</b>
              <div className="sub">{c.englishNameShown} · <span lang="gu">{c.village}</span> · {c.kw ?? '?'} kW · {c.mobile || 'no mobile'} · {c.sheet} row {c.excelRow}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PendingRow({ item, customers, onDone, onError }) {
  const [type, setType] = useState(item.detectedType || '');
  const [customer, setCustomer] = useState(null);
  const [busy, setBusy] = useState(false);
  const has = customer && type && customer.status?.[type]?.ok;

  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (e) {
      onError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="pending">
      <div className="pending-top">
        <div>
          <a className="file-link" href={`/api/pending/${item._id}/file`} target="_blank" rel="noreferrer"><Eye size={15} /> {item.originalName}</a>
          <div className="sub">{item.reason}</div>
        </div>
        <button
          className="btn quiet small"
          disabled={busy}
          onClick={() => window.confirm(`Take "${item.originalName}" out of this list?`) && act(() => api.del(`/pending/${item._id}`))}
        >
          <Trash2 size={15} /> Not needed
        </button>
      </div>
      <div className="pending-fix">
        <select aria-label="Which document is this?" className={type ? '' : 'needs'} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Which document?</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <CustomerPicker customers={customers} value={customer} onChange={setCustomer} />
        <button
          className="btn primary"
          disabled={busy || !type || !customer}
          onClick={() => act(() => api.post(`/pending/${item._id}/assign`, { customerId: customer._id, type }))}
        >
          {has ? 'Replace and save' : 'Save to customer'}
        </button>
      </div>
      {!customer && item.candidates?.length > 0 && (
        <div className="chips">
          Could be:
          {item.candidates.map((cand) => (
            <button key={cand._id} className="chip" onClick={() => setCustomer(customers.find((c) => c._id === cand._id) || cand)}>
              <span lang="gu">{cand.name}</span> · <span lang="gu">{cand.village}</span> · {cand.kw ?? '?'} kW · {cand.mobile}
            </button>
          ))}
        </div>
      )}
      {has && <div className="sub warn">This customer already has a {TYPES[type]}. Saving replaces it.</div>}
    </div>
  );
}

export default function BulkUpload({ customers, onChanged }) {
  const [pending, setPending] = useState(null);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState('');
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState([]);
  // Folder scan (the pendrive): what the folder holds, and whether the last results were only a check.
  const [folder, setFolder] = useState(() => {
    try {
      return localStorage.getItem('scanFolder') || '';
    } catch {
      return '';
    }
  });
  const [kind, setKind] = useState('insurance');
  const [scanDry, setScanDry] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const loadPending = useCallback(() => api.get('/pending').then((d) => setPending(d.pending)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // Read a folder on this PC, folders inside folders included. `dry` = only check, save nothing.
  const scan = async (dry) => {
    setError('');
    try {
      localStorage.setItem('scanFolder', folder);
    } catch {
      /* not important */
    }
    const all = [];
    const people = new Map();
    try {
      setBusy('Looking in the folder…');
      const list = await api.post('/uploads/scan/list', { folder, kind });
      if (!list.count) throw new Error('No PDF files were found in this folder.');
      setScanDry(dry);
      // A month of invoices is one PDF with hundreds of pages: it is read ten pages at a time (two pieces per request),
      // so a stop in the middle loses nothing; policies go eight files at a time.
      const units = kind === 'bill' ? list.chunks : list.files;
      const per = kind === 'bill' ? 2 : 8;
      for (let i = 0; i < units.length; i += per) {
        const what = kind === 'bill' ? `${Math.min(i * 10 + per * 10, list.chunks.length * 10)} pages of about ${list.chunks.length * 10}` : `${Math.min(i + per, units.length)} of ${units.length}`;
        setBusy(`${dry ? 'Checking' : 'Filing'} ${what}…`);
        const d = await api.post('/uploads/scan/run', kind === 'bill' ? { folder: list.folder, chunks: units.slice(i, i + per), kind, dry } : { folder: list.folder, files: units.slice(i, i + per), kind, dry });
        all.push(...d.results);
        all.push(...(d.alsoFiled || []).map((f) => ({ ...f, name: `${f.name} (was waiting)` })));
        for (const c of d.customers || []) people.set(c.id, c);
        setResults([...all]);
        setTouched([...people.values()]);
      }
      if (list.capped) setError('This folder has more than 5,000 PDFs: only the first 5,000 were read. Run it again for the rest.');
    } catch (e) {
      setError(e.message);
    }
    setBusy('');
    loadPending();
    onChanged();
  };

  const send = async (fileList) => {
    setScanDry(null);
    const files = [...fileList].filter((f) => /\.(pdf|jpe?g|png)$/i.test(f.name));
    if (!files.length) return setError('Choose PDF files (or photos of bills and policies).');
    setError('');
    const all = [];
    const people = new Map();
    try {
      // Sent in small groups so a big batch does not time out.
      for (let i = 0; i < files.length; i += 10) {
        setBusy(`Reading ${Math.min(i + 10, files.length)} of ${files.length}…`);
        const body = new FormData();
        files.slice(i, i + 10).forEach((f) => body.append('files', f));
        const d = await api.post('/uploads/bulk', body);
        all.push(...d.results);
        // PDFs that were already waiting and could be placed now that more is known.
        all.push(...(d.alsoFiled || []).map((f) => ({ ...f, name: `${f.name} (was waiting)` })));
        for (const c of d.customers || []) people.set(c.id, c);
        setResults([...all]);
        setTouched([...people.values()]);
      }
    } catch (e) {
      setError(e.message);
    }
    setBusy('');
    loadPending();
    onChanged();
  };

  const refresh = () => {
    loadPending();
    onChanged();
  };
  const count = (kind) => (results ? results.filter((r) => r.result === kind).length : 0);
  const saved = count('saved');
  const queued = count('pending') + count('rejected');
  const shown = results ? (showAll ? results : results.filter((r) => !['same', 'ignored'].includes(r.result))) : [];
  const incomplete = touched.filter((c) => Object.values(c.has).some((v) => !v));

  return (
    <div className="page narrow" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1><T en="Upload PDFs" gu="PDF અપલોડ" /></h1>
          <p className="prose">
            Drop the DCR, Model Agreement and FL PDFs here, and the bills (Tally invoices) and insurance policies too, many at
            once, in any order and without renaming. The app works out which document each file is, checks the application
            number, mobile number, name and village in it against your customers, and files it. A policy keeps only its front
            page; a PDF with a whole month of invoices is cut into one invoice per customer. At the end it tells you only what
            it could not settle, and which customers are still missing a document.
          </p>
        </div>
      </div>

      <label
        className={`drop big${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) send(e.dataTransfer.files); }}
      >
        <div className="drop-icon"><FileUp size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{busy || 'Drag PDF files here, or click to choose'}</b>
          <span className="hint">Upload a customer's FL together with their Agreement and DCR: the FL makes the other two certain. Bills and policies may also be photos (JPG / PNG).</span>
        </div>
        <input type="file" accept=".pdf,application/pdf,.jpg,.jpeg,.png,image/jpeg,image/png" multiple disabled={!!busy} onChange={(e) => { send(e.target.files); e.target.value = ''; }} />
      </label>

      <section className="panel">
        <div className="panel-head">
          <h2><FolderSearch size={17} style={{ verticalAlign: '-3px' }} /> <T en="Read a whole folder" gu="આખું ફોલ્ડર વાંચો" /></h2>
          <span className="hint">for the pendrive: folders inside folders are read too</span>
        </div>
        <div className="panel-body form">
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 260 }}>
              <span>Folder on this PC</span>
              <input type="text" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="E:\FINAL POLICY LIST\POLICY OF CUSTOMER" disabled={!!busy} />
            </label>
            <label className="field">
              <span>What is in it</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={!!busy}>
                <option value="insurance">Insurance policies (front page only)</option>
                <option value="bill">Bills (Tally invoices)</option>
              </select>
            </label>
          </div>
          <div className="row">
            <button className="btn" disabled={!!busy || !folder.trim()} onClick={() => scan(true)}>Check first (saves nothing)</button>
            <button className="btn primary" disabled={!!busy || !folder.trim()} onClick={() => scan(false)}>File them</button>
            <span className="hint">{busy || 'Start with "Check first" to see what would happen. Nothing is saved until you press "File them".'}</span>
          </div>
        </div>
      </section>
      {error && <Notice>{error}</Notice>}

      {results && (
        <>
          {scanDry && (
            <Notice kind="warn"><b>This was only a check. Nothing was saved.</b> Press "File them" above to file what you see here.</Notice>
          )}
          <div className="panel figures">
            <div><b>{saved}</b><span>{scanDry ? 'would be filed' : 'filed by the app'}</span></div>
            <div><b>{count('same')}</b><span>already there</span></div>
            <div><b>{queued}</b><span>need you</span></div>
            {count('unmatched') > 0 && <div><b>{count('unmatched')}</b><span>nobody in your list</span></div>}
            {count('ignored') > 0 && <div><b>{count('ignored')}</b><span>skipped (not the policy)</span></div>}
            {scanDry === null && <div><b>{touched.length - incomplete.length}</b><span>customers now complete</span></div>}
          </div>

          {!busy && scanDry === null && results.length > 0 && !queued && !incomplete.length && (
            <Notice kind="warn"><b>All done.</b> Every PDF is filed and every customer in this upload has all three documents.</Notice>
          )}

          {incomplete.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2><T en="Still missing a document" gu="દસ્તાવેજ બાકી" /></h2>
                <span className="hint">customers from this upload</span>
              </div>
              <div className="table-scroll">
                <table className="grid">
                  <thead><tr><th>Customer</th><th className="c">DCR</th><th className="c">Agreement</th><th className="c">FL</th><th>Download from the portal</th></tr></thead>
                  <tbody>
                    {incomplete.map((c) => (
                      <tr key={c.id}>
                        <td><Link to={`/customer/${c.id}`} lang="gu">{c.name}</Link><div className="sub">{[c.english, c.village].filter(Boolean).join(' · ')}</div></td>
                        {['dcr', 'agreement', 'fl'].map((t) => (
                          <td key={t} className="c"><span className={c.has[t] ? 'mark ok' : 'mark no'}>{c.has[t] ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}</span></td>
                        ))}
                        <td>{Object.keys(c.has).filter((t) => !c.has[t]).map((t) => TYPES[t]).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>What happened to each file</h2>
              <span className="hint">
                {shown.length > 400 ? `first 400 of ${shown.length}` : `${shown.length}`} shown ·{' '}
                <button className="pill-x" onClick={() => setShowAll(!showAll)}>{showAll ? 'hide the ones already there or skipped' : 'show everything'}</button>
              </span>
            </div>
            <div className="table-scroll">
              <table className="grid">
                <thead><tr><th>File</th><th>Result</th><th>Where it went</th></tr></thead>
                <tbody>
                  {shown.slice(0, 400).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>
                        {r.result === 'saved' && <span className="pill ok"><Check size={13} strokeWidth={3} /> {scanDry ? 'Would be filed' : 'Filed'}</span>}
                        {r.result === 'ignored' && <span className="pill">Skipped</span>}
                        {r.result === 'unmatched' && <span className="pill warn">Nobody in your list</span>}
                        {r.result === 'same' && <span className="pill">Already there</span>}
                        {r.result === 'pending' && <span className="pill warn">Needs you</span>}
                        {r.result === 'rejected' && <span className="pill no">Not accepted</span>}
                      </td>
                      <td>
                        {r.customer ? (
                          <>
                            <Link to={`/customer/${r.customer.id}`} lang="gu">{r.customer.name}</Link> · {TYPES[r.type]}{' '}
                            <span className="sub">{r.result === 'same' ? 'this exact PDF was filed before' : `found by ${r.how}`}</span>
                            {r.note && <div className="sub warn">{r.note}. Please glance.</div>}
                          </>
                        ) : r.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2><T en="Waiting for you" gu="તમારે ગોઠવવાના" /></h2>
          <span className="pill">{pending ? pending.length : '…'}</span>
        </div>
        {pending && !pending.length && (
          <div className="panel-body muted">Nothing is waiting. PDFs the app cannot place by itself will appear here.</div>
        )}
        {pending?.map((item) => (
          <PendingRow key={item._id} item={item} customers={customers || []} onDone={refresh} onError={setError} />
        ))}
      </section>
    </div>
  );
}
