import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Sparkles, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

const LABEL = { inverterSerial: 'Serial', applicationNumber: 'Application no.', englishName: 'English name' };
const EXAMPLE = [
  'RAMESHBHAI SOMABHAI PATEL\t119116126G00001',
  '9876543210\t119116126G00002',
  '9876501234\tNP-GJMG26-1234567\tMAHESHBHAI KANUBHAI PARMAR',
].join('\n');

// The values a line carries, as fields of a customer.
const fieldsOf = (row, serial = row.values.serial) => {
  const f = {};
  if (serial) f.inverterSerial = serial;
  if (row.values.appNo) f.applicationNumber = row.values.appNo;
  return f;
};

/** One line the app could not finish by itself: the reason, and its best guesses as buttons. */
function NeedsRow({ row, onFixed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const save = async (customer, fields, label) => {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/customers/${customer.id}`, fields);
      setDone(label);
      onFixed();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="pending">
        <div className="sub">Line {row.line}: {row.raw}</div>
        <span className="saved"><Check size={15} strokeWidth={3} /> {done}</span>
      </div>
    );
  }
  const c = row.customer;
  return (
    <div className="pending">
      <div>
        <div className="sub">Line {row.line}</div>
        <div className="mono">{row.raw}</div>
      </div>
      <div>
        {c && <div><b lang="gu">{c.name}</b> <span className="sub">{[c.english, c.village].filter(Boolean).join(' · ')}</span></div>}
        <div className="warn" style={{ fontSize: 14 }}>{row.reason}</div>
      </div>
      <div className="chips">
        {row.suggestedSerial && c && (
          <button className="chip" disabled={busy} onClick={() => save(c, fieldsOf(row, row.suggestedSerial), `Saved ${row.suggestedSerial} for ${c.english}`)}>
            Use <b>{row.suggestedSerial}</b> (one digit was missing)
          </button>
        )}
        {row.replace && c && (
          <button className="chip" disabled={busy} onClick={() => save(c, row.replace, `Replaced for ${c.english}`)}>
            Replace it with <b>{Object.values(row.replace)[0]}</b>
          </button>
        )}
        {(row.suggestions || []).map((s) => (
          <button
            key={s.id}
            className="chip"
            disabled={busy || !Object.keys(fieldsOf(row)).length}
            title={`${s.mobile || 'no mobile'} · ${s.inverter || ''}${s.serial ? ` · already has ${s.serial}` : ''}`}
            onClick={() => save(s, fieldsOf(row), `Saved for ${s.english}`)}
          >
            It is <b lang="gu">{s.name}</b> ({s.village || s.english})
          </button>
        ))}
        {c && <Link className="sub" to={`/customer/${c.id}`}>Open customer</Link>}
      </div>
      {error && <div className="sub warn">{error}</div>}
    </div>
  );
}

export default function BulkPaste({ onChanged }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState(null);
  const [undone, setUndone] = useState(() => new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.post('/smart-paste', { text });
      setRows(d.rows);
      setUndone(new Set());
      setShowSaved(d.rows.some((r) => r.status === 'saved' && r.note));
      onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const undo = async (row) => {
    try {
      await api.patch(`/customers/${row.customer.id}`, row.undo);
      setUndone(new Set([...undone, row.line]));
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  const saved = rows ? rows.filter((r) => r.status === 'saved') : [];
  const same = rows ? rows.filter((r) => r.status === 'same') : [];
  const needs = rows ? rows.filter((r) => r.status === 'needs') : [];
  const glance = saved.filter((r) => r.note);

  return (
    <div className="page narrow" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1><T en="Names & serial numbers" gu="નામ અને સીરીયલ નંબર" /></h1>
          <p className="prose">
            Paste your list as it is. Each line can have a mobile number or a name (English or Gujarati), with a serial
            number, an application number, or both, in any order. The app finds each customer, checks every value and
            saves what it is sure about. Only the lines it cannot settle are shown to you at the end.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body form">
          <textarea rows="10" aria-label="Pasted lines" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} />
          <div className="row">
            <button className="btn primary" disabled={busy || !text.trim()} onClick={run}>
              <Sparkles size={17} /> {busy ? 'Working…' : <T en="Save automatically" gu="આપોઆપ સેવ કરો" />}
            </button>
            <span className="hint">Nothing is ever overwritten without asking you.</span>
          </div>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}

      {rows && (
        <>
          <div className="panel figures">
            <div><b>{saved.length - undone.size}</b><span>saved</span></div>
            <div><b>{same.length}</b><span>already saved before</span></div>
            <div><b>{needs.length}</b><span>need you</span></div>
          </div>

          {needs.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2><T en="Need you" gu="તમારે જોવાના" /></h2>
                <span className="hint">Click the right answer, or fix the line and paste it again.</span>
              </div>
              {needs.map((r) => <NeedsRow key={r.line} row={r} onFixed={onChanged} />)}
            </section>
          )}
          {rows.length > 0 && !needs.length && <Notice kind="warn"><b>All done.</b> Every line is saved; nothing needs you.</Notice>}
          {!rows.length && <Notice kind="warn">Nothing to read. Paste at least one line.</Notice>}

          {saved.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2><T en="Saved" gu="સેવ થયેલ" /> <span className="pill">{saved.length - undone.size}</span></h2>
                <button className="btn quiet small" onClick={() => setShowSaved(!showSaved)}>{showSaved ? 'Hide' : 'Show the list'}</button>
              </div>
              {glance.length > 0 && (
                <div className="panel-body" style={{ paddingBottom: 0 }}>
                  <Notice kind="warn"><b>{glance.length} saved with a slightly different name.</b> They are marked below; press Undo on any that is the wrong person.</Notice>
                </div>
              )}
              {showSaved && (
                <div className="table-scroll">
                  <table className="grid">
                    <thead><tr><th>Line</th><th>You pasted</th><th>Customer</th><th>Saved</th><th aria-label="Undo" /></tr></thead>
                    <tbody>
                      {saved.map((r) => (
                        <tr key={r.line} className={undone.has(r.line) ? 'gone' : ''}>
                          <td className="num">{r.line}</td>
                          <td>{r.values.name || r.values.mobile}</td>
                          <td>
                            <Link to={`/customer/${r.customer.id}`} lang="gu">{r.customer.name}</Link>
                            <div className="sub">{[r.customer.village, `found by ${r.how}`].filter(Boolean).join(' · ')}</div>
                            {r.note && <div className="sub warn">{r.note}</div>}
                          </td>
                          <td>{Object.entries(r.saved).map(([k, v]) => <div key={k}><span className="sub">{LABEL[k]}</span> {v}</div>)}</td>
                          <td>
                            {undone.has(r.line)
                              ? <span className="sub">Undone</span>
                              : <button className="btn quiet small" onClick={() => undo(r)}><Undo2 size={15} /> Undo</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
