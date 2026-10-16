import { signal } from '@ketvietlab/ketjs-view'
import { Button, Field, ImageDropZone, Stack, Text } from '@ketvietlab/design-system'
import { IMAGE_TYPES, validateImage } from './image-upload.tsx'
import { safeImage } from './renderer.tsx'
import type { StudioContext } from './types.ts'

type LogoState = { url: string; busy: boolean; dragging: boolean; error: string; status: string }
const empty = (): LogoState => ({ url: '', busy: false, dragging: false, error: '', status: '' })

/** Site appearance keeps a staged URL. Only the resource's Save commits that reference. */
export function createThemeLogo(ctx: StudioContext) {
  const state = signal(empty())
  let owner: { siteId: string; key: string } | null = null
  let pending: { abort: AbortController; form?: HTMLFormElement; release: () => void } | null = null
  const editable = () => !!owner && ctx.can('website.site.manage') && !ctx.busy()
  const cancel = () => {
    pending?.abort.abort()
    pending?.release()
    pending = null
  }
  const load = (siteId: string, recordId: string, revisionId: string | null, url: string) => {
    const key = `${siteId}:${recordId}:${revisionId ?? 'new'}`
    if (owner?.key === key) return
    cancel()
    owner = { siteId, key }
    state.set({ ...empty(), url })
  }
  const select = async (files: File[], form?: HTMLFormElement) => {
    if (!files.length || !editable() || state().busy || owner!.siteId !== ctx.site().id) return
    if (files.length !== 1 || !validateImage(files[0])) {
      state.set({ ...state(), dragging: false, error: ctx.tr('website.themeLogo.invalid'), status: '' })
      return
    }
    const siteId = owner!.siteId
    let released = false
    if (form) form.dataset.uploading = String(Number(form.dataset.uploading || 0) + 1)
    const request = {
      abort: new AbortController(),
      form,
      release: () => {
        if (released) return
        released = true
        if (form) form.dataset.uploading = String(Math.max(0, Number(form.dataset.uploading || 1) - 1))
      },
    }
    pending = request
    state.set({
      ...state(),
      busy: true,
      dragging: false,
      error: '',
      status: ctx.tr('website.themeLogo.uploading'),
    })
    try {
      const uploaded = await ctx.uploadImage(files[0], {
        siteId,
        id: siteId,
        resModel: 'website.Site',
        field: 'logo',
        signal: request.abort.signal,
      })
      if (
        pending !== request ||
        request.abort.signal.aborted ||
        siteId !== ctx.site().id ||
        (form && !form.isConnected)
      )
        return
      if (!uploaded.url || safeImage(uploaded.url) !== uploaded.url) throw new Error('invalid logo URL')
      state.set({ ...state(), url: uploaded.url, status: ctx.tr('website.themeLogo.uploaded') })
    } catch {
      if (pending === request && !request.abort.signal.aborted && (!form || form.isConnected))
        state.set({ ...state(), error: ctx.tr('website.themeLogo.failed'), status: '' })
    } finally {
      request.release()
      if (pending === request) {
        pending = null
        state.set({
          ...state(),
          busy: false,
          status:
            state().error || state().status === ctx.tr('website.themeLogo.uploading') ? '' : state().status,
        })
      }
    }
  }
  const remove = () => {
    if (!editable() || state().busy) return
    state.set({ ...empty(), status: ctx.tr('website.themeLogo.removed') })
  }
  const drag = (dragging: boolean) => {
    if (editable() && !state().busy && state().dragging !== dragging) state.set({ ...state(), dragging })
  }
  return {
    load,
    select,
    remove,
    value: () => state().url,
    busy: () => state().busy,
    dispose: () => {
      cancel()
      owner = null
      state.set(empty())
    },
    view: (initial: string, disabled: boolean) => (
      <Field
        id="themes-logo-file"
        name="logo"
        label={ctx.tr('website.resource.themes.logo')}
        layout="inline"
        control={
          // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegates native controls and receives file drops.
          <div
            class="website-theme-logo"
            onChange={(event: Event) => {
              const input = event.target as HTMLInputElement
              if (input.type !== 'file' || disabled) return
              const files = Array.from(input.files ?? [])
              input.value = ''
              void select(files, input.closest('form') ?? undefined)
            }}
            onClick={(event: Event) => {
              if (!disabled && (event.target as Element).closest('button[name="theme-logo-remove"]')) remove()
            }}
            onDragOver={(event: DragEvent) => {
              if (!event.dataTransfer?.types.includes('Files')) return
              event.preventDefault()
              event.dataTransfer.dropEffect = disabled || !editable() || state().busy ? 'none' : 'copy'
              if (!disabled) drag(true)
            }}
            onDragLeave={(event: DragEvent) => {
              if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
                drag(false)
            }}
            onDrop={(event: DragEvent) => {
              event.preventDefault()
              drag(false)
              if (!disabled)
                void select(
                  Array.from(event.dataTransfer?.files ?? []),
                  (event.currentTarget as HTMLElement).closest('form') ?? undefined,
                )
            }}
          >
            {(() => {
              const value = owner ? state() : { ...empty(), url: initial }
              const locked = disabled || value.busy || !ctx.can('website.site.manage') || ctx.busy()
              return (
                <>
                  <input type="hidden" name="logo" value={value.url} />
                  <Stack
                    items={[
                      <ImageDropZone
                        label={ctx.tr('website.resource.themes.logo')}
                        busy={value.busy}
                        dragging={value.dragging}
                        error={value.error}
                        help={ctx.tr('website.themeLogo.help')}
                        viewer={
                          value.url ? (
                            <img src={safeImage(value.url)} alt={ctx.tr('website.resource.themes.logo')} />
                          ) : null
                        }
                        picker={
                          <label data-ui="image-drop-picker">
                            <input
                              id="themes-logo-file"
                              name="logo-file"
                              type="file"
                              accept={IMAGE_TYPES}
                              disabled={locked}
                              aria-label={ctx.tr(
                                value.url ? 'website.themeLogo.replace' : 'website.themeLogo.choose',
                              )}
                            />
                            <span>
                              {ctx.tr(value.url ? 'website.themeLogo.replace' : 'website.themeLogo.choose')}
                            </span>
                          </label>
                        }
                        actions={
                          value.url ? (
                            <Button
                              name="theme-logo-remove"
                              label={ctx.tr('website.themeLogo.remove')}
                              disabled={locked}
                            />
                          ) : null
                        }
                      />,
                      value.status ? (
                        <span role="status" aria-live="polite">
                          <Text variant="bodySm" tone="muted">
                            {value.status}
                          </Text>
                        </span>
                      ) : null,
                    ]}
                  />
                </>
              )
            })()}
          </div>
        }
      />
    ),
  }
}
