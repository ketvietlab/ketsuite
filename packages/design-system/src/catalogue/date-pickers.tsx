import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  DatePresetPicker,
  datePresetIds,
  datePresetLabel,
  resolveDatePreset,
} from '../forms/date-presets/index.tsx'
import { DatePicker, DateRangePicker, DateTimePicker } from '../forms/date-time/index.tsx'
import { Field } from '../primitives/field/index.tsx'
import { Disclosure, Stack } from '../layouts/index.tsx'

/** Fixed civil today makes catalogue and browser checks reproducible. */
export const DatePickerExamples = (props: { showStates?: boolean } = {}): TemplateResult => (
  <Stack
    gap="loose"
    items={[
      Field({
        id: 'catalogue-record-date-en',
        name: 'recordDate',
        label: 'Record date · English host',
        type: 'date',
        value: '2026-10-04',
        locale: 'en',
      }),
      <Disclosure
        summary="Khoảng ngày cố định · 04/10/2026"
        body={
          <dl>
            {datePresetIds.map((preset) => {
              const range = resolveDatePreset(preset, '2026-10-04')
              return (
                <div>
                  <dt>{datePresetLabel(preset, 'vi')}</dt>
                  <dd>
                    {range.start} → {range.end}
                  </dd>
                </div>
              )
            })}
          </dl>
        }
      />,
      <DatePresetPicker
        id="dashboard-period"
        label="Kỳ báo cáo"
        value="last_30_days"
        today="2026-10-04"
        href={(period) => `?period=${period}`}
      />,
      <DatePicker
        id="date"
        name="date"
        label="Ngày giao hàng"
        value="2026-09-30"
        today="2026-09-30"
        help="Chọn trên lịch hoặc nhập ngày trực tiếp."
      />,
      <DatePicker
        id="date-japanese"
        name="releaseDate"
        label="公開日"
        locale="ja"
        value="2026-10-11"
        today="2026-10-11"
      />,
      <DateTimePicker
        id="appointment"
        name="appointment"
        label="Ngày và giờ hẹn"
        value="2026-09-30T09:00"
        today="2026-09-30"
        required
      />,
      <DateTimePicker
        id="locked-appointment"
        name="lockedAppointment"
        label="Ngày và giờ đã khóa"
        value="2026-09-30T09:00"
        today="2026-09-30"
        disabled
      />,
      <Field
        id="english-deadline"
        name="englishDeadline"
        label="Due by"
        type="datetime-local"
        locale="en"
        value="2026-09-30T09:00"
      />,
      <DateRangePicker
        id="range"
        label="Khoảng thời gian báo cáo"
        today="2026-09-30"
        start={{ id: 'from', name: 'from', value: '2026-09-01' }}
        end={{ id: 'to', name: 'to', value: '2026-09-30' }}
        startLabel="Từ ngày"
        endLabel="Đến ngày"
      />,
      <DateRangePicker
        id="range-filter"
        variant="filter"
        label="Kỳ báo cáo"
        start={{ id: 'filter-from', name: 'from', value: '2026-09-01' }}
        end={{ id: 'filter-to', name: 'to', value: '2026-09-30' }}
        startLabel="Từ ngày"
        endLabel="Đến ngày"
      />,
      <Disclosure
        summary="Giới hạn ngày và trạng thái"
        open={props.showStates}
        body={
          <Stack
            items={[
              <DatePicker
                id="bounded-date"
                name="boundedDate"
                label="Lịch hẹn"
                min="2026-09-10"
                max="2026-09-20"
                today="2026-09-30"
                help="Chỉ nhận lịch từ 10 đến 20/09/2026."
              />,
              <DatePicker
                id="readonly-date"
                name="readonlyDate"
                label="Ngày xác nhận"
                value="2026-09-15"
                readOnly
              />,
              <DatePicker
                id="disabled-date"
                name="disabledDate"
                label="Ngày lưu trữ"
                value="2026-09-15"
                disabled
              />,
              <DatePicker
                id="invalid-date"
                name="invalidDate"
                label="Ngày nghiệm thu"
                error="Vui lòng chọn ngày nghiệm thu."
                today="2026-09-30"
              />,
              <DateRangePicker
                id="bounded-range"
                label="Khoảng ngày có giới hạn"
                today="2026-09-30"
                start={{ id: 'bounded-from', name: 'boundedFrom', min: '2026-09-10', max: '2026-09-30' }}
                end={{ id: 'bounded-to', name: 'boundedTo', min: '2026-09-10', max: '2026-09-30' }}
                startLabel="Từ ngày"
                endLabel="Đến ngày"
              />,
            ]}
          />
        }
      />,
    ]}
  />
)
