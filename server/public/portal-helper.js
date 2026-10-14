/*
 * Solar Files portal helper.
 * Started by a bookmark inside your own logged-in PM Surya Ghar vendor portal tab.
 *
 * It does not log in, and it makes no requests to the portal of its own. It watches what the portal
 * page loads while you use it, and passes that to your Solar Files app:
 *   - the application list            → application numbers and names for every customer
 *   - "View Application"              → that customer's application number, name and inverter serial
 *   - a PDF opened with "View"        → filed under that customer as FL / DCR / Agreement
 * The one thing it does for you: after you open an application, "Get the documents" presses the three
 * View buttons for you, one after the other.
 */
(function () {
  if (window.__solarHelper) return window.__solarHelper.show();
  var APP = window.__SOLAR_APP || {};
  var TYPES = { 'Feasibility Document': 'fl', 'DCR Declaration': 'dcr', 'Vendor And Customer Agreement': 'agreement' };
  var LABEL = { fl: 'FL', dcr: 'DCR', agreement: 'Agreement' };
  var state = { current: null, customer: null, lastLabel: '', grabbing: false, waiters: [], log: [], queue: null, list: null };

  // ---------- talking to the Solar Files app ----------
  function app(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'x-helper-key': APP.key }, options.headers || {});
    return fetch(APP.url + '/api/portal' + path, options).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || 'The app refused this');
        return j;
      });
    });
  }
  var post = function (path, body) {
    return app(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  };

  // ---------- the panel ----------
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;width:340px;max-height:80vh;overflow:auto;background:#fff;color:#121a2b;border:1px solid #cfd4dd;border-radius:12px;box-shadow:0 12px 32px rgba(16,27,51,.25);font:14px/1.45 "Segoe UI","Nirmala UI",system-ui,sans-serif';
  document.body.appendChild(box);
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
  };
  var dot = function (ok) {
    return '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;text-align:center;line-height:18px;font-size:12px;font-weight:700;color:#fff;background:' + (ok ? '#12a05c' : '#c9ced8') + '">' + (ok ? '✓' : '') + '</span>';
  };
  var button = 'border:0;border-radius:7px;padding:8px 12px;font:600 14px inherit;cursor:pointer;';
  function say(text, bad) {
    state.log.unshift({ text: text, bad: !!bad });
    state.log = state.log.slice(0, 4);
    draw();
  }
  function draw() {
    var c = state.customer;
    var h = '<div data-drag="1" title="Drag to move" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#0f1b33;color:#fff;border-radius:12px 12px 0 0;cursor:move;user-select:none">' +
      '<b>☀ Solar Files helper <span style="font-weight:400;opacity:.7;font-size:12px">· drag to move</span></b><span data-act="hide" style="cursor:pointer;padding:0 6px;font-size:18px">–</span></div><div style="padding:12px 14px;display:grid;gap:10px">';
    if (state.list) h += '<div style="color:#4d586b;font-size:13px">Application list read: <b>' + state.list.matched + '</b> of your customers found, ' + state.list.numbers + ' application numbers and ' + state.list.names + ' names saved.</div>';
    if (!state.current) h += '<div>Open an application with <b>Action → View Application</b>. I will take it from there.</div>';
    else if (!c) h += '<div><b>' + esc(state.current.name) + '</b><div style="color:#b42318;font-size:13px">' + esc(state.notFound || 'Checking…') + '</div></div>';
    else {
      h += '<div><b lang="gu">' + esc(c.name) + '</b><div style="color:#667085;font-size:13px">' + esc(c.english) + (c.village ? ' · ' + esc(c.village) : '') + '</div></div>';
      h += '<div style="display:flex;gap:14px">' + ['fl', 'dcr', 'agreement'].map(function (t) { return '<span>' + dot(c.has[t]) + ' ' + LABEL[t] + '</span>'; }).join('') + '</div>';
      if (state.serialNote) h += '<div style="font-size:13px;color:#4d586b">' + esc(state.serialNote) + '</div>';
      var missing = ['fl', 'dcr', 'agreement'].filter(function (t) { return !c.has[t]; });
      // only offer documents the portal actually has for this application
      var avail = state.available;
      var absent = avail ? missing.filter(function (t) { return !avail[t]; }) : [];
      if (avail) missing = missing.filter(function (t) { return avail[t]; });
      if (absent.length) h += '<div style="font-size:13px;color:#8a4b08;background:#fff5dd;padding:6px 8px;border-radius:6px">Not on the portal yet: ' + absent.map(function (t) { return LABEL[t]; }).join(', ') + '. This customer leaves the list until the portal has ' + (absent.length > 1 ? 'them' : 'it') + '.</div>';
      if (!missing.length && absent.length) h += '';
      else if (missing.length) h += '<button data-act="grab" ' + (state.grabbing ? 'disabled' : '') + ' style="' + button + 'background:#b9520a;color:#fff;' + (state.grabbing ? 'opacity:.6' : '') + '">' + (state.grabbing ? 'Getting…' : 'Get the ' + missing.length + ' missing document' + (missing.length > 1 ? 's' : '')) + '</button>';
      else h += '<div style="color:#067647;font-weight:600">This customer has all three documents.</div>';
    }
    state.log.forEach(function (l) { h += '<div style="font-size:13px;color:' + (l.bad ? '#b42318' : '#4d586b') + '">' + esc(l.text) + '</div>'; });
    if (state.queue) {
      var q0 = state.queue;
      h += '<div style="border-top:1px solid #e3e6ec;padding-top:10px"><b>' + (q0.ready == null ? q0.waiting : q0.ready) + '</b> customers can be done now';
      h += ' <span data-act="queue" style="color:#b9520a;cursor:pointer;text-decoration:underline;font-size:13px">refresh</span>';
      if (q0.ready != null && q0.early + q0.notOnPortalYet > 0) h += '<div style="font-size:12px;color:#667085">' + (q0.early + q0.notOnPortalYet) + ' more are not far enough on the portal yet, so they are left out of this list.</div>';
      q0.next.slice(0, state.more ? 60 : 8).forEach(function (q) {
        h += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:6px;font-size:13px"><span><span lang="gu">' + esc(q.name) + '</span><br><span style="color:#667085">' + esc(q.applicationNumber) + (q.stage ? ' · ' + esc(q.stage) : '') + '</span></span>' +
          '<button data-copy="' + esc(q.applicationNumber) + '" style="' + button + 'background:#eceef2;color:#121a2b;padding:5px 9px;font-size:12px">Copy number</button></div>';
      });
      if (q0.next.length > 8) h += '<div data-act="more" style="margin-top:8px;color:#b9520a;cursor:pointer;text-decoration:underline;font-size:13px">' + (state.more ? 'Show fewer' : 'Show more (' + q0.next.length + ')') + '</div>';
      h += '</div>';
    }
    box.innerHTML = h + '</div>';
  }
  box.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-copy]');
    if (!t) return;
    if (t.dataset.copy) {
      navigator.clipboard.writeText(t.dataset.copy).then(function () { say('Copied ' + t.dataset.copy + '. Paste it in Filter → Application Number.'); });
      return;
    }
    if (t.dataset.act === 'hide') { box.style.display = 'none'; pill.style.display = 'block'; }
    if (t.dataset.act === 'grab') grab();
    if (t.dataset.act === 'queue') loadQueue();
    if (t.dataset.act === 'more') { state.more = !state.more; draw(); }
  });
  // ---------- drag the panel by its dark title bar; the place is remembered ----------
  function place(left, top) {
    var w = box.offsetWidth || 340;
    var h = Math.min(box.offsetHeight || 200, window.innerHeight);
    left = Math.max(4, Math.min(left, window.innerWidth - w - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - Math.min(h, 60)));
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    box.style.maxHeight = Math.max(160, window.innerHeight - top - 8) + 'px';
  }
  try {
    var saved = JSON.parse(localStorage.getItem('solarHelperPlace') || 'null');
    if (saved) setTimeout(function () { place(saved.left, saved.top); }, 0);
  } catch (err) { /* no saved place */ }
  box.addEventListener('mousedown', function (e) {
    if (!e.target.closest('[data-drag]') || e.target.closest('[data-act]')) return;
    var r = box.getBoundingClientRect();
    var dx = e.clientX - r.left;
    var dy = e.clientY - r.top;
    function move(ev) { place(ev.clientX - dx, ev.clientY - dy); }
    function up() {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', up, true);
      var now = box.getBoundingClientRect();
      try { localStorage.setItem('solarHelperPlace', JSON.stringify({ left: now.left, top: now.top })); } catch (err) { /* ignore */ }
    }
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    e.preventDefault();
  });
  window.addEventListener('resize', function () {
    if (box.style.left) place(parseFloat(box.style.left), parseFloat(box.style.top));
  });

  var pill = document.createElement('div');
  pill.textContent = '☀ Solar Files';
  pill.style.cssText = 'display:none;position:fixed;right:16px;bottom:16px;z-index:2147483000;background:#0f1b33;color:#fff;padding:8px 14px;border-radius:20px;cursor:pointer;font:600 13px "Segoe UI",sans-serif;box-shadow:0 6px 18px rgba(16,27,51,.3)';
  pill.onclick = function () { pill.style.display = 'none'; box.style.display = 'block'; };
  document.body.appendChild(pill);

  function loadQueue() {
    app('/queue').then(function (q) { state.queue = q; draw(); }).catch(function () {});
  }

  // ---------- what the portal page loads ----------
  function onList(list) {
    if (!Array.isArray(list) || !list.length) return;
    var slim = list.map(function (r) { return { appId: r.appId, appRefNo: r.appRefNo, consumerNo: r.consumerNo, consumerName: r.consumerName, mobileNo: r.mobileNo, statusName: r.statusName, stageName: r.stageName }; });
    post('/list', { applications: slim }).then(function (r) { state.list = r; draw(); loadQueue(); }).catch(function (e) { say('Could not save the application list: ' + e.message, true); });
  }
  function onDetails(d) {
    if (!d || !d.applicationNumber) return;
    state.current = {
      applicationNumber: d.applicationNumber,
      name: d.consumerName,
      mobile: d.mobile,
      inverters: (d.inverterList || []).map(function (i) { return { maker: i.manufacturerName, serials: (i.serialNumbers || []).map(function (s) { return s.serialNumber; }) }; }),
      documents: (d.documentList || []).map(function (x) { return { type: x.documentType, file: x.fileName }; }),
    };
    state.customer = null;
    state.notFound = '';
    state.available = null;
    state.serialNote = '';
    state.log = [];
    draw();
    post('/application', state.current).then(function (r) {
      if (!r.found) { state.notFound = r.reason; return draw(); }
      state.customer = r.customer;
      state.available = r.available || null;
      loadQueue(); // a customer with nothing to fetch yet drops out of the list
      state.serialNote = {
        saved: 'Inverter serial ' + r.portalSerial + ' saved for the warranty card.',
        same: 'Inverter serial already saved.',
        differs: 'Serial on the portal (' + r.portalSerial + ') differs from the one in the app (' + r.appSerial + '). Not changed.',
        onAnother: 'Serial ' + r.portalSerial + ' is already on another customer. Not saved.',
        several: 'The portal lists more than one inverter serial. Not saved.',
      }[r.serial] || '';
      draw();
    }).catch(function (e) { say('The app is not answering: ' + e.message, true); });
  }
  function onPdf(blob) {
    var type = TYPES[state.lastLabel];
    var cur = state.current;
    if (!type || !cur) return;
    var doc = cur.documents.filter(function (x) { return x.type === state.lastLabel; })[0];
    var form = new FormData();
    form.append('file', blob, (doc && doc.file) || type + '.pdf');
    form.append('type', type);
    form.append('applicationNumber', cur.applicationNumber);
    form.append('mobile', cur.mobile || '');
    form.append('name', cur.name || '');
    app('/document', { method: 'POST', body: form }).then(function (r) {
      if (r.customer) state.customer = r.customer;
      say({ saved: LABEL[type] + ' filed.', same: LABEL[type] + ' was already filed.', different: 'This customer already has a different ' + LABEL[type] + '. Replace it from the app if needed.', noCustomer: 'No customer for this application.' }[r.result] || r.result, r.result === 'different' || r.result === 'noCustomer');
      done(type);
    }).catch(function (e) { say(LABEL[type] + ' could not be sent: ' + e.message, true); done(type); });
  }
  function done(type) {
    state.waiters.splice(0).forEach(function (w) { w(type); });
  }

  // which document row a "View" click belongs to
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a,button') : null;
    var tr = el && el.closest('tr');
    if (tr && /view/i.test(el.textContent || '') && tr.children[1]) state.lastLabel = (tr.children[1].textContent || '').trim();
  }, true);

  var xhrOpen = XMLHttpRequest.prototype.open;
  var xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__solarUrl = String(url);
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    var url = xhr.__solarUrl || '';
    var kind = /getMyApplicationList/.test(url) ? 'list' : /getAllDetailsOfApplication/.test(url) ? 'details' : '';
    if (kind) {
      xhr.addEventListener('load', function () {
        try {
          var data = typeof xhr.response === 'string' ? JSON.parse(xhr.response) : xhr.response;
          if (kind === 'list') onList(data); else onDetails(data);
        } catch (err) { /* not for us */ }
      });
    }
    return xhrSend.apply(this, arguments);
  };
  var makeUrl = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    var url = makeUrl.apply(this, arguments);
    try { if (obj instanceof Blob && /pdf/i.test(obj.type)) onPdf(obj); } catch (err) { /* ignore */ }
    return url;
  };
  var openWindow = window.open;
  window.open = function (url) {
    // while the helper is pressing View for you, the PDFs are sent to the app instead of opening as tabs
    if (state.grabbing && String(url).indexOf('blob:') === 0) return null;
    return openWindow.apply(this, arguments);
  };

  // ---------- "Get the documents": press the View buttons of the open application, one by one ----------
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function viewLink(label) {
    var rows = document.querySelectorAll('.p-dialog table tbody tr');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].children[1] && rows[i].children[1].textContent.trim() === label) {
        var links = rows[i].querySelectorAll('a,button');
        for (var k = 0; k < links.length; k++) if (/view/i.test(links[k].textContent)) return links[k];
      }
    }
    return null;
  }
  async function grab() {
    if (state.grabbing || !state.customer) return;
    state.grabbing = true;
    draw();
    try {
      for (var label in TYPES) {
        var type = TYPES[label];
        if (state.customer.has[type]) continue;
        var link = viewLink(label);
        if (!link) { say(LABEL[type] + ' is not on the portal yet for this application.', true); continue; }
        var arrived = new Promise(function (resolve) { state.waiters.push(resolve); });
        link.click();
        var got = await Promise.race([arrived, sleep(25000).then(function () { return null; })]);
        if (!got) say(LABEL[type] + ' did not open. Press its View button yourself.', true);
        await sleep(1500);
      }
    } finally {
      state.grabbing = false;
      draw();
      loadQueue();
    }
  }

  window.__solarHelper = { show: function () { box.style.display = 'block'; pill.style.display = 'none'; } };
  draw();
  app('/ping').then(function () { say('Connected to your Solar Files app. Open "My Application" so I can read the list.'); loadQueue(); })
    .catch(function (e) { say('Cannot reach the Solar Files app (' + e.message + '). Is it running?', true); });
})();
