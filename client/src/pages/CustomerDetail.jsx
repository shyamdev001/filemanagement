import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronLeft, Eye, FileDown, FileText, Trash2, Upload } from 'lucide-react';
import { api, datasheetUrl, fileName } from '../api.js';
import { Notice, Problems, ReadyPill, T } from '../ui.jsx';

const DocStatus = ({ doc }) =>
  doc.ok ? (
    <span className="pill ok"><Check size={13} strokeWidth={3} /> Ready</span>
  ) : (
    <span className="pill no">Not ready</span>
  );

const FileLink = ({ file }) => (
  <a className="file-link" href={datasheetUrl(file)} target="_blank" rel="noreferrer">
    <FileText size={15} /> {fileName(file)}
  </a>
);

const UPLOADS = [
  { type: 'dcr', en: 'DCR certificate', gu: 'DCR સર્ટિફિકેટ' },
  { type: 'agreement', en: 'Model Agreement', gu: 'મોડલ એગ્રીમેન્ટ' },
  { type: 'fl', en: 'Feasibility Letter (FL)', gu: 'ફિઝિબિલિટી લેટર' },
];

/** One uploaded document: drop a PDF on the row, or choose it. */
function UploadSlot({ n, slot, doc, customerId, stamp, onDone, onError }) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const url = `/customers/${customerId}/uploads/${slot.type}`;

  const send = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) return onError('Please choose a PDF file.');
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const d = await api.post(url, body);
      onDone(d.customer, `${slot.en} uploaded`);
      if (d.warning) onError(d.warning);
    } catch (e) {
      onError(e.message);
    }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm(`Remove the ${slot.en} from this customer?`)) return;
    try {
      onDone((await api.del(url)).customer, `${slot.en} removed`);
    } catch (e) {
      onError(e.message);
    }
  };

  return (
    <div
      className={`doc ${doc.ok ? 'ok' : 'no'}${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files[0]); }}
    >
      <div className="doc-n">{n}</div>
      <div className="doc-main">
        <div className="doc-title"><h3><T en={slot.en} gu={slot.gu} /></h3><DocStatus doc={doc} /></div>
        <span className="hint">
          {busy
            ? 'Uploading…'
            : doc.ok
              ? `${doc.originalName} · uploaded ${new Date(doc.uploadedAt).toLocaleDateString('en-IN')}`
              : 'Drag the PDF from the portal onto this row, or choose it. Always the original signed copy.'}
        </span>
      </div>
      <div className="doc-side">
        {doc.ok && <a className="btn small" href={`/api${url}?t=${stamp}`} target="_blank" rel="noreferrer"><Eye size={15} /> Preview</a>}
        <label className={doc.ok ? 'btn small' : 'btn small primary'} aria-disabled={busy}>
          <Upload size={15} /> {doc.ok ? 'Replace' : 'Upload PDF'}
          <input type="file" accept=".pdf,application/pdf" hidden disabled={busy} onChange={(e) => { send(e.target.files[0]); e.target.value = ''; }} />
        </label>
        {doc.ok && <button className="btn quiet small" aria-label={`Remove ${slot.en}`} title="Remove" onClick={remove}><Trash2 size={15} /></button>}
      </div>
    </div>
  );
}

export default function CustomerDetail({ customers, onChanged }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({ englishName: '', inverterSerial: '', warrantyModel: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  // Changes after each save so the PDF links are not served from the browser cache.
  const [stamp, setStamp] = useState(Date.now());

  const take = (customer) => {
    setC(customer);
    setForm({
      englishName: customer.englishName || '',
      inverterSerial: customer.inverterSerial || '',
      warrantyModel: customer.warrantyModel || '',
    });
    setStamp(Date.now());
  };

  useEffect(() => {
    // Show the customer at once from the list already in memory, then refresh quietly.
    const known = (customers || []).find((x) => x._id === id);
    if (known) take(known);
    else setC(null);
    api.get(`/customers/${id}`).then((d) => take(d.customer)).catch((e) => setError(e.message));
    api.get('/settings/datasheets').then((d) => setFiles(d.files)).catch(() => {});
  }, [id]);

  const save = async (changes, done = 'Saved') => {
    setError('');
    try {
      const d = await api.patch(`/customers/${id}`, changes);
      take(d.customer);
      setMsg(done);
      setTimeout(() => setMsg(''), 2500);
      onChanged(d.customer);
    } catch (e) {
      setError(e.message);
    }
  };

  if (error && !c) return <div className="page narrow"><Notice>{error}</Notice></div>;
  if (!c) return <div className="page"><p className="muted">Loading customer…</p></div>;

  const st = c.status;
  const isWarranty = st.inverter.type === 'warranty';
  const dirty =
    form.englishName !== (c.englishName || '') ||
    form.inverterSerial !== (c.inverterSerial || '') ||
    form.warrantyModel !== (c.warrantyModel || '');
  const pdf = (name) => `/api/customers/${c._id}/${name}.pdf?t=${stamp}`;
  const cls = (doc) => `doc ${doc.ok ? 'ok' : 'no'}`;

  return (
    <div className="page">
      <button className="btn quiet small crumb" onClick={() => navigate(-1)}>
        <ChevronLeft size={16} /> <T en="Customers" gu="ગ્રાહકો" />
      </button>

      <div className="page-head cust-head">
        <div>
          <h1 lang="gu">{c.name}</h1>
          <div className="cust-meta">
            {c.englishNameShown && <span>{c.englishNameShown}</span>}
            <span lang="gu">{[c.village, c.taluka].filter(Boolean).join(', ')}</span>
            <span>{c.mobile || 'no mobile'}</span>
            <span>{c.sheet}, Excel row {c.excelRow}</span>
          </div>
        </div>
        <div className="head-actions">
          {c.printedAt && (
            <span className="pill ok big" title="Click Undo to mark this customer as not printed">
              Printed · batch {c.printBatch}
              <button className="pill-x" aria-label="Mark as not printed" onClick={() => window.confirm('Mark this customer as NOT printed?') && save({ printed: false }, 'Marked as not printed')}>Undo</button>
            </span>
          )}
          <ReadyPill ok={st.ready} big />
          <a className="btn primary" href={pdf('file')} target="_blank" rel="noreferrer">
            <FileDown size={17} /> <T en="Open customer file" gu="ફાઈલ ખોલો" />
          </a>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}
      {!c.inExcel && <Notice kind="warn">This customer is no longer in the Excel file. Nothing was deleted; check the Excel sheet.</Notice>}
      {c.issues?.length > 0 && (
        <Notice kind="warn">
          <b>Fix in Excel, then import again:</b> {c.issues.join(' · ')}
        </Notice>
      )}

      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2><T en="Documents in the file" gu="ફાઈલના દસ્તાવેજો" /></h2>
            {msg && !isWarranty ? <span className="saved"><Check size={15} strokeWidth={3} /> {msg}</span> : <span className="hint">in print order</span>}
          </div>

          <div className={cls(st.payee)}>
            <div className="doc-n">1</div>
            <div className="doc-main">
              <div className="doc-title"><h3><T en="Payee certificate" gu="પેયી સર્ટિફિકેટ" /></h3><DocStatus doc={st.payee} /></div>
              <Problems items={st.payee.problems} />
            </div>
            <div className="doc-side">
              <a className="btn small" href={pdf('payee')} target="_blank" rel="noreferrer"><Eye size={15} /> Preview</a>
            </div>
          </div>

          <div className={cls(st.datasheet)}>
            <div className="doc-n">2</div>
            <div className="doc-main">
              <div className="doc-title"><h3><T en="Panel datasheet" gu="પેનલ ડેટાશીટ" /></h3><DocStatus doc={st.datasheet} /></div>
              <Problems items={st.datasheet.problems} />
              {st.datasheet.files.map((f) => <FileLink key={f} file={f} />)}
              {!st.datasheet.manual && (
                <p className="muted" style={{ fontSize: 13.5, margin: "4px 0" }}>
                  {st.datasheet.source === 'dcr' ? <>Chosen from the DCR certificate: {st.datasheet.dcr.join(', ')}</> : <>Chosen from the Excel panel: {c.panelRaw || '–'}</>}
                </p>
              )}
              {(st.datasheet.notes || []).map((n) => <p key={n} className="muted" style={{ fontSize: 13.5, margin: "4px 0" }}>{n}</p>)}
              <label className="pick">
                {st.datasheet.manual ? 'Chosen by hand for this customer. Add another:' : 'Wrong or missing? Choose by hand for this customer only:'}
                <select
                  value=""
                  onChange={(e) => e.target.value && save({ manualDatasheets: [...(c.manualDatasheets || []), e.target.value] }, 'Datasheet added')}
                >
                  <option value="">Add a datasheet…</option>
                  {files.filter((f) => !(c.manualDatasheets || []).includes(f)).map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            </div>
            <div className="doc-side">
              {st.datasheet.manual && (
                <button className="btn small" onClick={() => save({ manualDatasheets: [] }, 'Back to automatic')}>Use automatic</button>
              )}
            </div>
          </div>

          <div className={cls(st.inverter)}>
            <div className="doc-n">3</div>
            <div className="doc-main">
              <div className="doc-title">
                <h3>{isWarranty ? <T en="Inverter warranty card" gu="ઇન્વર્ટર વોરંટી કાર્ડ" /> : <T en="Inverter datasheet" gu="ઇન્વર્ટર ડેટાશીટ" />}</h3>
                <DocStatus doc={st.inverter} />
              </div>
              <Problems items={st.inverter.problems} />
              {st.inverter.files.map((f) => <FileLink key={f} file={f} />)}
              {!isWarranty && (
                <label className="pick">
                  Choose by hand for this customer only:
                  <select value={c.manualInverterDatasheet || ''} onChange={(e) => save({ manualInverterDatasheet: e.target.value })}>
                    <option value="">Automatic (from Datasheets settings)</option>
                    {files.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="doc-side">
              {isWarranty && <a className="btn small" href={pdf('warranty')} target="_blank" rel="noreferrer"><Eye size={15} /> Preview</a>}
            </div>
          </div>

          {UPLOADS.map((slot, i) => (
            <UploadSlot
              key={slot.type}
              n={i + 4}
              slot={slot}
              doc={st[slot.type]}
              customerId={c._id}
              stamp={stamp}
              onError={setError}
              onDone={(customer, done) => {
                take(customer);
                setError('');
                setMsg(done);
                setTimeout(() => setMsg(''), 2500);
                onChanged(customer);
              }}
            />
          ))}
        </section>

        <div className="stack">
          {isWarranty && (
            <section className="panel">
              <div className="panel-head">
                <h2><T en="For the warranty card" gu="વોરંટી કાર્ડ માટે" /></h2>
                {msg && <span className="saved"><Check size={15} strokeWidth={3} /> {msg}</span>}
              </div>
              <form
                className="panel-body form"
                onSubmit={(e) => {
                  e.preventDefault();
                  save(form);
                }}
              >
                <label className="field">
                  <span><T en="English name" gu="અંગ્રેજી નામ" /></span>
                  <input type="text" value={form.englishName} onChange={(e) => setForm({ ...form, englishName: e.target.value })} placeholder={st.inverter.englishName || 'RAMESHBHAI SOMABHAI PATEL'} />
                  <span className="hint">
                    {st.inverter.englishNameAuto
                      ? <>The card will print <b>{st.inverter.englishName}</b>, made automatically from the Gujarati name. Type here only if the spelling is wrong.</>
                      : 'Typed by hand. Clear it to go back to the automatic spelling.'}
                  </span>
                </label>
                <label className="field">
                  <span><T en="Inverter serial number" gu="ઇન્વર્ટર સીરીયલ નંબર" /></span>
                  <input type="text" value={form.inverterSerial} onChange={(e) => setForm({ ...form, inverterSerial: e.target.value })} placeholder="119116126G00001" />
                </label>
                <label className="field">
                  <span><T en="Model No." gu="મોડલ નંબર" /></span>
                  <input type="text" value={form.warrantyModel} onChange={(e) => setForm({ ...form, warrantyModel: e.target.value })} placeholder={st.inverter.model || 'from Excel'} />
                  <span className="hint">Leave empty to use the model worked out from Excel.</span>
                </label>
                <div>
                  <button className="btn primary" disabled={!dirty}><T en="Save" gu="સેવ કરો" /></button>
                </div>
              </form>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2><T en="Portal and paper" gu="પોર્ટલ અને કાગળ" /></h2>
            </div>
            <div className="panel-body checks">
              <label className="field">
                <span><T en="Application number" gu="એપ્લિકેશન નંબર" /></span>
                <input
                  key={c.applicationNumber || ''}
                  type="text"
                  defaultValue={c.applicationNumber || ''}
                  placeholder="NP-GJMG25-…"
                  onBlur={(e) => e.target.value.trim().toUpperCase() !== (c.applicationNumber || '') && save({ applicationNumber: e.target.value.trim() }, 'Application number saved')}
                />
                <span className="hint">Filled in by itself from the FL. The Agreement and DCR are matched to the customer by this number.</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={!!c.billAttached} onChange={(e) => save({ billAttached: e.target.checked })} />
                <span><T en="Bill is in the file" gu="બીલ ફાઈલમાં છે" /></span>
              </label>
              <label className="check">
                <input type="checkbox" checked={!!c.insuranceAttached} onChange={(e) => save({ insuranceAttached: e.target.checked })} />
                <span><T en="Insurance policy is in the file" gu="વીમા પોલિસી ફાઈલમાં છે" /></span>
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2><T en="From Excel" gu="એક્સેલમાંથી" /></h2></div>
            <div className="panel-body">
              <dl className="facts">
                <dt><T en="Village" gu="ગામ" /></dt><dd lang="gu">{c.village || '—'}</dd>
                <dt><T en="Taluka" gu="તાલુકો" /></dt><dd lang="gu">{c.taluka || '—'}</dd>
                <dt><T en="Mobile" gu="મોબાઈલ" /></dt><dd>{(c.mobiles || []).join(', ') || '—'}</dd>
                <dt><T en="System size" gu="સિસ્ટમ સાઈઝ" /></dt><dd>{c.kw ?? '—'} kW</dd>
                <dt><T en="Panels" gu="પેનલ" /></dt><dd lang="gu">{c.panelCount ?? '—'} × {c.panelRaw || '—'}</dd>
                <dt><T en="Inverter" gu="ઇન્વર્ટર" /></dt><dd lang="gu">{c.inverterRaw || '—'}</dd>
                <dt><T en="Installer" gu="ઇન્સ્ટોલર" /></dt><dd lang="gu">{c.installer || '—'}</dd>
                <dt><T en="Note" gu="નોંધ" /></dt><dd lang="gu">{c.note || '—'}</dd>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
