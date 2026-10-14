import { useState } from 'react';
import { api } from '../api.js';
import { BrandMark, Notice, T } from '../ui.jsx';

/** Sign in with your own username and password. The very first time, make the admin account instead. */
export default function Login({ setup, onDone }) {
  const [f, setF] = useState({ name: '', username: '', password: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (setup && f.password !== f.again) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      if (setup) await api.post('/setup', { name: f.name, username: f.username, password: f.password });
      else await api.post('/login', { username: f.username, password: f.password });
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <div className="login-wrap">
      <form className="login panel" onSubmit={submit}>
        <div className="login-brand">
          <BrandMark size={40} />
          <div>
            <h2>Solar Files</h2>
            <div className="sub" lang="gu">સોલાર ગ્રાહક ફાઈલ</div>
          </div>
        </div>
        {setup && (
          <>
            <p className="prose" style={{ margin: 0 }}>
              <b>First time here.</b> Make the admin account. The admin then adds an account for every staff member on the Staff page.
            </p>
            <label className="field">
              <span><T en="Your name" gu="તમારું નામ" /></span>
              <input type="text" value={f.name} onChange={set('name')} autoFocus required />
            </label>
          </>
        )}
        <label className="field">
          <span><T en="Username" gu="યુઝરનેમ" /></span>
          <input type="text" value={f.username} onChange={set('username')} autoFocus={!setup} autoCapitalize="none" autoComplete="username" required />
          {setup && <span className="hint">Short, no spaces, for example ramesh</span>}
        </label>
        <label className="field">
          <span><T en="Password" gu="પાસવર્ડ" /></span>
          <input type="password" value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} required />
          {setup && <span className="hint">At least 6 characters</span>}
        </label>
        {setup && (
          <label className="field">
            <span><T en="Password again" gu="પાસવર્ડ ફરીથી" /></span>
            <input type="password" value={f.again} onChange={set('again')} autoComplete="new-password" required />
          </label>
        )}
        {error && <Notice>{error}</Notice>}
        <button className="btn primary" disabled={busy}>
          {setup ? <T en="Make the admin account" gu="એડમિન એકાઉન્ટ બનાવો" /> : <T en="Log in" gu="લોગ ઇન" />}
        </button>
      </form>
    </div>
  );
}
