import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, UserPlus } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

const blank = { name: '', username: '', mobile: '', password: '', admin: false };
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never');

/** Admins only: every staff member's account. Add, reset a password, make admin, switch off. */
export default function Staff({ me }) {
  const [staff, setStaff] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => api.get('/staff').then((d) => setStaff(d.staff)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const done = (text) => {
    setError('');
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
    load();
  };

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post('/staff', draft);
      setDraft(blank);
      done(`Account made for ${draft.name}. Tell them their username and password.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const change = async (s, body, text) => {
    try {
      await api.patch(`/staff/${s.id}`, body);
      done(text);
    } catch (err) {
      setError(err.message);
    }
  };

  const resetPassword = (s) => {
    const password = window.prompt(`New password for ${s.name} (at least 6 characters):`);
    if (password) change(s, { password }, `New password saved for ${s.name}. They are signed out until they use it.`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1><T en="Staff" gu="સ્ટાફ" /></h1>
          <p className="prose">
            Everyone who uses the app signs in with their own account. Add a staff member here and tell them their
            username and password; they can change the password themselves under My account.
          </p>
        </div>
        {msg && <span className="saved"><Check size={15} strokeWidth={3} /> {msg}</span>}
      </div>
      {error && <Notice>{error}</Notice>}

      <section className="panel">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr><th>Name</th><th>Username</th><th>Mobile</th><th>Role</th><th>Last login</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {(staff || []).map((s) => {
                const self = s.id === me?.id;
                return (
                  <tr key={s.id} className={s.active ? '' : 'gone'}>
                    <td><div className="name">{s.name}{self && <span className="muted"> (you)</span>}</div></td>
                    <td>{s.username}</td>
                    <td>{s.mobile || '–'}</td>
                    <td>
                      {!s.active ? <span className="pill">Switched off</span> : s.admin ? <span className="pill ok">Admin</span> : <span className="pill">Staff</span>}
                    </td>
                    <td className="nw">{when(s.lastLoginAt)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <button className="btn small" onClick={() => resetPassword(s)}><KeyRound size={14} /> New password</button>
                        {s.active && (
                          <button className="btn small" onClick={() => change(s, { admin: !s.admin }, s.admin ? `${s.name} is now staff` : `${s.name} is now an admin`)}>
                            {s.admin ? 'Make staff' : 'Make admin'}
                          </button>
                        )}
                        {!self && (
                          <button
                            className="btn small quiet"
                            onClick={() =>
                              (s.active ? window.confirm(`Switch off ${s.name}'s account? They are signed out at once. Their work stays.`) : true) &&
                              change(s, { active: !s.active }, s.active ? `${s.name} is switched off` : `${s.name} can sign in again`)
                            }
                          >
                            {s.active ? 'Switch off' : 'Switch on'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <form className="table-foot" onSubmit={add}>
          <span><b><UserPlus size={15} style={{ verticalAlign: '-2px' }} /> Add a staff member</b></span>
          <div className="row">
            <input type="text" aria-label="Name" placeholder="Name" required style={{ width: 170 }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input type="text" aria-label="Username" placeholder="Username" required autoCapitalize="none" style={{ width: 130 }} value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
            <input type="text" aria-label="Mobile" placeholder="Mobile (optional)" style={{ width: 150 }} value={draft.mobile} onChange={(e) => setDraft({ ...draft, mobile: e.target.value })} />
            <input type="text" aria-label="Password" placeholder="Password" required minLength={6} autoComplete="new-password" style={{ width: 140 }} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
            <label className="check" style={{ gap: 6 }}>
              <input type="checkbox" checked={draft.admin} onChange={(e) => setDraft({ ...draft, admin: e.target.checked })} /> Admin
            </label>
            <button className="btn primary small">Add</button>
          </div>
        </form>
      </section>
    </div>
  );
}
