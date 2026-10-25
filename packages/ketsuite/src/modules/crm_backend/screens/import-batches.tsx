import { CollectionSlot } from '../import-collection.tsx'
import { ActionGroup, LinkButton, Stack } from '@ketvietlab/design-system'
import { ListPage } from '../../../ui/list-page.tsx'
import { Errors, href, listFrame, say } from './import-ui.tsx'
import type { ImportVm } from './import-ui.tsx'

export function ImportBatches(vm: ImportVm) {
  return (
    <ListPage
      variant="operational"
      frame={listFrame}
      title={say(vm, 'Nhập lead', 'Lead imports')}
      headerActions={
        <ActionGroup
          actions={[
            <LinkButton label={say(vm, 'Nhãn hồ sơ', 'Record tags')} href={href(vm, '/admin/crm/tags')} />,
            vm.options.permissions.import ? (
              <LinkButton
                variant="primary"
                label={say(vm, 'Nhập lead mới', 'New lead import')}
                href={href(vm, '/admin/crm/imports/new')}
              />
            ) : null,
          ]}
        />
      }
      controls={<CollectionSlot vm={vm} part="controls" />}
      body={
        <Stack
          items={[
            <Errors vm={vm} />,
            <CollectionSlot vm={vm} part="results" />,
            <CollectionSlot vm={vm} part="footer" />,
          ]}
        />
      }
    />
  )
}
