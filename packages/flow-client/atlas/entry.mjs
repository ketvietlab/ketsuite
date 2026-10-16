import { createFlowWorkspace } from '@ketvietlab/flow-client'
import { createFnClient, createFileUploader } from '@ketvietlab/flow-client/api'

let navigation
export function attachAtlasNavigation(context) {
  navigation = context.navigation
  context.document.addEventListener(
    'ket:navigation-error',
    (event) => {
      console.error('Flow navigation failed:', event.detail.error)
    },
    { signal: context.lifetime },
  )
  return () => {
    navigation = undefined
  }
}

/** KetJS owns hydration, keyed island reconciliation and fragment navigation. */
export function createAtlasWorkspace(props) {
  const config = JSON.parse(document.getElementById('flow-environment').textContent)
  const headers = { 'x-flow-fixture': config.session }
  return createFlowWorkspace(props, {
    call: createFnClient({ headers }),
    upload: createFileUploader({ headers }),
    navigatePage: (target, options) => navigation.navigate(target, options),
  })
}
