import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

const EXAMPLES = [
  'customers of village Pipalav with files ready',
  'not ready, missing DCR',
  'printed but not sent',
  'solaryaan without serial',
  'above 4 kW adani ready to print',
  'how many in Petlad',
];
const PAGE = 25;

/** One answer: what was understood (chips), how many, and the customers. */
function Answer({ a }) {
  const [shown, setShown] = useState(PAGE);
  if (a.error) return <Notice>{a.error}</Notice>;
  return (
    <section className="panel ask-answer">
      <div className="panel-body">
        <div className="ask-head">
          <b>
            {a.total === 0 ? 'No customer matches' : a.total === 1 ? '1 customer' : `${a.total.toLocaleString('en-IN')} customers`}
            {a.limit > 0 && a.total > a.limit ? ` (showing the first ${a.limit})` : ''}
          </b>
          {a.filters.length > 0 && (
            <span className="chips">
              {a.filters.map((f) => <span className="chip static" key={f}>{f}</span>)}
            </span>
          )}
        </div>
        {a.notes.map((n) => <p key={n} className="muted ask-note">{n}</p>)}
      </div>
      {a.rows.length > 0 && (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th><T en="Name" gu="નામ" /></th>
                <th><T en="Village" gu="ગામ" /></th>
                <th>Mobile</th>
                <th className="r">kW</th>
                <th><T en="Status" gu="સ્થિતિ" /></th>
                <th>Still missing</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.slice(0, shown).map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/customer/${r.id}`} className="name" lang="gu">{r.name}</Link>
                    {r.english && <div className="sub">{r.english}</div>}
                  </td>
                  <td lang="gu" className="nw">{r.village}<div className="sub">{r.taluka}</div></td>
                  <td className="nw">{r.mobile}</td>
                  <td className="r">{r.kw ?? ''}</td>
                  <td className="nw">
                    <span className={`pill ${r.ready ? 'ok' : 'no'}`}>{r.ready ? 'Ready' : 'Not ready'}</span>{' '}
                    {r.printed && <span className="pill ok">Printed</span>}{' '}
                    {r.sent && <span className="pill ok">Sent</span>}
                  </td>
                  <td>{r.missing.length ? r.missing.join(', ') : <span className="muted">nothing</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.rows.length > shown && (
        <div className="table-foot">
          <span>Showing {shown} of {a.rows.length}{a.total > a.rows.length ? ` (${a.total} match)` : ''}</span>
          <button className="btn small" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, a.rows.length - shown)} more</button>
        </div>
      )}
    </section>
  );
}

/** Ask in plain words, get the customers: a simple chat over the filters, no AI. */
export default function Ask() {
  const [chat, setChat] = useState([]); // [{ q, a }]
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat, busy]);

  const send = async (q) => {
    q = q.trim();
    if (!q || busy) return;
    setText('');
    setBusy(true);
    let a;
    try {
      a = await api.post('/ask', { q });
    } catch (e) {
      a = { error: e.message };
    }
    setChat((c) => [...c, { q, a }]);
    setBusy(false);
  };

  return (
    <div className="page ask">
      <div className="page-head">
        <div>
          <h1><T en="Ask" gu="પૂછો" /></h1>
          <p className="prose">
            Write what you want to see, in plain words. The app finds the filters in your sentence, shows what it understood, and lists
            the customers. You can combine as many as you like: village, files ready or not, missing DCR / FL / Agreement / serial,
            printed, sent, brand, kW, sheet, name or mobile number.
          </p>
        </div>
        {chat.length > 0 && <button className="btn quiet small" onClick={() => setChat([])}><Trash2 size={15} /> Clear</button>}
      </div>

      <div className="ask-chat">
        {chat.length === 0 && (
          <div className="panel"><div className="panel-body">
            <b>Try one:</b>
            <div className="chips" style={{ marginTop: 10 }}>
              {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => send(e)}>{e}</button>)}
            </div>
          </div></div>
        )}
        {chat.map((m, i) => (
          <div key={i} className="ask-turn">
            <div className="ask-q">{m.q}</div>
            <Answer a={m.a} />
          </div>
        ))}
        {busy && <p className="muted">Looking…</p>}
        <div ref={end} />
      </div>

      <form className="ask-box" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="For example: customers of village Pipalav with files ready"
          aria-label="Ask a question"
          autoFocus
        />
        <button className="btn primary" disabled={busy || !text.trim()}><Send size={16} /> Ask</button>
      </form>
    </div>
  );
}
