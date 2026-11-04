import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { shell } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

export function lotPageScreen(
  _: Translator,
  title: string,
  island: JSXChild,
  frame: Frame,
  lang: 'vi' | 'en',
  collaboration?: JSXChild,
) {
  const label = lang === 'vi' ? 'Hướng dẫn màn hình' : 'Screen help'
  return shell(
    _,
    title,
    <>
      {island}
      {collaboration}
    </>,
    {
      ...frame,
      topbar: false,
      titled: false,
      ...(frame.applications ? { applications: { ...frame.applications, helpLabel: label } } : {}),
    },
  )
}
