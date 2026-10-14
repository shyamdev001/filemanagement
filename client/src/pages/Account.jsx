import { useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

/** The signed-in staff member's own profile and password. */
export default function Account({ me }) {
  const [f, setF] = useState({ current: '', password: '', again: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.again) return setError('The two new passwords are not the same.');
    try {
      await api.post('/me/password', { current: f.current, password: f.password });
      setF({ current: '', password: '', again: '' });
      setError('');
      setMsg('Password changed');
    } catch (err) {
      setError(err.message);
    }
  };

  if (!me) return null;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1><T en="My account" gu="મારું એકાઉન્ટ" /></h1>
        </div>
      </div>
      <div className="split">
        <section className="panel">
          <div className="panel-head"><h2><T en="Profile" gu="પ્રોફાઇલ" /></h2></div>
          <div className="panel-body">
            <dl className="facts">
              <dt><T en="Name" gu="નામ" /></dt><dd>{me.name}</dd>
              <dt><T en="Username" gu="યુઝરનેમ" /></dt><dd>{me.username}</dd>
              <dt><T en="Mobile" gu="મોબાઈલ" /></dt><dd>{me.mobile || '—'}</dd>
              <dt><T en="Role" gu="રોલ" /></dt><dd>{me.admin ? 'Admin' : 'Staff'}</dd>
            </dl>
            <p className="muted" style={{ marginTop: 12 }}>To change your name or mobile number, ask an admin (Staff page).</p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2><T en="Change password" gu="પાસવર્ડ બદલો" /></h2>
            {msg && <span className="saved"><Check size={15} strokeWidth={3} /> {msg}</span>}
          </div>
          <form className="panel-body form" onSubmit={submit}>
            <label className="field">
              <span><T en="Current password" gu="હાલનો પાસવર્ડ" /></span>
              <input type="password" value={f.current} onChange={set('current')} autoComplete="current-password" required />
            </label>
            <label className="field">
              <span><T en="New password" gu="નવો પાસવર્ડ" /></span>
              <input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" minLength={6} required />
              <span className="hint">At least 6 characters. You stay signed in here; other computers are signed out.</span>
            </label>
            <label className="field">
              <span><T en="New password again" gu="નવો પાસવર્ડ ફરીથી" /></span>
              <input type="password" value={f.again} onChange={set('again')} autoComplete="new-password" required />
            </label>
            {error && <Notice>{error}</Notice>}
            <div><button className="btn primary"><T en="Change password" gu="પાસવર્ડ બદલો" /></button></div>
          </form>
        </section>
      </div>
    </div>
  );
}
