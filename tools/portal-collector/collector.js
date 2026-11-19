/*
 * Portal collector: reads the solar PANEL and INVERTER companies of the applications on the PM Surya Ghar vendor
 * portal's "My Application" list, one application at a time, exactly as you would by hand:
 *     expand the row  ->  Action  ->  View Application  ->  read what the portal loads  ->  Close.
 *
 * It is NOT part of the Solar Files web app.
 *   - It only presses the menu entry whose text is exactly "View Application" (never Upload Agreement, Submit
 *     Installation or anything else) and the list's own Next Page button. It changes nothing on the portal.
 *   - It makes no request of its own to the portal: it listens to the answer the portal itself loads.
 *   - It works at a human pace: a few seconds to look at each result, now and then a longer pause, a short break
 *     every 15 to 30 applications (about 10 seconds per application on average, roughly 10 hours for everything),
 *     and it stops by itself after 3 failures in a row
 *     (for example when the portal has logged you out) or when you press Stop.
 *   - Applications still at "Upload Agreement (Pending)" have nothing entered yet: they are not opened.
 *   - Every row is kept in the page AND in the browser's IndexedDB (the portal wipes localStorage when it logs you
 *     out, but not IndexedDB), so starting again carries on where it stopped, even after you log in again.
 *     __collector.pack(from) hands the rows out in a short form for saving.
 *   - You log in yourself; it never touches the login.
 *
 * Use:   __collector.runAll()         // every page, from the one that is open, to the end
 *        __collector.start(20)        // only the first 20 rows of the page that is open
 *        __collector.stop()           // stop after the application it is on
 */
(function () {
  if (window.__collector && window.__collector.installed) return;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var jitter = function (a, b) { return a + Math.random() * (b - a); };
  var sinceBreak = 0;
  var nextBreak = Math.round(jitter(20, 40));
  // what a person does between two applications
  async function human() {
    await sleep(jitter(1500, 3200)); // looking at the result
    if (Math.random() < 0.05) await sleep(jitter(4000, 9000)); // distracted for a moment
    if (++sinceBreak >= nextBreak) {
      sinceBreak = 0;
      nextBreak = Math.round(jitter(20, 40));
      await sleep(jitter(12000, 30000)); // a short break
    }
  }

  var C = (window.__collector = { installed: true, rows: [], errors: [], running: false, stopNow: false, seen: {}, page: 1, makers: [] });
  try {
    JSON.parse(localStorage.getItem('portalCollector') || '[]').forEach(function (r) { C.rows.push(r); C.seen[r.applicationNumber] = true; });
  } catch (e) {}

  // ---- the rows are also kept in IndexedDB: the portal clears localStorage at logout, not this ----
  var idb = null;
  C.ready = new Promise(function (done) {
    try {
      var rq = indexedDB.open('portalCollector', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('rows', { keyPath: 'applicationNumber' }); };
      rq.onerror = function () { done(); };
      rq.onsuccess = function () {
        idb = rq.result;
        var all = idb.transaction('rows').objectStore('rows').getAll();
        all.onsuccess = function () {
          all.result.forEach(function (r) { if (!C.seen[r.applicationNumber]) { C.rows.push(r); C.seen[r.applicationNumber] = true; } });
          done();
        };
        all.onerror = function () { done(); };
      };
    } catch (e) { done(); }
  });
  var save = function (rec) { try { if (idb) idb.transaction('rows', 'readwrite').objectStore('rows').put(rec); } catch (e) {} };

  // ---- listen to the portal's own answer for "View Application" (no request of ours) ----
  C.details = [];
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__u = String(u);
    return open.apply(this, arguments);
  };
  var send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        if (/getAllDetailsOfApplication/i.test(this.__u)) C.details.push({ at: Date.now(), body: this.responseText });
      } catch (e) {}
    });
    return send.apply(this, arguments);
  };

  // ---- rows handed out in a short form: "application|panels|inverters", makers numbered in C.makers ----
  var maker = function (name) {
    var k = C.makers.indexOf(name);
    if (k < 0) { C.makers.push(name); k = C.makers.length - 1; }
    return k;
  };
  C.pack = function (from) {
    var lines = [];
    for (var n = from || 0; n < C.rows.length; n++) {
      var r = C.rows[n];
      if (r.notOpened) continue;
      var mods = r.modules.map(function (m) { return maker(m.maker) + ':' + m.watt + 'x' + m.qty; }).join(';');
      var invs = r.inverters.map(function (v) { return maker(v.maker) + ':' + v.kw + 'x' + v.qty; }).join(';');
      lines.push(r.applicationNumber + '|' + mods + '|' + invs + '|' + (r.status || ''));
    }
    return { next: C.rows.length, makers: C.makers, lines: lines };
  };

  // ---- a small panel: progress and Stop ----
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;background:#0f1b33;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 12px;border-radius:8px;display:flex;gap:10px;align-items:center;max-width:90vw';
  box.innerHTML = '<span id="__cc">Collector ready</span><button id="__cs" style="border:0;border-radius:5px;padding:4px 10px;cursor:pointer">Stop</button>';
  document.body.appendChild(box);
  box.querySelector('#__cs').onclick = function () { C.stopNow = true; };
  var say = function (t) { box.querySelector('#__cc').textContent = t; };

  var mainRows = function () {
    return [].slice.call(document.querySelectorAll('table tbody tr')).filter(function (tr) {
      return tr.children[1] && /^NP-/.test(tr.children[1].innerText.trim());
    });
  };
  var cell = function (tr, i) { return (tr.children[i] ? tr.children[i].innerText : '').replace(/\s+/g, ' ').trim(); };

  async function waitFor(fn, ms) {
    var t0 = Date.now();
    while (Date.now() - t0 < ms) {
      var v = fn();
      if (v) return v;
      await sleep(150);
    }
    return null;
  }

  function summarise(row, d) {
    var mods = (d.moduleList || []).map(function (m) { return { maker: m.manufacturerName || '', watt: m.capacity, qty: m.qty }; });
    var invs = (d.inverterList || []).map(function (i) { return { maker: i.manufacturerName || '', kw: i.capacity, qty: i.qty }; });
    return {
      applicationNumber: d.applicationNumber,
      consumerName: d.consumerName,
      consumerNo: d.consumerNo,
      mobile: d.mobile,
      status: cell(row, 7),
      stepName: d.stepName || '',
      proposedKw: d.proposalCapacity != null ? d.proposalCapacity : d.appliedCapacity,
      installedKw: d.pvCapacity,
      totalModuleKw: d.totalModuleCapacity,
      totalInverterKw: d.totalInverterCapacity,
      modules: mods,
      inverters: invs,
      dcrType: d.dcrType || '',
      village: d.villageName || '',
      district: d.districtName || '',
      collectedAt: new Date().toISOString(),
    };
  }

  function keep(rec) {
    C.rows.push(rec);
    C.seen[rec.applicationNumber] = true;
    try { localStorage.setItem('portalCollector', JSON.stringify(C.rows)); } catch (e) {}
    save(rec);
  }

  async function one(i) {
    var row = mainRows()[i];
    if (!row) return { skip: 'no such row' };
    var appNo = cell(row, 1);
    if (C.seen[appNo]) return { skip: 'already collected' };
    // optional target list: __collector.only = { 'NP-GJMG26-16376380': true, ... } opens only those applications
    if (C.only && !C.only[appNo]) return { skip: 'not needed' };

    // Nothing is entered yet at this stage: no need to open it.
    if (/^Upload Agreement/i.test(cell(row, 7))) {
      keep({ applicationNumber: appNo, consumerName: cell(row, 4), consumerNo: cell(row, 3), mobile: cell(row, 5), status: cell(row, 7), proposedKw: Number(cell(row, 6)) || null, modules: [], inverters: [], notOpened: 'nothing entered at this stage', collectedAt: new Date().toISOString() });
      return { skip: 'not opened (agreement pending)' };
    }

    var before = C.details.length;
    // 1. expand the row
    var chev = row.querySelector('p-button button');
    if (!chev) throw new Error('no expand button for ' + appNo);
    chev.click();
    await sleep(jitter(350, 800));
    // 2. the Action button of this row
    var act = [].slice.call(document.querySelectorAll('table tbody button')).filter(function (b) { return /^\s*Action\s*$/.test(b.innerText || ''); }).pop();
    if (!act) throw new Error('no Action button for ' + appNo);
    act.click();
    await sleep(jitter(300, 700));
    // 3. ONLY the entry that says exactly "View Application"
    var li = [].slice.call(document.querySelectorAll('.p-menuitem')).filter(function (x) { return x.innerText.trim() === 'View Application'; }).pop();
    if (!li) throw new Error('no "View Application" entry for ' + appNo);
    var target = li.querySelector('a') || li.querySelector('.p-menuitem-content');
    if (target.innerText.trim() !== 'View Application') throw new Error('refusing to press "' + target.innerText.trim() + '"');
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
      target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    });
    // 4. the portal's answer
    var got = await waitFor(function () { return C.details.length > before ? C.details[C.details.length - 1] : null; }, 9000);
    if (!got) throw new Error('no answer from the portal for ' + appNo);
    var d = JSON.parse(got.body);
    d = d.data || d;
    if (String(d.applicationNumber || '').trim() !== appNo) throw new Error('the answer was for ' + d.applicationNumber + ', not ' + appNo);
    keep(summarise(row, d));
    // 5. close the dialog and fold the row again
    await sleep(jitter(500, 1200));
    var close = document.querySelector('.p-dialog [aria-label="Close"]');
    if (close) close.click();
    await sleep(jitter(350, 800));
    var chev2 = (mainRows()[i] || row).querySelector('p-button button');
    if (chev2) chev2.click();
    return { ok: true };
  }

  // the rows of the page that is open
  async function onPage(limit, total) {
    var failures = 0;
    var n = Math.min(limit || 1e9, mainRows().length);
    for (var i = 0; i < n && !C.stopNow; i++) {
      if (!/signed-in/.test(location.hash)) { C.errors.push('logged out'); return false; }
      try {
        var r = await one(i);
        failures = 0;
        say('Collector: page ' + C.page + ', row ' + (i + 1) + ' of ' + n + ' · ' + C.rows.length + ' of about ' + (total || '?'));
        if (!r.skip) await human();
      } catch (e) {
        C.errors.push(C.page + ': ' + String(e.message || e));
        failures++;
        say('Collector problem: ' + (e.message || e));
        var close = document.querySelector('.p-dialog [aria-label="Close"]');
        if (close) close.click();
        await sleep(1500);
        if (failures >= 3) { C.errors.push('stopped: 3 failures in a row'); return false; }
      }
    }
    return true;
  }

  C.start = async function (n) {
    if (C.running) return 'already running';
    C.running = true; C.stopNow = false;
    await C.ready;
    await onPage(n || 25);
    C.running = false;
    say('Collector stopped. ' + C.rows.length + ' collected' + (C.errors.length ? ', ' + C.errors.length + ' problem(s)' : ''));
    return { collected: C.rows.length, errors: C.errors };
  };

  // every page, from the one that is open to the last
  C.runAll = async function () {
    if (C.running) return 'already running';
    C.running = true; C.stopNow = false; C.errors = [];
    await C.ready;
    var m = /Total Application\s*:\s*(\d+)/i.exec(document.body.innerText);
    var total = m ? Number(m[1]) : null;
    while (!C.stopNow) {
      var ok = await onPage(null, total);
      if (!ok) break;
      var next = document.querySelector('button.p-paginator-next');
      if (!next || next.disabled) { say('Collector finished: ' + C.rows.length + ' applications.'); C.finished = true; break; }
      var first = mainRows()[0] ? cell(mainRows()[0], 1) : '';
      next.click();
      var moved = await waitFor(function () { var r = mainRows()[0]; return r && cell(r, 1) !== first; }, 12000);
      if (!moved) { C.errors.push('the next page did not load'); break; }
      C.page++;
      await sleep(jitter(3000, 7000));
    }
    C.running = false;
    if (!C.finished) say('Collector stopped on page ' + C.page + '. ' + C.rows.length + ' collected' + (C.errors.length ? ', ' + C.errors.length + ' problem(s): ' + C.errors[C.errors.length - 1] : ''));
    return { collected: C.rows.length, errors: C.errors, finished: !!C.finished };
  };
  C.stop = function () { C.stopNow = true; };

  // ---- a button that gives you everything collected as a file (opens in Excel) ----
  var dl = document.createElement('button');
  dl.id = '__cd';
  dl.textContent = 'Download Excel (CSV)';
  dl.style.cssText = 'border:0;border-radius:5px;padding:4px 10px;cursor:pointer;background:#f5a623';
  var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
  var csv = function (v) { v = v == null ? '' : String(v); return (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf(NL) >= 0) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  dl.onclick = function () {
    var head = ['Application Number', 'Consumer Name', 'Consumer Number', 'Mobile', 'Status', 'District', 'Proposed kWp', 'Panel company', 'Panel watt', 'Panels (nos)', 'Inverter company', 'Inverter kW', 'Inverters (nos)', 'Note'];
    var lines = [head.map(csv).join(',')];
    C.rows.forEach(function (r) {
      var m = r.modules || [], v = r.inverters || [];
      var j = function (a, f) { return a.map(f).join(' + '); };
      lines.push([r.applicationNumber, r.consumerName, r.consumerNo, r.mobile, r.status, r.district, r.proposedKw,
        j(m, function (x) { return x.maker; }), j(m, function (x) { return x.watt; }), j(m, function (x) { return x.qty; }),
        j(v, function (x) { return x.maker; }), j(v, function (x) { return x.kw; }), j(v, function (x) { return x.qty; }),
        r.notOpened ? 'not entered on the portal yet' : (!m.length && !v.length ? 'nothing entered' : '')].map(csv).join(','));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([String.fromCharCode(65279) + lines.join(CR + NL)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'panels-and-inverters.csv';
    document.body.appendChild(a); a.click(); a.remove();
  };
  box.querySelector('#__cs').after(dl);
  say('Collector ready');
})();
