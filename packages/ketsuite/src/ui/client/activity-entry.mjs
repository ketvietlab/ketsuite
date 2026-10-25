import { each, html, signal } from '@ketvietlab/ketjs-view'
import { createActivityIndicatorView, createRecordActivityView } from './activity-view.mjs'
const runtime = { each, html, signal }
/** @param {Record<string, unknown>} props */
export const record = (props) => createRecordActivityView(runtime, props)
/** @param {Record<string, unknown>} props */
export const indicator = (props) => createActivityIndicatorView(runtime, props)
