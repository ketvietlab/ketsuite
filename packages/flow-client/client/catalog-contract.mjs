// Pure catalog vocabulary shared by the client, Atlas and typed server.
export const statusKinds = Object.freeze(['todo', 'progress', 'review', 'done'])
export const taskTypeIcons = Object.freeze(['list', 'flag', 'layers'])
export const catalogColors = Object.freeze(['neutral', 'blue', 'green', 'yellow', 'red'])
export const catalogTitleKey = (title) => title.trim().toLocaleLowerCase()
