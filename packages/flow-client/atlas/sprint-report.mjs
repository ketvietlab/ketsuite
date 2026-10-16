import { isDone } from '@ketvietlab/flow-client/project-catalogs.mjs'

// Development-only snapshot shared by seeded history and the mock close command.
export function sprintReport(data, tasks, initial, carryTo = 'Backlog') {
  const completed = tasks.filter((task) => isDone(data, task))
  return {
    closedAt: new Date().toISOString(),
    tasks: tasks.map(({ id, title, status, points }) => ({ id, title, status, points })),
    completedPoints: completed.reduce((sum, task) => sum + (task.points || 0), 0),
    committedPoints: initial.reduce((sum, task) => sum + (task.points || 0), 0),
    added: tasks.filter((task) => !initial.some((item) => item.id === task.id)).length,
    removed: initial.filter((item) => !tasks.some((task) => task.id === item.id)).length,
    taskIds: tasks.map((task) => task.id),
    completed: completed.length,
    carried: tasks.length - completed.length,
    carryTo,
  }
}
