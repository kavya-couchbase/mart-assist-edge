// Paste into Capella > App Services > App Endpoint > products collection > Access Control (sync function)
function (doc, oldDoc, meta) {
  if (doc._deleted) { requireAccess("store"); channel("store"); return; }
  if (doc.type !== "product") throw({ forbidden: "only product documents" });
  requireAccess("store");
  channel("store");
}
