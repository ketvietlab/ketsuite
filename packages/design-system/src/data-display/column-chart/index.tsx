import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { axisCeiling, CHART_SERIES } from '../bar-chart/index.tsx'
import type { BarChartKey, BarChartSegment } from '../bar-chart/index.tsx'

export const HOOKS = [
  'column-chart',
  'column-chart-legend',
  'column-chart-legend-item',
  'column-chart-legend-swatch',
  'column-chart-plot',
  'column-chart-axis',
  'column-chart-tick',
  'column-chart-area',
  'column-chart-gridline',
  'column-chart-columns',
  'column-chart-column',
  'column-chart-bar',
  'column-chart-segment',
  'column-chart-reading',
  'column-chart-reference',
  'column-chart-reference-label',
  'column-chart-labels',
  'column-chart-label',
  'column-chart-empty',
] as const

/** One period of the series. `segments` divide `value` in legend order, as in `BarChart`. */
export type ColumnChartPoint = {
  id: string
  /** The period the column stands for, such as "13/10" or "Week 41". */
  label: string
  value: number
  segments?: readonly BarChartSegment[]
}

export type ColumnChartReference = {
  value: number
  /** Names the level and its amount, such as "Daily budget 14m ₫". It is printed and read. */
  label: string
}

export type ColumnChartProps = {
  /** The accessible name of the series; the visible heading belongs to the surface around it. */
  label: string
  points: readonly ColumnChartPoint[]
  /** The magnitude of one column in words, such as "14,200,000 ₫". It follows the period label. */
  value: (point: ColumnChartPoint) => string
  /** What each stacked colour means. Required for a stacked chart to be readable. */
  keys?: readonly BarChartKey[]
  /** A fixed top for the scale. Defaults to a round number above the tallest column and the reference. */
  max?: number
  /** Short text for an axis tick, such as "20m". Defaults to the number. */
  tick?: (value: number) => string
  /** One level every column is compared with, such as a daily budget or a target. */
  reference?: ColumnChartReference | null
  /** Print every n-th period under the columns; the others stay in each column's reading. */
  labelEvery?: number
  empty?: string
}

const finite = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)

const slotOf = (series: number): string => String(((Math.max(1, Math.trunc(series)) - 1) % CHART_SERIES) + 1)

const percent = (value: number, of: number): string =>
  of <= 0 ? '0' : Math.min(100, (finite(value) / of) * 100).toFixed(2)

/**
 * A magnitude over ordered periods: spend per day, orders per week.
 *
 * `BarChart` ranks named things on horizontal bars; this one keeps time on the
 * horizontal axis, so a trend reads left to right. It is HTML for the same reasons:
 * each column is a list item whose reading ("13/10 · 14,200,000 ₫") is real text
 * for a screen reader, a printout and an agent. Pointer hover shows that reading
 * above the columns; the bars, ticks and gridlines are decoration for it.
 *
 * The scale starts at zero and only grows, so negative values are drawn as zero.
 * A `reference` draws one dashed level across the plot and prints its label; it
 * also raises the default top so the level never leaves the plot. With many
 * periods, `labelEvery` keeps the period labels under the plot legible; they are
 * counted back from the latest period, which is always printed.
 */
export const ColumnChart = (props: ColumnChartProps): TemplateResult => {
  const points = props.points
  if (!points.length || points.every((point) => finite(point.value) === 0))
    return <p data-ui="column-chart-empty">{props.empty ?? ''}</p>
  const tallest = Math.max(...points.map((point) => finite(point.value)), finite(props.reference?.value ?? 0))
  const ceiling = props.max !== undefined && props.max > 0 ? props.max : axisCeiling(tallest)
  const stacked = points.some((point) => point.segments?.length)
  const tick = props.tick ?? ((value: number) => String(value))
  const every = Math.max(1, Math.trunc(props.labelEvery ?? 1))
  const half = points.length / 2
  return (
    <figure data-ui="column-chart" data-stacked={stacked ? 'true' : null}>
      {!!props.keys?.length && (
        <ul data-ui="column-chart-legend">
          {each(
            props.keys,
            (key) => key.id,
            (key) => (
              <li data-ui="column-chart-legend-item" data-series={slotOf(key.series)}>
                <span data-ui="column-chart-legend-swatch" aria-hidden="true" />
                {key.label}
              </li>
            ),
          )}
        </ul>
      )}
      <div data-ui="column-chart-plot">
        <div data-ui="column-chart-axis" aria-hidden="true">
          {each(
            [1, 0.5, 0],
            (share) => String(share),
            (share) => (
              <span data-ui="column-chart-tick" style={`inset-block-end: ${share * 100}%`}>
                {tick(ceiling * share)}
              </span>
            ),
          )}
        </div>
        <div data-ui="column-chart-area">
          {each(
            [1, 0.5],
            (share) => String(share),
            (share) => (
              <span
                data-ui="column-chart-gridline"
                aria-hidden="true"
                style={`inset-block-end: ${share * 100}%`}
              />
            ),
          )}
          <ol data-ui="column-chart-columns" aria-label={props.label}>
            {each(
              points,
              (point) => point.id,
              (point, index) => (
                <li data-ui="column-chart-column" data-half={index >= half ? 'end' : 'start'}>
                  <span
                    data-ui="column-chart-bar"
                    aria-hidden="true"
                    data-series={
                      point.segments?.length ? null : props.keys?.length ? slotOf(props.keys[0]!.series) : '1'
                    }
                    style={`block-size: ${percent(point.value, ceiling)}%`}
                  >
                    {!!point.segments?.length &&
                      each(
                        point.segments,
                        (segment) => String(segment.series),
                        (segment) => (
                          <span
                            data-ui="column-chart-segment"
                            data-series={slotOf(segment.series)}
                            style={`block-size: ${percent(segment.value, finite(point.value))}%`}
                          />
                        ),
                      )}
                  </span>
                  <span data-ui="column-chart-reading">{`${point.label} · ${props.value(point)}`}</span>
                </li>
              ),
            )}
          </ol>
          {!!props.reference && finite(props.reference.value) > 0 && (
            <p
              data-ui="column-chart-reference"
              style={`inset-block-end: ${percent(props.reference.value, ceiling)}%`}
            >
              <span data-ui="column-chart-reference-label">{props.reference.label}</span>
            </p>
          )}
        </div>
        <ol data-ui="column-chart-labels" aria-hidden="true">
          {each(
            points,
            (point) => point.id,
            (point, index) => (
              <li
                data-ui="column-chart-label"
                data-printed={(points.length - 1 - index) % every === 0 ? 'true' : 'false'}
              >
                {point.label}
              </li>
            ),
          )}
        </ol>
      </div>
    </figure>
  )
}
