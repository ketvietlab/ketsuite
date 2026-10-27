/** Browser-only extension boundary for deployments with an external identity provider. */
export { createRecordModal, createRecordPage } from './record-modal.tsx'
export type { RecordModalDefinition, RecordModalContext, RecordContextEnvelope } from './record-modal.tsx'
export {
  userModalDefinition,
  userPageActions,
  userPageDefinition,
} from '../../modules/user_backend/modal/user-modal-view.tsx'
export type { UserModalData } from '../../modules/user_backend/modal/user-modal-view.tsx'
