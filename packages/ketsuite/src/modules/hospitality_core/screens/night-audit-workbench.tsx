import { hospitalityScopedHref } from './scoped-href.ts'
import {
  Button,
  ConfirmDialog,
  LinkButton,
  Notice,
  RecordForm,
  Section,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
export type NightAuditWorkbench = {
  businessDate: string
  propertyVersion: number
  timezone: string
  closing: boolean
  runState: string | null
  canClose: boolean
  pending: number
  arrivals: Array<{
    id: string
    code: string
    guest: string
    guaranteeKind: string
    guaranteeValid?: boolean
    version: number
    choice: string | null
    editable: boolean
  }>
}
export function nightAuditWorkbench(
  _: Translator,
  o: {
    data: NightAuditWorkbench
    propertyId: string
    auditDate: string
    url: URL
    requestKey: string
    canDecide: boolean
    canClose: boolean
  },
): TemplateResult {
  const t = (key: string, params?: Record<string, unknown>) =>
      _(`hospitality_core.auditWorkbench.${key}`, params),
    data = o.data
  const listUrl = new URL(o.url)
  listUrl.searchParams.delete('step')
  const confirmUrl = new URL(listUrl)
  confirmUrl.searchParams.set('step', 'preview')
  const action = listUrl.pathname + listUrl.search,
    closeHref = action,
    form = 'hospitality-close-business-date'
  return (
    <Stack
      items={[
        <Section
          title={t('arrivals')}
          body={
            <Stack
              items={[
                data.arrivals.length ? (
                  data.arrivals.map((row) => (
                    <Section
                      title={`${row.code} · ${row.guest}`}
                      body={
                        <Stack
                          items={[
                            <Text variant="bodySm">{t(`guarantee.${row.guaranteeKind}`)}</Text>,
                            row.guaranteeValid === false ? (
                              <Notice
                                tone="warning"
                                title={t('guaranteeInvalid')}
                                message={t('guaranteeInvalidHint')}
                                actions={
                                  <LinkButton
                                    href={hospitalityScopedHref(
                                      o.url,
                                      `/admin/hospitality/reservations/${encodeURIComponent(row.id)}?action=guarantee`,
                                    )}
                                    label={t('repairGuarantee')}
                                  />
                                }
                              />
                            ) : null,
                            row.guaranteeValid !== false &&
                            row.editable &&
                            o.canDecide &&
                            !data.closing &&
                            !['running', 'queued', 'completed'].includes(data.runState ?? '') ? (
                              <RecordForm
                                action={action}
                                method="post"
                                submitLabel={t('saveChoice')}
                                hidden={{
                                  operation: 'decide-arrival',
                                  propertyId: o.propertyId,
                                  reservationId: row.id,
                                  auditDate: o.auditDate,
                                  expectedVersion: String(row.version),
                                  requestKey: `${o.requestKey}:${row.id}`,
                                }}
                                fields={[
                                  {
                                    id: `arrival-choice-${row.id}`,
                                    name: 'choice',
                                    label: t('choice'),
                                    type: 'select',
                                    value: row.choice ?? '',
                                    required: true,
                                    options: [
                                      { value: '', label: t('choose') },
                                      { value: 'hold', label: t('hold') },
                                      { value: 'no_show', label: t('noShow') },
                                    ],
                                  },
                                ]}
                              />
                            ) : (
                              <Text variant="bodySm">{t(row.choice === 'hold' ? 'hold' : 'noShow')}</Text>
                            ),
                          ]}
                        />
                      }
                    />
                  ))
                ) : (
                  <Text variant="bodySm">{t('noArrivals')}</Text>
                ),
              ]}
            />
          }
        />,
        data.closing || data.runState === 'running' || data.runState === 'queued' ? (
          <Notice tone="info" title={t('running')} message={t('runningHint')} />
        ) : data.runState === 'completed' ? (
          <Notice
            tone="positive"
            title={t('completed')}
            message={t('completedHint', { date: o.auditDate })}
          />
        ) : (
          <Section
            title={t('close')}
            body={
              <Stack
                items={[
                  !data.canClose && (
                    <Notice
                      tone="warning"
                      title={t('notReady')}
                      message={
                        data.pending
                          ? t('pending', { count: data.pending })
                          : t('cutoff', { date: data.businessDate, timezone: data.timezone })
                      }
                    />
                  ),
                  data.canClose && o.canClose ? (
                    <LinkButton
                      href={confirmUrl.pathname + confirmUrl.search}
                      label={t('review')}
                      variant="primary"
                    />
                  ) : (
                    <Button label={t('review')} disabled />
                  ),
                ]}
              />
            }
          />
        ),
        o.url.searchParams.get('step') === 'preview' && data.canClose && o.canClose ? (
          <>
            <form id={form} action={action} method="post">
              <input type="hidden" name="operation" value="request-night-audit" autocomplete="off" />
              <input type="hidden" name="propertyId" value={o.propertyId} autocomplete="off" />
              <input type="hidden" name="auditDate" value={o.auditDate} autocomplete="off" />
              <input
                type="hidden"
                name="expectedVersion"
                value={String(data.propertyVersion)}
                autocomplete="off"
              />
              <input type="hidden" name="requestKey" value={o.requestKey} autocomplete="off" />
            </form>
            <ConfirmDialog
              id="hospitality-close-confirmation"
              title={t('close')}
              message={t('confirm', { date: o.auditDate })}
              confirmLabel={t('close')}
              confirmForm={form}
              closeHref={closeHref}
              closeLabel={t('cancel')}
              details={<Text variant="bodySm">{t('irreversible')}</Text>}
            />
          </>
        ) : null,
      ]}
    />
  )
}
