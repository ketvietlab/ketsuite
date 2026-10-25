import { randomUUID } from 'node:crypto'
import type { Translator } from '@ketvietlab/ketjs'
import {
  ActionGroup,
  ActionMenu,
  Badge,
  Button,
  CardGrid,
  ConfirmDialog,
  ContentCard,
  Dialog,
  EmptyState,
  Field,
  FileUpload,
  FormGrid,
  LinkButton,
  Notice,
  RecordForm,
  Section,
  Stack,
  Text,
} from '@ketvietlab/design-system'
import { CONTENT_IMAGE_CATEGORIES } from '../types.ts'
import { hospitalityScopedHref } from './scoped-href.ts'
import type { PropertyWorkbench } from './property-workbench.tsx'
import type { PropertyDetail } from './shared.tsx'

export function propertyGallery(
  _: Translator,
  property: PropertyDetail,
  data: PropertyWorkbench,
  url: URL,
  can: Record<string, boolean>,
  errors: readonly string[],
  draft?: Record<string, string>,
) {
  const t = (key: string, values?: Record<string, string | number>) =>
    _(`hospitality_core.gallery.${key}`, values)
  const base = new URL(url)
  for (const key of ['dialog', 'item', 'image', 'status', 'record']) base.searchParams.delete(key)
  const href = (values: Record<string, string> = {}) => {
    const next = new URL(base)
    for (const [key, value] of Object.entries(values))
      value ? next.searchParams.set(key, value) : next.searchParams.delete(key)
    return next.pathname + next.search
  }
  const items = data.images ?? [],
    roomType = data.roomTypes.find((row) => row.id === data.photoTarget),
    targetName = String(roomType?.name ?? property.name),
    action = href()
  const hidden = (operation: string, imageId?: string) => ({
    operation,
    ...(imageId ? { imageId } : {}),
    ...(roomType ? { roomTypeId: String(roomType.id) } : {}),
    expectedPropertyVersion: String(property.version ?? 0),
    requestKey: randomUUID(),
  })
  const form = (id: string, fields: Record<string, string>) => (
    <form id={id} action={action} method="post" hidden>
      {Object.entries(fields).map(([name, value]) => (
        <input type="hidden" name={name} value={value} autocomplete="off" />
      ))}
    </form>
  )
  const selected = items.find((row) => row.id === url.searchParams.get('image')),
    dialog = url.searchParams.get('dialog')
  const imageFields = (row?: Record<string, unknown>) => [
    {
      id: 'gallery-category',
      name: 'category',
      type: 'select' as const,
      label: t('category'),
      required: true,
      value: draft?.category ?? String(row?.category ?? (roomType ? 'room' : 'exterior')),
      options: CONTENT_IMAGE_CATEGORIES.map((value) => ({ value, label: t(`category.${value}`) })),
    },
    {
      id: 'gallery-caption',
      name: 'caption',
      label: t('caption'),
      value: draft?.caption ?? String(row?.caption ?? ''),
      maxLength: 120,
      help: t('captionHint'),
    },
  ]
  const upload = new URL(
    hospitalityScopedHref(
      url,
      `/admin/hospitality/content/upload?property=${encodeURIComponent(property.id)}&target=${roomType ? encodeURIComponent(`room_type:${roomType.id}`) : 'property'}`,
    ),
    url,
  )
  const overlay =
    dialog === 'image-upload' && can.attachContentImage ? (
      <Dialog
        id="property-image-upload"
        title={t('upload')}
        closeHref={action}
        closeLabel={t('cancel')}
        body={
          <form action={upload.pathname + upload.search} method="post" enctype="multipart/form-data">
            <Stack
              items={[
                errors.length ? (
                  <Notice tone="danger" title={t('failed')} message={errors.join(' · ')} />
                ) : null,
                <Text variant="bodySm">{targetName}</Text>,
                <input
                  type="hidden"
                  name="expectedPropertyVersion"
                  value={String(property.version ?? 0)}
                  autocomplete="off"
                />,
                <input type="hidden" name="requestKey" value={randomUUID()} autocomplete="off" />,
                <FileUpload
                  id="gallery-upload-file"
                  name="file"
                  label={t('image')}
                  accept="image/jpeg,image/png,image/webp"
                  required
                  help={t('rules')}
                />,
                <FormGrid items={imageFields().map((field) => <Field {...field} />)} />,
                <ActionGroup
                  actions={[
                    <Button type="submit" label={t('upload')} variant="primary" />,
                    <LinkButton href={action} label={t('cancel')} />,
                  ]}
                />,
              ]}
            />
          </form>
        }
      />
    ) : dialog === 'image-edit' && selected && can.updateContentImage ? (
      <Dialog
        id="property-image-edit"
        title={t('edit')}
        closeHref={action}
        closeLabel={t('cancel')}
        body={
          <RecordForm
            action={href({ dialog: 'image-edit', image: String(selected.id) })}
            method="post"
            hidden={hidden('image-update', String(selected.id))}
            fields={imageFields(selected)}
            errors={errors}
            submitLabel={t('save')}
            cancelHref={action}
            cancelLabel={t('cancel')}
          />
        }
      />
    ) : dialog === 'image-remove' && selected && can.removeContentImage ? (
      <>
        {form('property-image-remove-form', hidden('image-remove', String(selected.id)))}
        <ConfirmDialog
          id="property-image-remove-confirm"
          title={t('remove')}
          message={t(selected.primary ? 'primaryBlocked' : 'removeHint', {
            name: String(selected.caption || t(`category.${selected.category}`)),
          })}
          closeHref={action}
          closeLabel={t('cancel')}
          confirmLabel={t('remove')}
          confirmForm="property-image-remove-form"
          confirmDisabled={!!selected.primary}
          details={
            <Stack
              items={[
                errors.length ? (
                  <Notice tone="danger" title={t('failed')} message={errors.join(' · ')} />
                ) : null,
                <Text variant="bodySm">{t('channelHint')}</Text>,
              ]}
            />
          }
        />
      </>
    ) : null
  return (
    <Stack
      items={[
        <Section
          title={t('title', { name: targetName })}
          actions={
            can.attachContentImage && items.length < 30 ? (
              <LinkButton href={href({ dialog: 'image-upload' })} label={t('upload')} />
            ) : undefined
          }
          body={
            <Stack
              items={[
                <ActionGroup
                  actions={[
                    <LinkButton href={href({ photos: '' })} label={t('property')} />,
                    ...data.roomTypes.map((row) => (
                      <LinkButton
                        href={href({ photos: String(row.id) })}
                        label={`${row.name} (${row.imageCount ?? 0}/3)`}
                      />
                    )),
                  ]}
                />,
                <Text variant="bodySm">{t('rules')}</Text>,
                <Text variant="bodySm">
                  {t('count', { count: items.length, required: roomType ? 3 : 5 })}
                </Text>,
                !can.listContentImages ? (
                  <Notice title={t('denied')} message={t('deniedHint')} />
                ) : items.length ? (
                  <CardGrid
                    items={items}
                    id={(row) => row.id}
                    minimum="compact"
                    card={(row) => {
                      const index = items.indexOf(row),
                        id = String(row.id),
                        commands = []
                      const primaryForm = `gallery-primary-${index}`,
                        upForm = `gallery-up-${index}`,
                        downForm = `gallery-down-${index}`
                      const order = (delta: number) => {
                        const ids = items.map((item) => String(item.id))
                        ;[ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]
                        return JSON.stringify(ids)
                      }
                      if (can.setPrimaryContentImage && !row.primary)
                        commands.push({ id: 'primary', label: t('makePrimary'), form: primaryForm })
                      if (can.reorderContentImages && index > 0)
                        commands.push({ id: 'up', label: t('up'), form: upForm })
                      if (can.reorderContentImages && index < items.length - 1)
                        commands.push({ id: 'down', label: t('down'), form: downForm })
                      if (can.updateContentImage)
                        commands.push({
                          id: 'edit',
                          label: t('edit'),
                          href: href({ dialog: 'image-edit', image: id }),
                        })
                      if (can.removeContentImage)
                        commands.push({
                          id: 'remove',
                          label: t('remove'),
                          href: href({ dialog: 'image-remove', image: id }),
                          destructive: true,
                          disabled: !!row.primary,
                          description: row.primary ? t('primaryBlocked') : undefined,
                        })
                      return (
                        <ContentCard
                          title={String(row.caption || t(`category.${row.category}`))}
                          media={
                            <img
                              src={`/files/${encodeURIComponent(String(row.attachmentId))}`}
                              alt={String(row.caption || t(`category.${row.category}`))}
                              loading="lazy"
                            />
                          }
                          status={row.primary ? <Badge label={t('primary')} tone="info" /> : undefined}
                          meta={<Text variant="bodySm">{t(`category.${row.category}`)}</Text>}
                          actions={
                            <>
                              {can.setPrimaryContentImage && !row.primary
                                ? form(primaryForm, hidden('image-primary', id))
                                : null}
                              {can.reorderContentImages && index > 0
                                ? form(upForm, { ...hidden('image-reorder'), ids: order(-1) })
                                : null}
                              {can.reorderContentImages && index < items.length - 1
                                ? form(downForm, { ...hidden('image-reorder'), ids: order(1) })
                                : null}
                              {commands.length ? (
                                <ActionMenu
                                  id={`gallery-actions-${index}`}
                                  label={t('actions')}
                                  triggerLabel={t('actions')}
                                  items={commands}
                                />
                              ) : null}
                            </>
                          }
                        />
                      )
                    }}
                  />
                ) : (
                  <EmptyState title={t('empty')} message={t('emptyHint')} />
                ),
                <Text variant="bodySm">{t('channelHint')}</Text>,
              ]}
            />
          }
        />,
        overlay,
      ]}
    />
  )
}
