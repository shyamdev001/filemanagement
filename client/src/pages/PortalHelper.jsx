import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Copy } from 'lucide-react';
import { api } from '../api.js';
import { Notice, T } from '../ui.jsx';

// The bookmark: fetches the helper from this app and starts it inside the portal page.
const bookmarkCode = (origin, key) =>
  `javascript:(function(){if(window.__solarHelper){window.__solarHelper.show();return}window.__SOLAR_APP={url:${JSON.stringify(origin)},key:${JSON.stringify(key)}};` +
  `fetch(${JSON.stringify(origin)}+'/portal-helper.js?'+Date.now()).then(function(r){return r.text()}).then(function(t){var s=document.createElement('script');s.textContent=t;document.documentElement.appendChild(s)})` +
  `.catch(function(){alert('Solar Files is not reachable. Is the app running?')})})();`;

export default function PortalHelper() {
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const link = useRef(null);

  useEffect(() => {
    api.get('/portal-setup').then(setSetup).catch((e) => setError(e.message));
  }, []);

  const code = setup ? bookmarkCode(setup.appUrl || window.location.origin, setup.key) : '';
  // React does not allow javascript: links, so the address is set on the element directly.
  useEffect(() => {
    if (link.current && code) link.current.setAttribute('href', code);
  }, [code]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="page narrow" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1><T en="Portal helper" gu="પોર્ટલ હેલ્પર" /></h1>
          <p className="prose">
            A small helper for the PM Surya Ghar vendor portal. While you use the portal as usual, it sends the FL, DCR and
            Agreement of each customer straight into this app, along with the application number, the name as the portal
            spells it, and the inverter serial number. Nothing to save, rename or upload.
          </p>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}

      <section className="panel">
        <div className="panel-head"><h2>1. Add the bookmark, once</h2></div>
        <div className="panel-body form">
          <p className="prose">
            Show the bookmarks bar in Chrome (Ctrl + Shift + B), then <b>drag this button onto the bar</b>.
          </p>
          <div className="row">
            <a ref={link} className="btn primary" onClick={(e) => e.preventDefault()} draggable="true">
              <Bookmark size={17} /> Solar Files helper
            </a>
            <button className="btn" onClick={copy} disabled={!code}>
              {copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy the bookmark address</>}
            </button>
          </div>
          <span className="hint">
            If dragging does not work: right-click the bookmarks bar → Add page → name it "Solar Files helper" and paste the copied address as the URL.
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>2. Use it on the portal</h2></div>
        <div className="panel-body">
          <ol className="steps">
            <li>Log in to the vendor portal yourself, as always.</li>
            <li>Click the <b>Solar Files helper</b> bookmark. A small panel appears in the corner of the portal.</li>
            <li>
              Open <b>My Application</b>. The helper reads the list and saves every customer's application number and portal
              name in this app. This is needed once, and again when new applications are added.
            </li>
            <li>Find a customer (the panel lists who still needs documents, with a button to copy the application number for the Filter).</li>
            <li>Press <b>Action → View Application</b>. The panel shows that customer and which documents are missing.</li>
            <li>Press <b>Get the missing documents</b> in the panel. It presses the View buttons for you and files the PDFs here.</li>
          </ol>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Good to know</h2></div>
        <div className="panel-body">
          <ul className="steps">
            <li>This app must be running while you use the helper.</li>
            <li>After you reload the portal page or log in again, click the bookmark again.</li>
            <li>The helper never sees your portal password and sends nothing anywhere except to this app.</li>
            <li>It works one customer at a time, at your pace, with your own clicks on the portal.</li>
            <li>A document that is already filed is skipped. A different one for the same customer is never replaced silently.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
