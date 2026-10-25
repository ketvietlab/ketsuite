import { createHash, randomUUID } from 'node:crypto'

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const digest = '[a-f0-9]{64}'
const ownerKey = (id: string) => createHash('sha256').update(id).digest('hex')

/** This namespace is immutable and cannot be claimed by generic attachment writers. */
export const flowBlobPrefix = (company: string) => `blobs/${company}/flow/`
export const flowUploadKey = (company: string, id: string, checksum: string) =>
  `${flowBlobPrefix(company)}uploads/${id}/${checksum}`

export const flowSnapshotKey = (company: string, kind: 'page' | 'issue', id: string, checksum: string) =>
  `${flowBlobPrefix(company)}documents/${kind}/${ownerKey(id)}/${randomUUID()}/${checksum}`

export function isFlowSnapshotKey(
  key: string,
  company: string,
  kind: 'page' | 'issue',
  id: string,
  checksum: string,
) {
  const prefix = `${flowBlobPrefix(company)}documents/${kind}/${ownerKey(id)}/`
  return (
    key.startsWith(prefix) &&
    new RegExp(`^${uuid}/${digest}$`).test(key.slice(prefix.length)) &&
    key.endsWith('/' + checksum)
  )
}

export function isExclusiveFlowBlob(key: string, company: string) {
  const prefix = flowBlobPrefix(company)
  return (
    key.startsWith(prefix) &&
    new RegExp(`^(uploads/${uuid}/${digest}|documents/(page|issue)/${digest}/${uuid}/${digest})$`).test(
      key.slice(prefix.length),
    )
  )
}
