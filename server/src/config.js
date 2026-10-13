import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(here, '..');
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');

dotenv.config({ path: path.join(SERVER_DIR, '.env') });

// Cloudinary account, given either as one link (CLOUDINARY_URL=cloudinary://KEY:SECRET@CLOUD)
// or as the three separate values shown on the Cloudinary dashboard.
function cloudinaryAccount() {
  const env = process.env;
  if (env.CLOUDINARY_URL) {
    const u = new URL(env.CLOUDINARY_URL.trim());
    return { cloud_name: u.hostname, api_key: decodeURIComponent(u.username), api_secret: decodeURIComponent(u.password) };
  }
  const account = { cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET };
  for (const k of Object.keys(account)) account[k] = (account[k] || '').trim();
  return account.cloud_name && account.api_key && account.api_secret ? account : null;
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || '',
  // Folder holding the panel / inverter datasheet PDFs.
  datasheetDir: process.env.DATASHEET_DIR || path.join(ROOT_DIR, 'datasheets'),
  // Logos and stamps used inside the generated documents.
  assetsDir: path.join(SERVER_DIR, 'assets'),
  clientDist: path.join(ROOT_DIR, 'client', 'dist'),
  // Uploaded PDFs (Agreement / FL / DCR) are kept here.
  dataDir: process.env.DATA_DIR || path.join(ROOT_DIR, 'data'),
  // Leave empty for no login (local use). Set it before hosting.
  // Set to keep uploaded PDFs in Cloudinary instead of on this computer (needed on a host without a disk).
  cloudinary: cloudinaryAccount(),
  appPassword: process.env.APP_PASSWORD || '',
  // true on the hosting server (NODE_ENV=production)
  hosted: process.env.NODE_ENV === 'production',
};
