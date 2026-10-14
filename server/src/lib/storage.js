import fs from 'node:fs';
import path from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';

/**
 * Where the uploaded PDFs live.
 *   - No Cloudinary account in .env: a folder on this computer (DATA_DIR), as before.
 *   - Cloudinary account set (see config.js): Cloudinary, so a hosting server without a disk keeps them.
 * A key looks like "uploads/<customerId>/fl.pdf" or "pending/<name>.pdf".
 * Nothing is deleted outright by setAside: the PDF is moved under "removed/".
 */

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const asideKey = (key) => `removed/${stamp()}_${key.replace(/\//g, '_')}`;

// ---------- this computer ----------
const diskFile = (key) => path.join(config.dataDir, ...key.split('/'));
const disk = {
  where: 'this computer',
  async put(key, buffer) {
    fs.mkdirSync(path.dirname(diskFile(key)), { recursive: true });
    fs.writeFileSync(diskFile(key), buffer);
  },
  async get(key) {
    return fs.existsSync(diskFile(key)) ? fs.readFileSync(diskFile(key)) : null;
  },
  async remove(key) {
    if (fs.existsSync(diskFile(key))) fs.unlinkSync(diskFile(key));
  },
  async setAside(key) {
    if (!fs.existsSync(diskFile(key))) return;
    const to = diskFile(asideKey(key));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(diskFile(key), to);
  },
};

// ---------- Cloudinary ----------
// Customer documents are stored as "authenticated" raw files: they have no public link.
// The server fetches them with a signed, short-lived link and passes them on to logged-in staff.
const FOLDER = 'solar-customer-files';
const KIND = { resource_type: 'raw', type: 'authenticated' };
const id = (key) => `${FOLDER}/${key}`;
const notFound = (err) => err?.http_code === 404 || /not found/i.test(err?.message || '');

const cloud = {
  where: 'Cloudinary',
  put(key, buffer) {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ ...KIND, public_id: id(key), overwrite: true, invalidate: true }, (err, result) => (err ? reject(err) : resolve(result)))
        .end(buffer);
    });
  },
  async get(key) {
    const url = cloudinary.utils.private_download_url(id(key), '', { ...KIND, expires_at: Math.floor(Date.now() / 1000) + 300 });
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Cloudinary download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  },
  async remove(key) {
    await cloudinary.uploader.destroy(id(key), { ...KIND, invalidate: true }).catch((err) => {
      if (!notFound(err)) throw err;
    });
  },
  async setAside(key) {
    await cloudinary.uploader.rename(id(key), id(asideKey(key)), { ...KIND, overwrite: true, invalidate: true }).catch((err) => {
      if (!notFound(err)) throw err;
    });
  },
};

if (config.cloudinary) cloudinary.config({ ...config.cloudinary, secure: true });

const base = config.cloudinary ? cloud : disk;

// Fetching a PDF from the cloud takes a second or two. A copy is kept on this machine, named after
// the file's fingerprint (version), so a PDF that was replaced elsewhere is never served stale.
const copyFile = (key, version) => path.join(config.dataDir, 'cache', `${String(version).slice(0, 40)}_${key.replace(/[\\/]/g, '_')}`);
function keepCopy(key, version, buffer) {
  try {
    fs.mkdirSync(path.dirname(copyFile(key, version)), { recursive: true });
    fs.writeFileSync(copyFile(key, version), buffer);
  } catch {
    // a full or read-only disk only costs speed
  }
}

export const storage = {
  where: base.where,
  /** version: a fingerprint of the content (optional); with it, a local copy is kept. */
  async put(key, buffer, version) {
    const result = await base.put(key, buffer);
    if (base === cloud && version) keepCopy(key, version, buffer);
    return result;
  },
  async get(key, version) {
    if (base === cloud && version && fs.existsSync(copyFile(key, version))) return fs.readFileSync(copyFile(key, version));
    const buffer = await base.get(key);
    if (buffer && base === cloud && version) keepCopy(key, version, buffer);
    return buffer;
  },
  /** Keep a local copy of a PDF that is already in hand. */
  keep(key, version, buffer) {
    if (base === cloud && version) keepCopy(key, version, buffer);
  },
  remove: (key) => base.remove(key),
  setAside: (key) => base.setAside(key),
};
