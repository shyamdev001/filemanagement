import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import mongoose from 'mongoose';
import { config } from './config.js';
import { api } from './api.js';
import { staffAuth } from './staff.js';
import { portal, portalCors } from './portal.js';
import { SERVER_DIR } from './config.js';
import compression from 'compression';
import { closeBrowser, warmUp } from './lib/pdf.js';
import { storage } from './lib/storage.js';
import { backfillDcrPanels } from './lib/dcr.js';

if (!config.mongoUri) {
  console.error('\nMONGODB_URI is missing. Put your MongoDB Atlas connection string in server\\.env (see server\\.env.example).\n');
  process.exit(1);
}

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
} catch (err) {
  console.error('\nCould not connect to MongoDB. Check MONGODB_URI in server\\.env and your internet connection.\n', err.message);
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '5mb' }));
// The portal helper: its script, and the endpoints it calls from the vendor portal page.
app.get('/portal-helper.js', portalCors, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/javascript').sendFile(path.join(SERVER_DIR, 'public', 'portal-helper.js'));
});
app.options('/portal-helper.js', portalCors);
app.use('/api/portal', portal);
app.use('/api', staffAuth); // sign-in and staff accounts; guards every route below
app.use('/api', api);

// The built React app (client/dist) is served by the same server.
if (fs.existsSync(config.clientDist)) {
  // Files under /assets carry a fingerprint in their name, so the browser may keep them for good.
  app.use(
    express.static(config.clientDist, {
      setHeaders: (res, file) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    })
  );
  app.get('*', (req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}

const server = app.listen(config.port, () => {
  console.log(`\nSolar File Generator is running:  http://localhost:${config.port}\n(Keep this window open. Close it to stop the app.)\nUploaded PDFs are kept in: ${storage.where}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nThe app is already running. Open http://localhost:${config.port} in your browser.\n(If it does not open, close the other black window and start again.)\n`);
  } else console.error(err);
  process.exit(1);
});

// On a PC, start the PDF engine now so the first preview is quick. A small host starts it when needed.
if (!config.hosted) warmUp();
// DCRs filed before the app read their panel details.
backfillDcrPanels().catch((err) => console.error('DCR backfill:', err.message));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    server.close();
    await closeBrowser();
    await mongoose.disconnect();
    process.exit(0);
  });
}
