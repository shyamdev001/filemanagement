import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { ClipboardPaste, FileSpreadsheet, FileUp, FolderCog, LogOut, Printer, Users } from 'lucide-react';
import Print from './pages/Print.jsx';
import { api } from './api.js';
import { BrandMark, Notice } from './ui.jsx';
import Customers from './pages/Customers.jsx';
import CustomerDetail from './pages/CustomerDetail.jsx';
import BulkPaste from './pages/BulkPaste.jsx';
import ImportExcel from './pages/ImportExcel.jsx';
import BulkUpload from './pages/BulkUpload.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';

const NAV = [
  { to: '/', end: true, icon: Users, en: 'Customers', gu: 'ગ્રાહકો' },
  { to: '/upload', icon: FileUp, en: 'Upload PDFs', gu: 'PDF અપલોડ' },
  { to: '/print', icon: Printer, en: 'Print files', gu: 'ફાઈલ પ્રિન્ટ' },
  { to: '/bulk', icon: ClipboardPaste, en: 'Names & serials', gu: 'નામ અને સીરીયલ નંબર' },
  { to: '/import', icon: FileSpreadsheet, en: 'Import Excel', gu: 'એક્સેલ ઈમ્પોર્ટ' },
  { to: '/settings', icon: FolderCog, en: 'Datasheets', gu: 'ડેટાશીટ સેટિંગ' },
];

export default function App() {
  const [me, setMe] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(0);

  const reload = useCallback(async () => {
    api.get('/pending').then((d) => setWaiting(d.pending.length)).catch(() => {});
    try {
      const data = await api.get('/customers');
      setCustomers(data.customers);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const checkLogin = useCallback(async () => {
    try {
      const m = await api.get('/me');
      setMe(m);
      if (m.loggedIn) reload();
    } catch (e) {
      setError(e.message);
    }
  }, [reload]);

  useEffect(() => {
    checkLogin();
    const onNeeded = () => setMe((m) => ({ ...(m || {}), loginRequired: true, loggedIn: false }));
    window.addEventListener('login-needed', onNeeded);
    return () => window.removeEventListener('login-needed', onNeeded);
  }, [checkLogin]);

  if (me && !me.loggedIn) return <Login onDone={checkLogin} />;

  const ready = customers ? customers.filter((c) => c.status.ready).length : 0;

  return (
    <div className="app">
      <aside className="side">
        <Link to="/" className="side-brand">
          <BrandMark />
          <div>
            <b>Solar Files</b>
            <span lang="gu">સોલાર ગ્રાહક ફાઈલ</span>
          </div>
        </Link>
        <nav className="side-nav" aria-label="Main">
          {NAV.map(({ to, end, icon: Icon, en, gu }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'side-link active' : 'side-link')}>
              <Icon size={19} />
              <div>
                <b>{en}</b>
                <small lang="gu">{gu}</small>
              </div>
              {to === '/' && customers && <span className="side-count">{customers.length.toLocaleString('en-IN')}</span>}
              {to === '/upload' && waiting > 0 && <span className="side-count" title="PDFs waiting to be placed">{waiting}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {customers && (
            <div>
              <b>{ready.toLocaleString('en-IN')}</b> of {customers.length.toLocaleString('en-IN')} files ready
              <br />
              <b>{customers.filter((c) => c.printedAt).length.toLocaleString('en-IN')}</b> printed
            </div>
          )}
          {me?.loginRequired && (
            <button className="btn small on-dark" onClick={() => api.post('/logout').then(checkLogin)}>
              <LogOut size={15} /> Log out
            </button>
          )}
        </div>
      </aside>
      <main className="main">
        {error && <div className="page" style={{ marginBottom: 20 }}><Notice>{error}</Notice></div>}
        <Routes>
          <Route path="/" element={<Customers customers={customers} />} />
          <Route path="/customer/:id" element={<CustomerDetail onChanged={reload} />} />
          <Route path="/upload" element={<BulkUpload customers={customers} onChanged={reload} />} />
          <Route path="/print" element={<Print customers={customers} onChanged={reload} />} />
          <Route path="/bulk" element={<BulkPaste onChanged={reload} />} />
          <Route path="/import" element={<ImportExcel onChanged={reload} />} />
          <Route path="/settings" element={<Settings customers={customers} onChanged={reload} />} />
        </Routes>
      </main>
    </div>
  );
}
