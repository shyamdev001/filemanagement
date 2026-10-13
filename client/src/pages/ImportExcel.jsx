import { useEffect, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

export default function ImportExcel({ onChanged }) {
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/import/last').then((d) => setReport(d.report)).catch(() => {});
  }, []);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const d = await api.post('/import', body);
      setReport(d.report);
      setFresh(true);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1><T en="Import Excel" gu="એક્સેલ ઈમ્પોર્ટ" /></h1>
          <p className="prose">
            Choose the working list (.xlsx). The sheets Residential, PASHUPALAK and commercial are read. Import again whenever
            the Excel changes: English names and serial numbers typed here are kept.
          </p>
        </div>
      </div>

      <label className="drop">
        <div className="drop-icon"><FileSpreadsheet size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{file ? file.name : 'Choose the Excel file'}</b>
          <span className="hint">{file ? 'Press Import to read it.' : 'Click here and pick the .xlsx file.'}</span>
        </div>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files[0] || null)} />
        <button
          className="btn primary"
          disabled={!file || busy}
          onClick={(e) => {
            e.preventDefault();
            run();
          }}
        >
          {busy ? 'Importing…' : <T en="Import" gu="ઈમ્પોર્ટ કરો" />}
        </button>
      </label>
      {error && <Notice>{error}</Notice>}

      {report && (
        <>
          <div className="section-title">
            <h2>{fresh ? 'Import finished' : 'Last import'}</h2>
            <span className="hint">{report.fileName}, {new Date(report.at).toLocaleString('en-IN')}</span>
          </div>
          <div className="panel figures">
            <div><b>{report.total}</b><span>customers</span></div>
            <div><b>{report.added}</b><span>new</span></div>
            <div><b>{report.updated}</b><span>updated</span></div>
            <div><b>{report.notInExcelAnymore}</b><span>no longer in Excel</span></div>
            {report.sheets.map((s) => <div key={s.sheet}><b>{s.rows}</b><span>{s.sheet}</span></div>)}
          </div>

          {report.skipped.length > 0 && (
            <Notice>{report.skipped.map((s) => <div key={s.sheet + s.row}>{s.sheet}: {s.reason}</div>)}</Notice>
          )}

          <div className="section-title">
            <h2>Rows to fix in Excel</h2>
            <span className="pill">{report.rowsWithIssues.length}</span>
          </div>
          {report.rowsWithIssues.length ? (
            <div className="panel table-scroll">
              <table className="grid">
                <thead><tr><th>Sheet</th><th className="r">Excel row</th><th>Name</th><th>Problem</th></tr></thead>
                <tbody>
                  {report.rowsWithIssues.map((r) => (
                    <tr key={r.sheet + r.row}><td>{r.sheet}</td><td className="r">{r.row}</td><td lang="gu">{r.name}</td><td>{r.issues.join(' · ')}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">No problems found in the Excel rows.</p>}

          <div className="section-title">
            <h2>Mobile numbers used by more than one customer</h2>
            <span className="pill">{report.sharedMobiles.length}</span>
          </div>
          <p className="prose">
            These stay as separate customers. Bulk paste cannot tell them apart, so type their names and serial numbers on the customer page.
          </p>
          {report.sharedMobiles.length > 0 && (
            <div className="panel table-scroll">
              <table className="grid">
                <thead><tr><th>Mobile</th><th>Customers</th></tr></thead>
                <tbody>
                  {report.sharedMobiles.map((m) => <tr key={m.mobile}><td>{m.mobile}</td><td lang="gu">{m.names.join(' · ')}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
