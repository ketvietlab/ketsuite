import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createFnClient, createFileUploader } from '@ketvietlab/flow-client/api'
import { navigateFlow } from '@ketvietlab/flow-client/navigation-host.mjs'
/** Native KetJS supplies navigation; the shared controller owns the UI. */
export function createProductionWorkspace(props, dependencies = {}) {
  return createFlowWorkspace(props, {
    call: createFnClient(),
    upload: createFileUploader(),
    navigatePage: navigateFlow,
    ...dependencies,
  })
}
