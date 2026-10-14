import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Printer, Search } from 'lucide-react';
import { Mark, ReadyPill, T } from '../ui.jsx';

const PAGE = 50;
const SHEET_ORDER = ['residential', 'pashupalak', 'commercial'];
const GU = '૦૧૨૩૪૫૬૭૮૯';
const ascii = (s) => String(s || '').replace(/[૦-૯]/g, (d) => GU.indexOf(d)).toLowerCase();
const n = (v) => v.toLocaleString('en-IN');

const HEADS = (
  <tr>
    <th>No.</th>
    <th><T en="Name" gu="નામ" /></th>
    <th><T en="Village" gu="ગામ" /></th>
    <th><T en="Mobile" gu="મોબાઈલ" /></th>
    <th className="r">kW</th>
    <th><T en="Panel" gu="પેનલ" /></th>
    <th><T en="Inverter" gu="ઇન્વર્ટર" /></th>
    <th className="d" title="Payee certificate">Payee</th>
    <th className="d" title="Panel datasheet">Sheet</th>
    <th className="d" title="Inverter warranty card or datasheet">Inv.</th>
    <th className="d" title="DCR certificate">DCR</th>
    <th className="d" title="Model Agreement">Agr.</th>
    <th className="d" title="Feasibility Letter">FL</th>
    <th className="d" title="Bill and insurance policy put in the file by hand">Bill · Ins.</th>
    <th><T en="Status" gu="સ્થિતિ" /></th>
    <th aria-label="Open" />
  </tr>
);

export default function Customers({ customers }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const sheet = params.get('sheet') || 'all';
  const q = params.get('q') || '';
  const show = params.get('show') || 'all';
  const page = Number(params.get('page')) || 1;

  const set = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ page: '', ...changes })) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  // Same order as the sheets in the Excel file.
  const sheets = useMemo(() => {
    const found = [...new Set((customers || []).map((c) => c.sheet))];
    const rank = (s) => (SHEET_ORDER.indexOf(s.toLowerCase()) + 1 || 99);
    return found.sort((a, b) => rank(a) - rank(b));
  }, [customers]);

  const inSheet = useMemo(
    () =>
      [...(customers || [])]
        .filter((c) => sheet === 'all' || c.sheet === sheet)
        .sort((a, b) => sheets.indexOf(a.sheet) - sheets.indexOf(b.sheet) || a.excelRow - b.excelRow),
    [customers, sheets, sheet]
  );

  const rows = useMemo(() => {
    const needle = ascii(q.trim());
    return inSheet.filter((c) => {
      if (show === 'ready' && !c.status.ready) return false;
      if (show === 'notready' && c.status.ready) return false;
      if (show === 'printed' && !c.printedAt) return false;
      if (!needle) return true;
      return ascii([c.name, c.village, c.taluka, c.englishNameShown, c.inverterSerial, c.applicationNumber, ...(c.mobiles || [])].join(' ')).includes(needle);
    });
  }, [inSheet, q, show]);

  if (!customers) {
    return (
      <div className="page">
        <div className="page-head"><h1><T en="Customers" gu="ગ્રાહકો" /></h1></div>
        <div className="panel table-scroll" aria-busy="true">
          <table className="grid skeleton">
            <thead>{HEADS}</thead>
            <tbody>
              {Array.from({ length: 10 }, (_, i) => (
                <tr key={i}>{Array.from({ length: 16 }, (_, j) => <td key={j}><span style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (!customers.length) {
    return (
      <div className="page narrow">
        <div className="panel empty">
          <div className="drop-icon"><FileSpreadsheet size={26} /></div>
          <h2>No customers yet</h2>
          <p>Import the Excel working list and every customer will appear here with the documents that are ready or missing.</p>
          <Link className="btn primary" to="/import"><T en="Import Excel" gu="એક્સેલ ઈમ્પોર્ટ" /></Link>
        </div>
      </div>
    );
  }

  const readyCount = inSheet.filter((c) => c.status.ready).length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const first = (current - 1) * PAGE;
  const visible = rows.slice(first, first + PAGE);

  const tiles = [
    { id: 'all', en: 'All customers', gu: 'બધા ગ્રાહકો', value: inSheet.length, dot: '' },
    { id: 'ready', en: 'Ready to print', gu: 'તૈયાર', value: readyCount, dot: 'ok' },
    { id: 'notready', en: 'Not ready', gu: 'બાકી', value: inSheet.length - readyCount, dot: 'no' },
    { id: 'printed', en: 'Printed', gu: 'પ્રિન્ટ થયેલ', value: inSheet.filter((c) => c.printedAt).length, dot: 'ok' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1><T en="Customers" gu="ગ્રાહકો" /></h1>
      </div>

      <div className="panel summary">
        {tiles.map((t) => (
          <button key={t.id} aria-pressed={show === t.id} onClick={() => set({ show: t.id === 'all' ? '' : t.id })}>
            <span className="k"><i className={`dot ${t.dot}`} /><span><T en={t.en} gu={t.gu} /></span></span>
            <span className="v">{n(t.value)}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Sheet">
          {['all', ...sheets].map((s) => (
            <button key={s} aria-pressed={sheet === s} onClick={() => set({ sheet: s === 'all' ? '' : s })}>
              {s === 'all' ? 'All sheets' : s}
              <span className="n">{n(customers.filter((c) => s === 'all' || c.sheet === s).length)}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search customers"
            placeholder="Search name, village or mobile  ·  શોધો"
            value={q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>
      </div>

      <div className="panel">
        <div className="table-scroll">
          <table className="grid rows">
            <thead>{HEADS}</thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c._id}
                  className={c.inExcel ? '' : 'gone'}
                  tabIndex={0}
                  onClick={() => navigate(`/customer/${c._id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/customer/${c._id}`)}
                >
                  <td className="num">{c.srNo}</td>
                  <td>
                    <div className="name" lang="gu">{c.name}</div>
                    {c.englishNameShown && <div className="sub">{c.englishNameShown}</div>}
                    {!c.inExcel && <div className="sub warn">No longer in Excel</div>}
                  </td>
                  <td lang="gu" className="nw">
                    {c.village}
                    <div className="sub">{c.taluka}</div>
                  </td>
                  <td>{c.mobile || <span className="sub warn">missing</span>}</td>
                  <td className="r">{c.kw}</td>
                  <td lang="gu" className="wrap">{c.panelRaw}</td>
                  <td lang="gu" className="nw">{c.inverterRaw}</td>
                  <td className="d"><Mark doc={c.status.payee} label="Payee certificate" /></td>
                  <td className="d"><Mark doc={c.status.datasheet} label="Panel datasheet" /></td>
                  <td className="d"><Mark doc={c.status.inverter} label={c.status.inverter.type === 'warranty' ? 'Warranty card' : 'Inverter datasheet'} /></td>
                  <td className="d"><Mark doc={c.status.dcr} label="DCR certificate" /></td>
                  <td className="d"><Mark doc={c.status.agreement} label="Model Agreement" /></td>
                  <td className="d"><Mark doc={c.status.fl} label="Feasibility Letter" /></td>
                  <td className="d nw">
                    <i className={`dot ${c.status.bill?.inFile ? 'ok' : 'off'}`} title={c.status.bill?.uploaded ? 'Bill uploaded, printed with the file' : c.billAttached ? 'Paper bill added by hand' : 'No bill (optional)'} />{' '}
                    <i className={`dot ${c.status.insurance?.inFile ? 'ok' : 'off'}`} title={c.status.insurance?.uploaded ? 'Insurance policy uploaded, printed with the file' : c.insuranceAttached ? 'Paper policy added by hand' : 'No insurance policy (optional)'} />
                  </td>
                  <td className="nw">
                    {c.printedAt ? <span className="pill ok" title={`Batch ${c.printBatch}`}><Printer size={13} /> Printed</span> : <ReadyPill ok={c.status.ready} />}
                  </td>
                  <td><ChevronRight size={18} className="go" /></td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan="16" className="empty-row">
                    No customer matches this search. Try the mobile number, or part of the name or village.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>
            {rows.length ? `Showing ${n(first + 1)}–${n(first + visible.length)} of ${n(rows.length)}` : 'Nothing to show'}
          </span>
          <div className="row">
            <button className="btn small" disabled={current <= 1} onClick={() => set({ page: String(current - 1) })}>
              <ChevronLeft size={16} /> Previous
            </button>
            <span>Page {current} of {pages}</span>
            <button className="btn small" disabled={current >= pages} onClick={() => set({ page: String(current + 1) })}>
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
