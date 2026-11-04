/** A scan keeps the digest of the barcode it read; the barcode is not a catalogue ID. */
export const stockStaffChannelCatalogueEvidence = {
  'stock_staff_channel.ScanEvent': ['barcodeFingerprint'],
} as const satisfies Readonly<Record<string, readonly string[]>>
