PORTAL COLLECTOR - how to use it yourself
==========================================
Reads the solar PANEL company and INVERTER company of every application on the PM Surya Ghar vendor portal.
It is NOT part of the Solar Files web app. It only presses "View Application" and the Next Page button.
It makes no request of its own and never touches your password.

START (or RESTART after the portal logged you out)
1. Open Chrome, log in to https://vendor.pmsuryaghar.gov.in yourself.
2. Click "My Application" in the portal menu (wait until the list shows).
3. Press F12, click the "Console" tab.
4. Open collector.js (this folder) in Notepad, Ctrl+A, Ctrl+C.
5. Click in the Console, Ctrl+V. If Chrome says "don't paste code you don't understand",
   type   allow pasting   and press Enter, then paste again. Press Enter.
6. Type   __collector.runAll()   and press Enter.
   A dark box appears bottom-left: progress, a Stop button, and an orange "Download Excel (CSV)" button.
Leave the tab open and the PC awake (Windows: Settings > Power > Sleep = Never while plugged in).
Do not use that tab for anything else while it runs. About 10 seconds per application, ~10 hours for 4,120.

THE PORTAL LOGS YOU OUT ABOUT EVERY 2 HOURS
The collector stops by itself (box says "stopped"). Just do the START steps again: it skips everything
already collected and carries on.

WHERE THE DATA IS
Inside Chrome, on this PC, in the browser's IndexedDB for vendor.pmsuryaghar.gov.in (database "portalCollector").
It survives portal logouts and restarts of Chrome. It is lost only if you clear Chrome's "site data / cookies"
for that site, or use another Chrome profile / another PC. Nothing is sent anywhere. Not in git.

GET YOUR FILE
Press the orange "Download Excel (CSV)" button (needs the collector loaded in the open tab, so after a
restart do steps 1-5 first, then press the button; it already holds the saved rows).
Chrome saves panels-and-inverters.csv in Downloads. Open it in Excel.
Columns: Application Number, Consumer Name, Consumer Number, Mobile, Status, District, Proposed kWp,
Panel company / watt / nos, Inverter company / kW / nos, Note.
"not entered on the portal yet" = application still at "Upload Agreement (Pending)" (not opened).
You can download at any time, even half way, and again at the end.

CHECK PROGRESS
Console:   __collector.rows.length      (how many collected, goal about 4,120)
           __collector.errors            (problems; empty is good)
Stop:      press Stop in the box, or  __collector.stop()

IF SOMETHING GOES WRONG
- "stopped: 3 failures in a row": the portal changed or logged you out. Log in, redo START.
- Nothing happens after paste: you are not on the My Application page.
- Want a clean start (throw away collected rows): Console >
    indexedDB.deleteDatabase('portalCollector'); localStorage.removeItem('portalCollector')
  then reload the page.
