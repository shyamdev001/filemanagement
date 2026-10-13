import { useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

const FIELDS = {
  inverterSerial: { en: 'Inverter serial numbers', gu: 'સીરીયલ નંબર', example: '9876543210\t119116126G00001\n9876501234\t119116126G00002' },
  englishName: { en: 'English names', gu: 'અંગ્રેજી નામ', example: '9876543210\tRAMESHBHAI SOMABHAI PATEL\n9876501234\tMAHESHBHAI KANUBHAI PARMAR' },
  applicationNumber: { en: 'Application numbers', gu: 'એપ્લિકેશન નંબર', example: '9876543210\tNP-GJMG25-1234567\n9876501234\tNP-GJMG25-7654321' },
};
const RESULT = {
  ok: ['ok', 'Will be saved'],
  same: ['', 'Already saved'],
  notFound: ['no', 'Not found'],
  ambiguous: ['warn', 'Shared number'],
  bad: ['no', 'Cannot read'],
};

export default function BulkPaste({ onChanged }) {
  const [field, setField] = useState('inverterSerial');
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (apply) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/bulk', { field, text, apply });
      setResult(r);
      if (apply) onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const okCount = result ? result.rows.filter((r) => r.result === 'ok').length : 0;

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1><T en="Names & serial numbers" gu="નામ અને સીરીયલ નંબર" /></h1>
          <p className="prose">
            Copy two columns from Excel, the mobile number and then the value, and paste them here. One customer per line.
            Check first; nothing is saved until you press Save.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body form">
          <div className="seg" role="group" aria-label="What are you pasting?">
            {Object.entries(FIELDS).map(([k, f]) => (
              <button key={k} type="button" aria-pressed={field === k} onClick={() => { setField(k); setResult(null); }}>
                <span><T en={f.en} gu={f.gu} /></span>
              </button>
            ))}
          </div>
          <textarea
            rows="10"
            aria-label="Pasted lines"
            value={text}
            onChange={(e) => { setText(e.target.value); setResult(null); }}
            placeholder={FIELDS[field].example}
          />
          <div className="row">
            <button className="btn" disabled={busy || !text.trim()} onClick={() => run(false)}><T en="Check" gu="તપાસો" /></button>
            <button className="btn primary" disabled={busy || !result || result.applied || !okCount} onClick={() => run(true)}>
              {okCount ? `Save ${okCount} ${okCount === 1 ? 'value' : 'values'}` : 'Save'} <span className="gu" lang="gu">સેવ કરો</span>
            </button>
            {result?.applied && <span className="saved"><Check size={15} strokeWidth={3} /> Saved {result.saved}</span>}
          </div>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      {result && (
        <div className="panel table-scroll">
          <table className="grid">
            <thead>
              <tr><th>Line</th><th>Mobile</th><th>Customer</th><th>Value</th><th>Result</th></tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.line}>
                  <td className="num">{r.line}</td>
                  <td>{r.mobile}</td>
                  <td lang="gu">{r.name || (r.names || []).join(', ') || '—'}</td>
                  <td>
                    {r.value}
                    {r.result === 'ok' && r.old && <div className="sub">replaces {r.old}</div>}
                  </td>
                  <td>
                    <span className={`pill ${RESULT[r.result][0]}`}>{result.applied && r.result === 'ok' ? 'Saved' : RESULT[r.result][1]}</span>
                    {r.message && <div className="sub">{r.message}</div>}
                  </td>
                </tr>
              ))}
              {!result.rows.length && <tr><td colSpan="5" className="empty-row">No lines to read. Paste the two columns from Excel.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
