import { routeScope, workspaceRecordTarget } from '@ketvietlab/flow-client/navigation.mjs'

// Default editor IDs are not route ownership. Only an explicit record may resolve
// its owner; otherwise a workspace page must retain the requested workspace.
export const atlasShellRequest = (props) => ({
  shellOnly: true,
  companyId: props.companyId,
  workspaceId: props.workspaceId,
  projectId: routeScope(props.screen, props.scope) === 'project' ? props.project : undefined,
  route: props.screen,
  recordId: props.recordProvided ? props.record : undefined,
})

export const atlasShellProps = (props, chrome) => {
  const target = workspaceRecordTarget(props.screen, props.record, props.recordProvided, props.workspaceId)
  return {
    ...props,
    ...(target !== null ? { record: target, recordProvided: true } : {}),
    chrome,
    workspaceId: chrome?.context?.workspaceId ?? props.workspaceId,
    project:
      chrome?.context?.projectId ??
      (routeScope(props.screen, props.scope) === 'project' ? props.project : ''),
    scope:
      props.recordProvided && ['page', 'page-child', 'page-move'].includes(props.screen) && chrome?.context
        ? chrome.context.projectId
          ? 'project'
          : 'workspace'
        : props.scope,
  }
}
