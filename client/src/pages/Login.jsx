import { useState } from 'react';
import { api } from '../api.js';
import { BrandMark, Notice, T } from '../ui.jsx';

export default function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/login', { password });
      onDone();
    } catch (err) {
      setError(err.message);
    }
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
        <label className="field">
          <span><T en="Password" gu="પાસવર્ડ" /></span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {error && <Notice>{error}</Notice>}
        <button className="btn primary"><T en="Log in" gu="લોગ ઇન" /></button>
      </form>
    </div>
  );
}
