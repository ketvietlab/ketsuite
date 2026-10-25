export const untitledDocument = 'Untitle'

// A note's first nonempty text line owns its title. Rich marks, block IDs and
// subsequent lines remain content; extracting the title never rewrites them.
export function documentTitle(blocks) {
  for (const block of blocks) {
    const text =
      block.text ??
      block.delta?.map((part) => (typeof part.insert === 'string' ? part.insert : '')).join('') ??
      ''
    const line = text.split(/\r\n|\r|\n/).find((value) => value.trim())
    if (line) return line.trim()
  }
  return untitledDocument
}

export function noteInput({ projectId = null, parent = null, visibility = 'shared' } = {}) {
  return {
    collection: 'pages',
    title: untitledDocument,
    titleSource: 'content',
    description: untitledDocument,
    blocks: [{ id: 'title', type: 'h1', text: untitledDocument }],
    projectId: parent ? (parent.projectId ?? null) : projectId,
    parentId: parent?.id ?? null,
    visibility: parent?.visibility ?? visibility,
  }
}
