// A single native enhancement boundary shared by versioned island entry points.
// It imports no workspace, messages or data controllers.
let navigation
export function attachFlowNavigation(context) {
  navigation = context.navigation
  return () => {
    if (navigation === context.navigation) navigation = undefined
  }
}
export function navigateFlow(target, options) {
  if (!navigation) throw new Error('Flow navigation is not attached')
  return navigation.navigate(target, options)
}
