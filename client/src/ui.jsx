import { AlertTriangle, Check, CircleAlert, X } from 'lucide-react';

/** English label with its Gujarati beside it. */
export const T = ({ en, gu }) => (
  <>
    {en}
    <span className="gu" lang="gu">{gu}</span>
  </>
);

/** Small round tick / cross for one document; the tooltip says what is missing. */
export const Mark = ({ doc, label }) => (
  <span
    className={doc.ok ? 'mark ok' : 'mark no'}
    role="img"
    aria-label={`${label}: ${doc.ok ? 'ready' : 'not ready'}`}
    title={doc.ok ? `${label}: ready` : `${label}:\n${doc.problems.join('\n')}`}
  >
    {doc.ok ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
  </span>
);

export const ReadyPill = ({ ok, big }) => (
  <span className={`pill ${ok ? 'ok' : 'no'}${big ? ' big' : ''}`}>
    {ok ? <Check size={big ? 15 : 13} strokeWidth={3} /> : <X size={big ? 15 : 13} strokeWidth={3} />}
    {ok ? <T en="Ready" gu="તૈયાર" /> : <T en="Not ready" gu="બાકી" />}
  </span>
);

export const Notice = ({ kind = 'error', children }) => (
  <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'error' ? <CircleAlert size={18} /> : <AlertTriangle size={18} />}
    <div>{children}</div>
  </div>
);

export const Problems = ({ items }) =>
  items.length ? (
    <ul className="problems">
      {items.map((p) => (
        <li key={p}><CircleAlert size={14} />{p}</li>
      ))}
    </ul>
  ) : null;

/** The cooperative's sun-over-panel idea, drawn small for the side menu. */
export const BrandMark = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
    <rect width="34" height="34" rx="8" fill="#1a2946" />
    <circle cx="12" cy="11" r="5" fill="#f59a23" />
    <path d="M10 19h17l3 9H7z" fill="#3f7fd6" />
    <path d="M15.5 19l-1.6 9M21.5 19l1.6 9M8.6 23.3h19.8" stroke="#0f1b33" strokeWidth="1.2" />
  </svg>
);
