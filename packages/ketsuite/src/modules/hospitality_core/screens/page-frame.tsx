import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { collectionActions, collectionControls, FormPage, ListPage, shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type PageFrameProps = {
  translator: Translator
  title: string
  frame: Frame
  controls?: JSXChild
  body: JSXChild
  headerActions?: JSXChild
  actions?: JSXChild
  footer?: JSXChild
  controlsMode?: 'legacy' | 'islands'
}

export const ListScreenFrame = ({
  translator: _,
  title,
  frame,
  body,
  controls,
  actions,
  headerActions,
  footer,
  controlsMode = 'legacy',
}: PageFrameProps): TemplateResult => {
  return shell(
    _,
    title,
    <ListPage
      variant="operational"
      frame={frame}
      title={title}
      headerActions={headerActions}
      actions={collectionActions(_, frame, actions)}
      controls={controlsMode === 'islands' ? controls : collectionControls(_, title, frame, controls)}
      body={body}
      footer={footer}
    />,
    { ...frame, chrome: null, topbar: false },
  )
}

export const FormScreenFrame = ({ translator: _, title, frame, body }: PageFrameProps): TemplateResult =>
  shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      title={title}
      actions={collectionActions(_, frame)}
      body={body}
    />,
    { ...frame, chrome: null, topbar: false },
  )
