import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

export const SHEETS = ['Residential', 'PASHUPALAK', 'commercial'];

const FIELDS = [
  { k: 'name', en: 'Name', gu: 'નામ', lang: 'gu', required: true },
  { k: 'village', en: 'Village', gu: 'ગામ', lang: 'gu' },
  { k: 'taluka', en: 'Taluka', gu: 'તાલુકો', lang: 'gu' },
  { k: 'mobiles', en: 'Mobile', gu: 'મોબાઈલ', hint: 'Two numbers: separate them with a comma', inputMode: 'tel' },
  { k: 'kw', en: 'System size (kW)', gu: 'કિલો વોટ', inputMode: 'decimal', placeholder: '3.24' },
  { k: 'panelCount', en: 'Panel count', gu: 'પેનલ નંગ', inputMode: 'numeric', placeholder: '6' },
  { k: 'panelRaw', en: 'Panel', gu: 'પેનલ', lang: 'gu', hint: 'As in the Excel, for example અદાણી ૫૪૫ વોટ or વારી ટોપકોન ૫૮૫', placeholder: 'અદાણી ૫૪૫ વોટ' },
  { k: 'inverterRaw', en: 'Inverter', gu: 'ઇન્વર્ટર', lang: 'gu', hint: 'As in the Excel, for example સોલારયાન ૩.૬ or VELOX 3.3', placeholder: 'સોલારયાન ૩.૬' },
  { k: 'installer', en: 'Installer', gu: 'ઇન્સ્ટોલર', lang: 'gu' },
  { k: 'note', en: 'Excel note', gu: 'નોંધ', lang: 'gu' },
];

export const toForm = (c = {}) => ({
  name: c.name || '',
  village: c.village || '',
  taluka: c.taluka || '',
  mobiles: (c.mobiles || []).join(', '),
  kw: c.kw ?? '',
  panelCount: c.panelCount ?? '',
  panelRaw: c.panelRaw || '',
  inverterRaw: c.inverterRaw || '',
  installer: c.installer || '',
  note: c.note || '',
});

/** The customer's details as a form: used to correct an Excel customer and to add a new one. */
export function DetailsForm({ value, onChange, edited = {} }) {
  return (
    <div className="details-grid">
      {FIELDS.map((f) => (
        <label key={f.k} className={`field${f.k === 'name' || f.k === 'note' ? ' wide' : ''}`}>
          <span>
            <T en={f.en} gu={f.gu} />
            {edited[f.k] && <em className="edited-tag">changed by hand</em>}
          </span>
          <input
            type="text"
            lang={f.lang}
            inputMode={f.inputMode}
            placeholder={f.placeholder}
            required={f.required}
            value={value[f.k]}
            onChange={(e) => onChange({ ...value, [f.k]: e.target.value })}
          />
          {f.hint && <span className="hint">{f.hint}</span>}
        </label>
      ))}
    </div>
  );
}

/** Add a customer who is not in the Excel yet. When the Excel later gets them (same sheet, mobile and name), the import joins the two. */
export default function NewCustomer({ onChanged }) {
  const navigate = useNavigate();
  const [sheet, setSheet] = useState('Residential');
  const [form, setForm] = useState(toForm());
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.post('/customers', { ...form, sheet, why });
      onChanged();
      navigate(`/customer/${d.customer._id}`, { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.data?.id && window.confirm(`${err.message}. Open that customer?`)) navigate(`/customer/${err.data.id}`);
    }
    setBusy(false);
  };

  return (
    <div className="page narrow">
      <button className="btn quiet small crumb" onClick={() => navigate(-1)}>
        <ChevronLeft size={16} /> <T en="Customers" gu="ગ્રાહકો" />
      </button>
      <div className="page-head">
        <div>
          <h1><T en="Add a customer" gu="નવો ગ્રાહક ઉમેરો" /></h1>
          <p className="prose">
            For a customer who is not in the Excel yet. Everything works for them as for the others. When you later
            import an Excel that has the same person (same sheet, mobile and name), the app joins the two by itself.
          </p>
        </div>
      </div>
      <form className="panel" onSubmit={submit}>
        <div className="panel-body form">
          <label className="field">
            <span><T en="Sheet" gu="શીટ" /></span>
            <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
              {SHEETS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <DetailsForm value={form} onChange={setForm} />
          <label className="field">
            <span><T en="Note (optional)" gu="નોંધ (જરૂરી નથી)" /></span>
            <input type="text" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why added by hand, or anything staff should know" />
          </label>
          {error && <Notice>{error}</Notice>}
          <div className="row">
            <button className="btn primary" disabled={busy}><T en="Add customer" gu="ગ્રાહક ઉમેરો" /></button>
            <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  );
}
