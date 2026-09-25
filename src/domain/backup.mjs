export const BACKUP_FORMAT = 5;
export const STATE_FIELDS = [
  "txns", "holdings", "accounts", "cats", "subcats", "budget", "budgetMonths", "targetMix", "plan",
  "taxRules", "taxRulesEditedAt", "deductions", "capGainsEvents", "fxRates", "taxPayments", "taxSettings",
  "scheduleFA", "fixedDeposits", "modelSettings", "transactionTemplates", "txnDraft",
  "workbookBaselineFingerprint", "workbookReceipts", "onboarded", "wizardOnly", "lastSyncedAt", "lastBackupAt"
];
export const QUEUE_FIELDS = ["capQueue", "catQueue", "acctQueue", "holdQueue", "lotQueue", "budQueue", "dedQueue", "payQueue", "cgQueue", "trQueue", "fdQueue", "msQueue"];

export function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function createBackup({ store, state, queues = {}, archives, workbook, exportedAt = new Date().toISOString() }) {
  const backup = { _backup: { app: store, format: BACKUP_FORMAT, exportedAt } };
  for (const field of STATE_FIELDS) if (state[field] !== undefined) backup[field] = state[field];
  for (const field of QUEUE_FIELDS) backup[field] = queues[field] || [];
  if (archives !== undefined) backup.archives = archives;
  if (workbook?.bytes) backup.workbook = { name: workbook.name || null, cachedAt: workbook.cachedAt || null, bytesB64: bytesToBase64(workbook.bytes) };
  return backup;
}

export function parseBackup(text, store) {
  let backup;
  try { backup = JSON.parse(text); } catch { throw new Error("That file isn't valid JSON."); }
  if (!backup || typeof backup !== "object" || !Array.isArray(backup.txns)) throw new Error("That JSON doesn't look like a ledger backup (no transactions array found).");
  if (backup._backup?.app && backup._backup.app !== store) throw new Error("This backup was exported from a different app/store — restoring it would mix in unrelated data.");
  const arrayFields = ["holdings", "cats", "accounts", "budget", "capGainsEvents", "taxPayments", "fixedDeposits", "transactionTemplates", "workbookReceipts", ...QUEUE_FIELDS];
  for (const field of arrayFields) if (backup[field] != null && !Array.isArray(backup[field])) throw new Error(`Backup file is corrupt: "${field}" should be a list.`);
  const objectFields = ["subcats", "targetMix", "plan", "taxRules", "deductions", "fxRates", "taxSettings", "scheduleFA", "modelSettings", "txnDraft", "archives", "workbook"];
  for (const field of objectFields) if (backup[field] != null && (typeof backup[field] !== "object" || Array.isArray(backup[field]))) throw new Error(`Backup file is corrupt: "${field}" should be an object.`);
  if (backup.workbook?.bytesB64 != null && typeof backup.workbook.bytesB64 !== "string") throw new Error("Backup file is corrupt: workbook data isn't valid.");
  return backup;
}

export function planRestore(backup, currentState) {
  const state = {};
  for (const field of STATE_FIELDS) state[field] = backup[field] !== undefined ? backup[field] : currentState[field];
  const queues = Object.fromEntries(QUEUE_FIELDS.map(field => [field, backup[field] || []]));
  let workbook = null;
  if (backup.workbook?.bytesB64) {
    try { workbook = { bytes: base64ToBytes(backup.workbook.bytesB64), name: backup.workbook.name || "workbook.xlsx" }; }
    catch { throw new Error("Backup's workbook data couldn't be decoded — restore aborted, nothing was changed."); }
  }
  return { state, queues, archives: backup.archives && typeof backup.archives === "object" ? backup.archives : null, workbook };
}
