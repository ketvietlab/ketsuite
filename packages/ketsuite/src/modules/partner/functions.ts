// Compatibility export for existing transactional consumers. The registry and
// named handlers live in functions/; this entry point contains no business logic.
export { functions, defaultAddressFor, snapshotPartnerAddress } from './functions/index.ts'
