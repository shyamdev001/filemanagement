import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Eye, FileUp, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

const TYPES = { dcr: 'DCR certificate', agreement: 'Model Agreement', fl: 'Feasibility Letter (FL)' };
const GU = '૦૧૨૩૪૫૬૭૮૯';
const ascii = (s) => String(s || '').replace(/[૦-૯]/g, (d) => GU.indexOf(d)).toLowerCase();

/** Type part of a name, village or mobile number and pick the customer from the list. */
function CustomerPicker({ customers, value, onChange }) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const needle = ascii(q.trim());
    if (needle.length < 2) return [];
    return customers
      .filter((c) => ascii([c.name, c.englishNameShown, c.village, ...(c.mobiles || [])].join(' ')).includes(needle))
      .slice(0, 8);
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
      <input type="search" aria-label="Find the customer" placeholder="Find the customer: name, village or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <div className="picker-list">
          {matches.map((c) => (
            <button key={c._id} onClick={() => { onChange(c); setQ(''); }}>
              <b lang="gu">{c.name}</b>
              <div className="sub"><span lang="gu">{c.village}</span> · {c.mobile || 'no mobile'} · {c.sheet}</div>
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
              <span lang="gu">{cand.name}</span> · {cand.mobile}
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

  const loadPending = useCallback(() => api.get('/pending').then((d) => setPending(d.pending)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const send = async (fileList) => {
    const files = [...fileList].filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) return setError('Choose PDF files.');
    setError('');
    const all = [];
    try {
      // Sent in small groups so a big batch does not time out.
      for (let i = 0; i < files.length; i += 10) {
        setBusy(`Reading ${Math.min(i + 10, files.length)} of ${files.length}…`);
        const body = new FormData();
        files.slice(i, i + 10).forEach((f) => body.append('files', f));
        const d = await api.post('/uploads/bulk', body);
        all.push(...d.results);
        // PDFs that were already waiting and could be placed now that their application number is known.
        all.push(...(d.alsoFiled || []).map((f) => ({ ...f, name: `${f.name} (was waiting)`, result: 'saved', how: 'application number' })));
        setResults([...all]);
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
  const saved = results ? results.filter((r) => r.result === 'saved').length : 0;
  const queued = results ? results.filter((r) => r.result === 'pending').length : 0;

  return (
    <div className="page narrow" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1><T en="Upload PDFs" gu="PDF અપલોડ" /></h1>
          <p className="prose">
            Drop the DCR, Model Agreement and FL PDFs here, many at once, in any order. The app reads each one and files it
            under the right customer: the FL by its mobile number, then the Agreement and DCR by the application number
            they share with that FL. Anything it is not sure about waits below for you.
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
          <span className="hint">Tip: if the file name has the customer's mobile number, it is matched every time.</span>
        </div>
        <input type="file" accept=".pdf,application/pdf" multiple disabled={!!busy} onChange={(e) => { send(e.target.files); e.target.value = ''; }} />
      </label>
      {error && <Notice>{error}</Notice>}

      {results && (
        <section className="panel">
          <div className="panel-head">
            <h2>This upload</h2>
            <span className="hint">{saved} filed automatically · {queued} waiting for you</span>
          </div>
          <div className="table-scroll">
            <table className="grid">
              <thead><tr><th>File</th><th>Result</th><th>Where it went</th></tr></thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>
                      {r.result === 'saved' && <span className="pill ok"><Check size={13} strokeWidth={3} /> Filed</span>}
                      {r.result === 'pending' && <span className="pill warn">Waiting for you</span>}
                      {r.result === 'rejected' && <span className="pill no">Not accepted</span>}
                    </td>
                    <td>
                      {r.result === 'saved'
                        ? <><Link to={`/customer/${r.customer.id}`} lang="gu">{r.customer.name}</Link> · {TYPES[r.type]} <span className="sub">matched by {r.how}</span></>
                        : r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
