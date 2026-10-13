import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    // sheet|mobile|name (+ "#2" when the same person appears twice in a sheet)
    key: { type: String, required: true, unique: true },
    sheet: { type: String, required: true, index: true },
    srNo: String,
    excelRow: Number,
    name: String,
    village: String,
    taluka: String,
    mobile: { type: String, index: true },
    mobiles: [String],
    kw: Number,
    panelCount: Number,
    panelRaw: String,
    inverterRaw: String,
    installer: String,
    note: String,
    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
    issues: [String],
    inExcel: { type: Boolean, default: true },

    // Entered in the app; never overwritten by a re-import.
    englishName: { type: String, default: '' },
    inverterSerial: { type: String, default: '' },
    warrantyModel: { type: String, default: '' },
    manualDatasheets: { type: [String], default: [] },
    manualInverterDatasheet: { type: String, default: '' },

    // PDFs from the portal: uploads.dcr / .agreement / .fl = { originalName, size, uploadedAt }
    uploads: { type: mongoose.Schema.Types.Mixed, default: {} },
    // PM Surya Ghar application reference number (NP-GJMG25-…), learned from the FL or typed.
    applicationNumber: { type: String, default: '', index: true },
    // Printed by hand and put in the file.
    billAttached: { type: Boolean, default: false },
    insuranceAttached: { type: Boolean, default: false },

    // Set when a print batch containing this customer is marked as printed.
    printedAt: { type: Date, default: null },
    printBatch: { type: Number, default: null },
  },
  { timestamps: true }
);

const settingSchema = new mongoose.Schema(
  { key: { type: String, required: true, unique: true }, value: mongoose.Schema.Types.Mixed },
  { timestamps: true }
);

// A bulk-uploaded PDF the app could not place by itself.
const pendingSchema = new mongoose.Schema(
  {
    originalName: String,
    storedName: String,
    size: Number,
    detectedType: String,
    applicationNumber: String,
    candidates: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }],
    reason: String,
  },
  { timestamps: true }
);

// One merged print file for a group of customers.
const batchSchema = new mongoose.Schema(
  {
    number: Number,
    mode: String, // 'full' = whole file, 'generated' = only the documents the app makes
    doubleSided: Boolean,
    customers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }],
    pages: Number,
    storedName: String,
    printedAt: Date,
  },
  { timestamps: true }
);

export const Batch = mongoose.model('PrintBatch', batchSchema);
export const Customer = mongoose.model('Customer', customerSchema);
export const Pending = mongoose.model('PendingUpload', pendingSchema);
export const Setting = mongoose.model('Setting', settingSchema);

export async function getSetting(key, fallback = null) {
  const doc = await Setting.findOne({ key }).lean();
  return doc ? doc.value : fallback;
}

export async function setSetting(key, value) {
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
}
