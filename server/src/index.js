import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import mongoose from 'mongoose';
import { config } from './config.js';
import { api } from './api.js';
import { closeBrowser } from './lib/pdf.js';
import { storage } from './lib/storage.js';

if (config.hosted && config.appPassword.length < 8) {
  console.error('\nAPP_PASSWORD is missing or shorter than 8 characters. The hosted app holds customer documents and will not start without a password.\n');
  process.exit(1);
}

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
app.use(express.json({ limit: '5mb' }));
app.use('/api', api);

// The built React app (client/dist) is served by the same server.
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
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

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    server.close();
    await closeBrowser();
    await mongoose.disconnect();
    process.exit(0);
  });
}
