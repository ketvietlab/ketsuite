import { exampleApplications } from './application-switcher.ts'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Icon } from '../primitives/icon/index.tsx'
import { ReorderList } from '../interactions/reorder-list/index.tsx'
import { ActionGroup, Button, IconButton, LinkButton, Link } from '../primitives/actions.tsx'
import { Avatar, Badge, Code, CodeBlock, CountBadge, Tag, Text, MediaLabel } from '../primitives/status.tsx'
import { EmptyState, LoadingState, Notice } from '../primitives/feedback.tsx'
import { Field } from '../primitives/field.tsx'
import { Breadcrumbs, NavList, TabbedView, Tabs } from '../primitives/navigation.tsx'
import { Progress } from '../primitives/progress.tsx'
import {
  CardGrid,
  ContentCard,
  Disclosure,
  Grid,
  Inline,
  KanbanCard,
  KanbanGrid,
  Metric,
  Section,
  Stack,
  Surface,
} from '../layouts/index.tsx'
import { AppBrand, AppShell, AppSwitcherHelp, AppTopbar, Page } from '../layouts/shell.tsx'
import { NavigationToggle, AppNavigation } from '../layouts/app-navigation.tsx'
import { DataTable } from '../patterns/data-table.tsx'
import { BulkActions, ListChrome } from '../patterns/list-chrome.tsx'
import { BoardPage } from '../patterns/board-page.tsx'
import { DashboardPage } from '../patterns/dashboard-page.tsx'
import { ListPage } from '../patterns/list-page.tsx'
import { FormPage } from '../patterns/form-page.tsx'
import { RecordPage } from '../patterns/record-page.tsx'
import { WorkspacePage } from '../patterns/workspace-page.tsx'
import { HelpDrawer } from '../patterns/help-drawer/index.tsx'
import { MermaidDiagram } from '../content/markdown/index.tsx'
import { ModalSheet } from '../patterns/modal-sheet.tsx'
import { Peek, PeekLayout } from '../patterns/peek/index.tsx'
import { SettingsDirectory } from '../patterns/settings-directory/index.tsx'
import { Pipeline } from '../patterns/pipeline.tsx'
import { FormGrid, RecordForm } from '../patterns/record-form.tsx'
import { ActionMenu, Menu } from '../interactions/menu/index.tsx'
import { ContextButton } from '../interactions/context-button/index.tsx'
import { Popover } from '../interactions/popover/index.tsx'
import { Tooltip } from '../interactions/tooltip/index.tsx'
import { ConfirmDialog, Dialog } from '../interactions/dialog/index.tsx'
import { rowAnchorHref } from '../runtime/row-anchor.js'
import { ToastRegion } from '../interactions/toast/index.tsx'
import { Spinner } from '../interactions/spinner/index.tsx'
import { Skeleton } from '../interactions/skeleton/index.tsx'
import { createSearchFilterView } from '../interactions/search-filter/index.tsx'
import { searchFilterDemoConfig } from '../interactions/search-filter/demo.ts'
import { createKetTableView, KetTable } from '../interactions/ket-table/index.tsx'
import { ketTableDemoConfig, ketTableGroupedDemoConfig } from '../interactions/ket-table/demo.ts'
import {
  Checkbox,
  CheckboxGroup,
  MoneyField,
  NumberField,
  RadioGroup,
  SearchField,
  Select,
  Switch,
  TextArea,
  TextField,
} from '../forms/scalar-fields/index.tsx'
import { Combobox, MultiCombobox, TagPicker } from '../forms/combobox/index.tsx'
import { DatePickerExamples } from './date-pickers.tsx'
import { DateRangePicker, DateTimePicker, TimePicker } from '../forms/date-time/index.tsx'
import { DropZone, FileUpload, ImageDropZone } from '../forms/upload/index.tsx'
import { RelationPicker } from '../forms/relation-picker/index.tsx'
import {
  AppliedFilters,
  FilterBar,
  SavedViews,
  SearchBar,
  SortMenu,
  ViewSettings,
} from '../data-operations/list-controls/index.tsx'
import { InlineEdit } from '../data-operations/inline-edit/index.tsx'
import { ResourceList } from '../data-display/resource-list/index.tsx'
import { DataGrid } from '../data-display/data-grid/index.tsx'
import { Tree, TreeGrid } from '../data-display/tree/index.tsx'
import { DataMatrix } from '../data-display/matrix/index.tsx'
import { BarChart } from '../data-display/bar-chart/index.tsx'
import { ColumnChart } from '../data-display/column-chart/index.tsx'
import { TimeframeFilter } from '../data-operations/timeframe-filter/index.tsx'
import { AvatarGroup, DescriptionList, Person, Status } from '../record/display/index.tsx'
import { FormattedDate, FormattedMoney, FormattedNumber } from '../record/formatted-values/index.tsx'
import { RecordActions, RecordRail, RecordSummary } from '../record/composition/index.tsx'
import { ActivityTimeline, AuditLog } from '../record/activity/index.tsx'
import { StagePath } from '../record/stage-path/index.tsx'
import { Attachments, MediaGallery, Thumbnail } from '../record/media/index.tsx'
import { lightboxDemoConfig } from '../interactions/lightbox/demo.ts'
import { createLightboxView } from '../interactions/lightbox/index.tsx'
import { relationSelectDemoConfig } from '../interactions/relation-select/demo.ts'
import { createRelationSelectView } from '../interactions/relation-select/index.tsx'

export type ComponentExample = {
  id: string
  name: string
  description: string
  render: () => JSXChild
}

export type ComponentGroup = {
  id: string
  name: string
  description: string
  examples: readonly ComponentExample[]
}

type OrderRow = {
  id: string
  customer: string
  total: string
  state: 'Ready' | 'Review' | 'Blocked'
}

const orders: OrderRow[] = [
  { id: 'SO-1042', customer: 'Công ty Ánh Dương', total: '18.450.000 ₫', state: 'Ready' },
  { id: 'SO-1041', customer: 'Khách sạn Mùa Hạ', total: '6.800.000 ₫', state: 'Review' },
  { id: 'SO-1039', customer: 'Nguyễn Minh Châu', total: '2.150.000 ₫', state: 'Blocked' },
]

const toneOf = (state: OrderRow['state']) =>
  state === 'Ready' ? ('positive' as const) : state === 'Review' ? ('warning' as const) : ('danger' as const)

type DemoLayout = 'collection' | 'record' | 'flow' | 'canvas'

const demoNavItems = (active: DemoLayout) => [
  { label: 'Collection', href: '#app-shell', leading: '≡', active: active === 'collection', count: 148 },
  { label: 'Record', href: '#record-page', leading: '◇', active: active === 'record' },
  { label: 'Flow', href: '#workspace-flow', leading: '▦', active: active === 'flow', count: 7 },
  { label: 'Canvas', href: '#workspace-canvas', leading: '□', active: active === 'canvas' },
]

const DemoSidebar = (props: { active: DemoLayout }): TemplateResult => (
  <AppNavigation
    id={`demo-navigation-${props.active}`}
    label="KétSuite workspace"
    identity={<AppBrand label="KétSuite" href="#app-shell" />}
    context="Operations workspace"
    menuLabel="Workspace menu"
    tools={{
      searchLabel: 'Search menu',
      searchPlaceholder: 'Find a function…',
      emptyLabel: 'No matching function.',
      collapseLabel: 'Collapse menu',
    }}
    groups={[
      {
        id: `demo-primary-${props.active}`,
        label: 'Workspace',
        items: demoNavItems(props.active).map((item) => ({
          ...item,
          id: `${props.active}-${item.href.slice(1)}`,
        })),
      },
      {
        id: `demo-manage-${props.active}`,
        label: 'Manage',
        exclusive: false,
        items: [
          { id: `${props.active}-settings`, label: 'Settings', href: '#app-navigation', leading: '⚙' },
          {
            id: `${props.active}-reports`,
            label: 'Reports',
            expanded: true,
            leading: '▤',
            children: [
              { id: `${props.active}-sales-report`, label: 'Sales', href: '#data-table', count: 7 },
              {
                id: `${props.active}-stock-report`,
                label: 'Inventory',
                href: '#metric',
                leading: <Icon name="inbox" />,
              },
              {
                id: `${props.active}-report-settings`,
                label: 'Cấu hình',
                expanded: true,
                children: [
                  { id: `${props.active}-terms`, label: 'Điều khoản thanh toán', href: '#navigation-terms' },
                  {
                    id: `${props.active}-long-label`,
                    label: 'Phương thức thanh toán dành cho nhà cung cấp quốc tế',
                    href: '#navigation-long',
                  },
                ],
              },
            ],
          },
        ],
      },
    ]}
    footer="Signed in · Duy Kieu"
  />
)

const DemoRail = (props: {
  title: string
  detail: string
  progress?: number
  items?: readonly JSXChild[]
}): TemplateResult => (
  <div data-ui="shell-demo-rail">
    <p data-ui="catalogue-kicker">Context</p>
    <strong>{props.title}</strong>
    <p>{props.detail}</p>
    {props.progress !== undefined && <Progress label={props.title} value={props.progress} />}
    {props.items !== undefined && <Stack gap="compact" items={props.items} />}
  </div>
)

const DemoShell = (props: {
  active: DemoLayout
  main: JSXChild
  railTitle?: string
  railDetail?: string
  railProgress?: number
  railItems?: readonly JSXChild[]
}): TemplateResult => (
  <AppShell
    applications={{
      ...exampleApplications,
      items: [
        ...exampleApplications.items,
        { id: 'phone', label: 'Phone', icon: 'phone', unavailableLabel: 'Coming soon' },
        { id: 'chat', label: 'Chat', icon: 'message-circle', unavailableLabel: 'Coming soon' },
      ],
    }}
    mode="embedded"
    location={
      <AppTopbar
        location={<span>Acme · Main branch</span>}
        navigation={
          <NavigationToggle controls={`demo-navigation-${props.active}-drawer`} label="Open navigation" />
        }
        search={{
          id: `demo-global-search-${props.active}`,
          action: '#app-shell',
          triggerLabel: 'Search everywhere',
          closeLabel: 'Close',
          label: 'Global search',
          placeholder: 'Search…',
          submitLabel: 'Search',
        }}
      />
    }
    sidebar={<DemoSidebar active={props.active} />}
    main={props.main}
    rightRail={
      props.railTitle !== undefined ? (
        <DemoRail
          title={props.railTitle}
          detail={props.railDetail ?? ''}
          progress={props.railProgress}
          items={props.railItems}
        />
      ) : undefined
    }
  />
)

const OrdersTable = (props: { grouped?: boolean; title?: string } = {}): TemplateResult => (
  <DataTable
    title={props.title}
    rows={props.grouped ? ([] as OrderRow[]) : orders}
    id={(row) => row.id}
    rowHref={(row) => `#${row.id}`}
    responsive="stack"
    selection={{ selectedIds: ['SO-1042'] }}
    groups={
      props.grouped
        ? [
            {
              id: 'ready',
              label: 'Ready to invoice',
              count: 2,
              rows: orders.slice(0, 2),
              pager: { label: '2 shown in Ready', nextHref: '#data-table' },
            },
            {
              id: 'blocked',
              label: 'Needs decision',
              count: 1,
              rows: orders.slice(2),
            },
          ]
        : undefined
    }
    columns={[
      {
        key: 'id',
        label: 'Order',
        cell: (row) => row.id,
        priority: 'primary',
        kind: 'identifier',
        sort: { href: '#data-table', direction: 'descending' },
      },
      { key: 'customer', label: 'Customer', cell: (row) => row.customer },
      { key: 'total', label: 'Total', cell: (row) => row.total, align: 'end', kind: 'currency' },
      {
        key: 'state',
        label: 'State',
        cell: (row) => <Badge label={row.state} tone={toneOf(row.state)} />,
        kind: 'status',
      },
    ]}
  />
)

const ListDemoChrome = (props: { id: string; selected?: number }): TemplateResult => (
  <ListChrome
    search={{
      id: `${props.id}-query`,
      action: `#${props.id}`,
      value: props.id === 'list-page' ? 'Mùa Hạ' : '',
      placeholder: 'Search records',
      hidden: { view: 'table' },
    }}
    facets={[
      { id: 'all', label: 'All', href: `#${props.id}`, active: true, count: 148 },
      { id: 'ready', label: 'Ready', href: `#${props.id}`, count: 91 },
      { id: 'review', label: 'Review', href: `#${props.id}`, count: 7 },
    ]}
    views={[
      { id: 'table', label: 'Table', href: `#${props.id}`, active: true },
      { id: 'kanban', label: 'Kanban', href: `#${props.id}` },
    ]}
    filtersToggle={{ label: 'Filters' }}
    sort={{
      id: `${props.id}-sort`,
      action: `#${props.id}`,
      choices: [
        { value: 'date-desc', label: 'Newest first', selected: true },
        { value: 'total-desc', label: 'Largest total' },
      ],
    }}
    bulk={{
      selectedCount: props.selected ?? 1,
      summary: `${props.selected ?? 1} selected`,
      clearHref: `#${props.id}`,
      actions: [{ id: 'approve', label: 'Approve', name: 'intent', value: 'approve', variant: 'primary' }],
    }}
    pager={{
      summary: 'Showing 1-3 of 148',
      previousHref: null,
      nextHref: `#${props.id}`,
      pages: [
        { label: '1', href: `#${props.id}`, active: true },
        { label: '2', href: `#${props.id}` },
      ],
    }}
  />
)

export const componentGroups: readonly ComponentGroup[] = [
  {
    id: 'actions',
    name: 'Actions',
    description: 'Business hierarchy expressed independently from colour.',
    examples: [
      {
        id: 'button',
        name: 'Button',
        description: 'Primary, secondary, tertiary, destructive, loading and disabled states.',
        render: () => (
          <ActionGroup
            label="Button variants"
            actions={[
              <Button label="Create order" variant="primary" icon="plus" />,
              <Button label="Save draft" variant="secondary" />,
              <Button label="More details" variant="tertiary" />,
              <Button label="Terminate" variant="secondary" tone="danger" />,
              <Link label="Read the action rules" href="/primitives#primitive-actions" />,
              <Button label="Saving" loading />,
              <Button label="Unavailable" disabled />,
              <LinkButton label="Opening record" href="#record-page" loading />,
              <IconButton label="Toggle theme" icon="☾" />,
              <LinkButton label="Open record" href="#record-page" icon="package" iconOnly />,
              <Button label="Collapse details" variant="tertiary" expanded controls="button-details" />,
              <Button label="A very long customer name remains available in the tooltip" truncateLabel />,
              <Button
                label="Selected brand choice"
                logo={{
                  src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 24"><text x="40" y="18" text-anchor="middle" fill="#5856d6" font-family="sans-serif" font-size="18">Sample</text></svg>')}`,
                }}
                pressed
              />,
            ]}
          />
        ),
      },
      {
        id: 'action-sizes',
        name: 'Action sizes',
        description: 'Default matches input height; compact is explicit. Prominent is a compatibility alias.',
        render: () => (
          <ActionGroup
            label="Action sizes"
            actions={[
              <Button label="Compact" size="compact" />,
              <Button label="Default" />,
              <Button label="Prominent decision" size="prominent" variant="primary" />,
              <IconButton label="Compact theme toggle" icon="☾" size="compact" />,
              <IconButton label="Prominent theme toggle" icon="☾" size="prominent" />,
              <LinkButton label="Open record" href="#data-table" variant="tertiary" leading="↗" />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'status',
    name: 'Status & identity',
    description: 'Compact objects for operational scanning.',
    examples: [
      {
        id: 'typography-icons',
        name: 'Text and Lucide icons',
        description: 'Typography role, document semantics and shared icon geometry.',
        render: () => (
          <Stack
            items={[
              <Text as="h3" variant="headingLg">
                Operations
              </Text>,
              <Text as="p" variant="bodyMd">
                One typography contract for every component.
              </Text>,
              <Inline
                items={[
                  <Icon name="info" label="Information" />,
                  <Icon name="circle-check" tone="positive" label="Complete" />,
                  <Text numeric>1,284.00</Text>,
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'badges',
        name: 'Badge and tag',
        description:
          'Tones carry meaning; badges fit their labels inside Inline and stretching Stack layouts.',
        render: () => (
          <Inline
            items={[
              <Badge label="Neutral" />,
              <Text tone="muted">No stock tracking</Text>,
              <Badge label="Synchronized" tone="info" />,
              <Badge label="Ready" tone="positive" />,
              <Badge label="Needs review" tone="warning" />,
              <Badge label="Failed" tone="danger" />,
              <Tag label="Hà Nội" removeHref="#status" removeLabel="Remove Hà Nội filter" />,
              <CountBadge count={12} label="12 pending items" />,
              <Stack
                items={[
                  <Badge label="Observation only" />,
                  <Text variant="bodySm" tone="muted">
                    The badge stays compact above its longer explanation.
                  </Text>,
                  <Badge
                    label="A longer status remains readable and wraps within a narrow container"
                    tone="info"
                  />,
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'identity',
        name: 'Avatar and code',
        description: 'Stable fallbacks for people and exact machine-readable values.',
        render: () => (
          <Inline
            items={[
              <Avatar name="Nguyễn Minh Châu" size="small" />,
              <MediaLabel label="Product without an image" />,
              <MediaLabel label="Product without a photo" reserveImage />,
              <MediaLabel label="Product without a photo" reserveImage placeholder="package" />,
              <Avatar name="Nguyễn Minh Châu" />,
              <Avatar name="Nguyễn Minh Châu" size="large" />,
              <Code value="tenant-vn-hn-0042" context="tenant" />,
            ]}
          />
        ),
      },
      {
        id: 'code-block',
        name: 'Code block',
        description: 'Multi-line machine text that keeps whitespace and scrolls within a bounded height.',
        render: () => (
          <Stack
            items={[
              <CodeBlock
                label="Response body"
                language="json"
                value={JSON.stringify(
                  {
                    error: {
                      code: 'E_HTTP_INVALID_REQUEST',
                      message: 'the request is invalid',
                      requestId: '8f0c6a8e-5b7e-4f39-9a51-3cc0e5b0d4a1',
                      fields: { limit: [{ field: 'limit', code: 'type', messageKey: 'validation.type' }] },
                    },
                  },
                  null,
                  2,
                )}
              />,
              <CodeBlock
                label="curl command"
                language="shell"
                wrap
                value={`curl -X POST 'https://api.example.com/v1/sales/orders/SO-2026-000184/confirm?notify=customer&channel=web' \\\n  -H 'Idempotency-Key: 3f2a8c1e-5b7d-4e9a-8c6f-1d2e3f4a5b6c'`}
              />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'feedback',
    name: 'Feedback',
    description: 'Complete operational states, including the paths nobody screenshots first.',
    examples: [
      {
        id: 'notice',
        name: 'Notice',
        description: 'Status, warning and recovery information with an optional action.',
        render: () => (
          <Stack
            gap="compact"
            items={[
              <Notice title="Sync complete" message="42 records are ready for review." tone="positive" />,
              <Notice title="Release drift" message="Two tenants are one release behind." tone="warning" />,
              <Notice
                title="Connection failed"
                message="The provider rejected the stored credential. Rotate it before retrying."
                tone="danger"
                actions={<Button label="Rotate" size="compact" />}
              />,
            ]}
          />
        ),
      },
      {
        id: 'empty-loading',
        name: 'Empty and loading',
        description: 'Explicit state preserves layout and gives the reader a next step.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Surface
                body={
                  <EmptyState
                    visual="start"
                    title="No saved views"
                    message="Save the current filters to reuse them later."
                    actions={<Button label="Save current view" size="compact" />}
                  />
                }
              />,
              <Surface body={<LoadingState label="Loading order history" lines={3} />} />,
            ]}
          />
        ),
      },
      {
        id: 'empty-visuals',
        name: 'Empty state visuals',
        description:
          'One frame and size everywhere; the badge names why the region is empty: nothing yet, first use, no match, cleared or not allowed.',
        render: () => (
          <Grid
            columns={3}
            items={[
              <EmptyState title="No activity" message="Changes to this record appear here." />,
              <EmptyState
                visual="start"
                title="No products yet"
                message="Add the first product to start selling."
                actions={<Button label="Add product" size="compact" />}
              />,
              <EmptyState
                visual="search"
                title="No matching orders"
                message="Clear the filters to see every order."
                actions={<Button label="Clear filters" size="compact" variant="secondary" />}
              />,
              <EmptyState
                visual="done"
                title="Nothing to review"
                message="Every receipt has been checked."
              />,
              <EmptyState
                visual="locked"
                title="Costs are hidden"
                message="Ask an accountant for access to purchase costs."
              />,
            ]}
          />
        ),
      },
      {
        id: 'empty-long-content',
        name: 'Empty state with a long search term',
        description: 'Unbroken titles and search terms wrap within narrow panels without losing text.',
        render: () => (
          <EmptyState
            visual="search"
            title={'REFERENCE'.repeat(12)}
            message={`No match for “${'W'.repeat(100)}”. Clear the filters to try again.`}
            actions={<Button label="Clear filters" />}
          />
        ),
      },
    ],
  },
  {
    id: 'fields',
    name: 'Fields',
    description: 'Native controls with one label, help and error contract.',
    examples: [
      {
        id: 'reorder-list',
        name: 'Reorder list',
        description:
          'Controlled editable rows emit ordered ids through one native change field; move controls accompany drag handles.',
        render: () => (
          <ReorderList
            id="reorder-demo"
            name="order"
            label="Values"
            labels={{
              add: 'Add value',
              remove: 'Remove',
              up: 'Move up',
              down: 'Move down',
              drag: 'Drag',
              empty: 'No values',
            }}
            items={[
              { id: 'red', content: <Field id="reorder-red" name="red" label="Value" value="Red" /> },
              { id: 'blue', content: <Field id="reorder-blue" name="blue" label="Value" value="Blue" /> },
            ]}
          />
        ),
      },
      {
        id: 'field',
        name: 'Field',
        description: 'Text, select, checkbox and error states without application-owned markup.',
        render: () => (
          <Surface
            body={
              <Grid
                columns={2}
                items={[
                  <Field id="company-name" name="company" label="Company name" value="Két Việt" required />,
                  <Field
                    id="deployment"
                    name="deployment"
                    label="Deployment"
                    type="select"
                    value="commerce"
                    options={[
                      { value: 'commerce', label: 'Commerce' },
                      { value: 'cosmetic', label: 'Cosmetic' },
                      { value: 'hospitality', label: 'Hospitality' },
                    ]}
                    help="A tenant belongs to exactly one deployment."
                  />,
                  <Field
                    id="database-key"
                    name="databaseKey"
                    label="Database key"
                    value="Invalid Key"
                    error="Use lowercase letters, numbers and hyphens only."
                  />,
                  <Field
                    id="active"
                    name="active"
                    label="Active for new orders"
                    type="checkbox"
                    value
                    help="New orders can be assigned to this company."
                  />,
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'field-action',
        name: 'Field with a command',
        description:
          'A short entry keeps a compact width with its command right after it; Enter runs the command.',
        render: () => (
          <Surface
            body={
              <FormGrid
                items={[
                  <Field
                    id="catalogue-new-tag"
                    name="newTag"
                    label="New tag"
                    maxLength={40}
                    span="full"
                    help="The tag is chosen for this batch at once."
                    action={<Button label="Add" type="submit" variant="secondary" />}
                  />,
                  <Field
                    id="catalogue-coupon"
                    name="coupon"
                    label="Coupon"
                    value="SPRING"
                    span="full"
                    error="This code ended on 31 March."
                    action={<Button label="Apply" type="submit" variant="secondary" />}
                  />,
                ]}
              />
            }
          />
        ),
      },
    ],
  },
  {
    id: 'field-states',
    name: 'Field states',
    description: 'Native input types, validation, read-only values and nested groups.',
    examples: [
      {
        id: 'advanced-fields',
        name: 'Operational fields',
        description: 'Numeric constraints, dates, options and nested validation use the same field contract.',
        render: () => (
          <Surface
            title="Settings"
            body={
              <RecordForm
                action="#advanced-fields"
                submitLabel="Save settings"
                fields={[
                  {
                    id: 'settings-reference',
                    name: 'reference',
                    label: 'Reference',
                    value: 'CUS-0042',
                    readOnly: true,
                    help: 'Assigned when the account was created.',
                  },
                  {
                    id: 'settings-locked',
                    name: 'locked',
                    label: 'External reference',
                    value: 'Pending verification',
                    disabled: true,
                  },
                  {
                    id: 'settings-limit',
                    name: 'limit',
                    label: 'Credit limit',
                    type: 'decimal',
                    value: 80000000,
                    min: 0,
                    step: '1000',
                  },
                  {
                    id: 'settings-date',
                    name: 'date',
                    label: 'Effective date',
                    type: 'date',
                    value: '2026-09-08',
                  },
                  { id: 'settings-time', name: 'time', label: 'Delivery time', type: 'time', value: '09:00' },
                  {
                    id: 'settings-color',
                    name: 'color',
                    label: 'Calendar colour',
                    type: 'color',
                    value: '#5968df',
                  },
                  {
                    id: 'settings-billing',
                    name: 'billing',
                    label: 'Billing frequency',
                    type: 'radio',
                    value: 'monthly',
                    required: true,
                    options: [
                      { value: 'monthly', label: 'Monthly' },
                      { value: 'quarterly', label: 'Quarterly' },
                    ],
                  },
                  {
                    id: 'settings-channels',
                    name: 'channels',
                    label: 'Notifications',
                    type: 'checkbox-group',
                    options: [
                      { value: 'email', label: 'Email', checked: true },
                      { value: 'sms', label: 'SMS' },
                    ],
                  },
                  {
                    id: 'settings-branches',
                    name: 'branches',
                    label: 'Branches',
                    type: 'checkbox-group',
                    optionsOrientation: 'vertical',
                    span: 'full',
                    options: [
                      { value: 'district-1', label: 'District 1 · Head office', checked: true },
                      { value: 'thao-dien', label: 'Thao Dien', checked: true },
                      { value: 'cau-giay', label: 'Cau Giay · North' },
                    ],
                  },
                  {
                    id: 'settings-address',
                    name: 'address',
                    label: 'Delivery address',
                    error: 'Check the delivery address.',
                    fields: [
                      {
                        id: 'settings-street',
                        name: 'street',
                        label: 'Street',
                        value: '',
                        required: true,
                        error: 'Enter a street address.',
                        span: 'full',
                      },
                      {
                        id: 'settings-city',
                        name: 'city',
                        label: 'City',
                        value: 'Hồ Chí Minh',
                        autocomplete: 'address-level2',
                      },
                    ],
                  },
                ]}
              />
            }
          />
        ),
      },
    ],
  },
  {
    id: 'layouts',
    name: 'Layouts',
    description: 'Quiet hierarchy for dense application screens.',
    examples: [
      {
        id: 'stack-scroll-boundary',
        name: 'Stack with a scrolling child',
        description:
          'A wrapper such as a client island stays within the stack; its table scrolls locally and each two-line cell keeps its text.',
        render: () => {
          const lines = (title: string, detail: string) => (
            <Stack
              gap="none"
              items={[
                <Text variant="bodyMd" children={title} />,
                <Text variant="bodySm" tone="muted" children={detail} />,
              ]}
            />
          )
          const stops = [
            'North terminal',
            'Harbour depot',
            'Airport cargo',
            'Riverside warehouse',
            'Old town hub',
          ]
          // Eight legs make the table wider than the canvas at every catalogue width.
          const legs = [...stops, 'Dry dock', 'Rail yard', 'Customs gate']
          return (
            <Stack
              items={[
                <Text children="The layout keeps its width; the table scrolls in its own region." />,
                <div>
                  <KetTable
                    caption="Deliveries"
                    rows={stops.map((stop, index) => ({ id: `delivery-${index + 1}`, stop }))}
                    id={(row) => row.id}
                    rowHref={(row) => `#stack-scroll-boundary-${row.id}`}
                    columns={legs.map((leg, column) => ({
                      key: `leg-${column + 1}`,
                      label: `Leg ${column + 1}`,
                      cell: (row: { id: string; stop: string }) =>
                        lines(row.id.toUpperCase(), `${row.stop} · ${leg} · signed on arrival`),
                    }))}
                    labels={ketTableDemoConfig.labels}
                  />
                </div>,
              ]}
            />
          )
        },
      },
      {
        id: 'surface-section',
        name: 'Surface and section',
        description: 'Layout components establish rhythm without domain assumptions.',
        render: () => (
          <Section
            eyebrow="Operations"
            title="Daily overview"
            description="The section owns hierarchy; its body remains application data."
            actions={<LinkButton label="View report" href="#patterns" size="compact" />}
            body={
              <Grid
                columns={4}
                items={[
                  <Metric
                    label="Orders"
                    value="148"
                    detail="+12 today"
                    tone="positive"
                    change={{ label: '+12.4% vs previous 7 days', direction: 'up', tone: 'positive' }}
                    icon={
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.75"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M3 6h18v12H3z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                    }
                  />,
                  <Metric
                    label="Review queue"
                    value="7"
                    detail="Oldest 42 min"
                    tone="warning"
                    href="#surface-section"
                    change={{ label: '+3 since yesterday', direction: 'up', tone: 'danger' }}
                  />,
                  <Metric label="Blocked" value="2" detail="Credential required" tone="danger" />,
                  <Metric label="Archived" value="1 204" detail="No state to report" />,
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'content-card',
        name: 'Content card',
        description: 'A composable record summary with valid nested actions.',
        render: () => (
          <CardGrid
            items={[
              { id: 'commerce', name: 'Commerce', summary: 'General retail operations', state: 'Stable' },
              {
                id: 'cosmetic',
                name: 'Cosmetic',
                summary: 'Care and marketplace workflows',
                state: 'Review',
              },
              {
                id: 'hospitality',
                name: 'Hospitality',
                summary: 'Property and OTA operations',
                state: 'Pilot',
              },
            ]}
            id={(item) => item.id}
            card={(item) => (
              <ContentCard
                eyebrow="Deployment"
                title={item.name}
                summary={item.summary}
                body="Operational components and workflow recipes"
                status={<Badge label={item.state} tone={item.state === 'Stable' ? 'positive' : 'warning'} />}
                href="#content-card"
                selected={item.id === 'cosmetic'}
                tone={item.id === 'hospitality' ? 'subtle' : 'default'}
              />
            )}
          />
        ),
      },
      {
        id: 'kanban-card',
        name: 'Kanban cards',
        description: 'Compact record cards keep board metadata and actions consistent across workflows.',
        render: () => (
          <KanbanGrid
            rows={orders}
            id={(row) => row.id}
            card={(row) => (
              <KanbanCard
                id={row.id}
                title={`${row.id} · ${row.customer}`}
                href="#kanban-card"
                meta={<Badge label={row.state} tone={toneOf(row.state)} />}
                note={row.total}
              />
            )}
          />
        ),
      },
      {
        id: 'disclosure',
        name: 'Disclosure',
        description: 'Secondary detail stays available without dominating the primary workflow.',
        render: () => (
          <Disclosure
            summary="Permission provenance"
            body={
              <Stack
                gap="compact"
                items={[
                  <Code value="sales.order.approve" context="managed-template" />,
                  <Code value="sales.order.read" context="managed-template" />,
                ]}
              />
            }
          />
        ),
      },
    ],
  },
  {
    id: 'application-structure',
    name: 'Application structure',
    description: 'Responsive application navigation and four practical layouts inside the same shell.',
    examples: [
      {
        id: 'app-navigation',
        name: 'Responsive application navigation',
        description:
          'One navigation model becomes a persistent desktop sidebar and an accessible mobile drawer.',
        render: () => (
          <DemoShell
            active="collection"
            main={
              <Page
                title="Operations overview"
                body={
                  <Grid
                    columns={2}
                    items={[
                      <Metric label="Open orders" value="148" detail="12 need attention" />,
                      <Metric label="Ready to invoice" value="91" detail="Updated just now" />,
                    ]}
                  />
                }
              />
            }
          />
        ),
      },
      {
        id: 'help-drawer',
        name: 'Screen help',
        description:
          'Right-side modeless desktop guidance, fullscreen mobile help, SSR Markdown and the shared Mermaid theme. Hosts supply content and a lazy renderer. Open the connected demo to try the drawer; diagram source remains readable without JavaScript.',
        render: () => (
          <Stack
            items={[
              <LinkButton href="/demo2" label="Open screen help demo" />,
              <AppSwitcherHelp label="Screen help in standalone navigation" />,
              <LinkButton href="/help-theme" label="Inspect Mermaid theme" />,
              <MermaidDiagram
                source={'flowchart TD\n  A[Draft] --> B[Complete]\n  class B kv-positive'}
                labels={{
                  diagram: 'Order workflow',
                  source: 'View Mermaid source',
                  loading: 'Rendering…',
                  error: 'Diagram unavailable; view its source.',
                }}
              />,
              <HelpDrawer
                id="catalogue-help-drawer"
                label="Screen help"
                title="Example screen"
                closeLabel="Close help"
                body="Screen-owned Markdown content"
              />,
            ]}
          />
        ),
      },
      {
        id: 'app-shell',
        name: 'Collection shell',
        description:
          'A full list workspace with sidebar navigation, URL-owned list chrome, selectable rows and a context rail.',
        render: () => (
          <DemoShell
            active="collection"
            main={
              <ListPage
                variant="operational"
                context="Sales / Sales orders"
                title="Sales orders"
                headerActions={<Button label="Create order" variant="primary" />}
                actionsPlacement="header"
                actionsHidden
                actions={
                  <BulkActions selectedCount={0} actions={[{ id: 'archive', label: 'Archive selected' }]} />
                }
                controls={<ListDemoChrome id="app-shell" />}
                body={<OrdersTable title="Order list" />}
              />
            }
            railTitle="List health"
            railDetail="Seven orders need a human decision before invoicing."
            railProgress={72}
            railItems={[
              <Badge label="91 ready" tone="positive" />,
              <Badge label="7 review" tone="warning" />,
            ]}
          />
        ),
      },
      {
        id: 'record-page',
        name: 'Record shell',
        description:
          'A durable subject with record identity, tabs, form content and a right-hand facts rail.',
        render: () => (
          <DemoShell
            active="record"
            main={
              <RecordPage
                variant="operational"
                context="Customers / Mùa Hạ Riverside"
                title="Mùa Hạ Riverside"
                status={<Badge label="Active" tone="positive" />}
                actions={
                  <ActionGroup
                    actions={[
                      <Button label="Save" variant="primary" size="compact" />,
                      <Button label="Archive" variant="tertiary" size="compact" />,
                    ]}
                  />
                }
                navigation={
                  <Tabs
                    label="Customer record"
                    items={[
                      { id: 'details', label: 'Details', href: '#record-page', active: true },
                      { id: 'orders', label: 'Orders', href: '#record-page', count: 6 },
                      { id: 'activity', label: 'Activity', href: '#record-page', count: 8 },
                    ]}
                  />
                }
                body={
                  <Stack
                    items={[
                      <Surface
                        title="Main information"
                        body={
                          <RecordForm
                            action="#record-page"
                            fields={[
                              {
                                id: 'layout-partner-name',
                                span: 'full',
                                name: 'name',
                                label: 'Name',
                                value: 'Mùa Hạ Riverside',
                              },
                              {
                                id: 'layout-partner-email',
                                span: 'full',
                                name: 'email',
                                label: 'Email',
                                type: 'email',
                                value: 'hello@muaha.example',
                              },
                              {
                                id: 'layout-partner-tags',
                                name: 'tags',
                                label: 'Tags',
                                type: 'checkbox-group',
                                span: 'full',
                                options: [
                                  { value: 'vip', label: 'VIP', checked: true },
                                  { value: 'hospitality', label: 'Hospitality', checked: true },
                                ],
                              },
                            ]}
                            submitLabel="Save"
                          />
                        }
                      />,
                      <OrdersTable title="Recent orders" />,
                    ]}
                  />
                }
                aside={
                  <Stack
                    items={[
                      <Metric label="Credit limit" value="80m ₫" detail="42m ₫ available" />,
                      <Progress label="Onboarding complete" value={84} tone="positive" />,
                    ]}
                  />
                }
                asideLabel="Customer context"
              />
            }
          />
        ),
      },
      {
        id: 'record-page-leading-rail',
        name: 'Record with a leading rail',
        description:
          'A rail of blockers that leads the record once the page stacks; a wide page keeps it beside the record.',
        render: () => (
          <DemoShell
            active="record"
            main={
              <RecordPage
                variant="operational"
                title="Order SO-1042"
                status={<Badge label="Awaiting payment" tone="warning" />}
                actions={<Button label="Confirm order" variant="primary" size="compact" />}
                body={
                  <Stack
                    items={[
                      <Surface
                        title="Main information"
                        body={<Text as="p">Customer, delivery and lines.</Text>}
                      />,
                      <Surface title="History" body={<Text as="p">Created, quoted, sent.</Text>} />,
                    ]}
                  />
                }
                aside={
                  <Surface
                    title="Needs attention"
                    body={
                      <Stack
                        divided
                        items={[
                          <Stack
                            gap="compact"
                            items={[
                              <Text variant="headingSm">No payment yet</Text>,
                              <Text as="p" variant="bodySm" tone="muted">
                                Take a deposit before the order ships.
                              </Text>,
                              <Button label="Record payment" size="compact" />,
                            ]}
                          />,
                          <Stack
                            gap="compact"
                            items={[
                              <Text variant="headingSm">No carrier</Text>,
                              <Text as="p" variant="bodySm" tone="muted">
                                Choose a carrier for the delivery date.
                              </Text>,
                              <Button label="Choose carrier" size="compact" />,
                            ]}
                          />,
                        ]}
                      />
                    }
                  />
                }
                asideLabel="Needs attention"
                asideWhenStacked="before"
              />
            }
          />
        ),
      },
      {
        id: 'workspace-flow',
        name: 'Flow workspace',
        description:
          'A vertical operations overview where metrics, process state and exception lists sit on one grey canvas.',
        render: () => (
          <DemoShell
            active="flow"
            main={
              <WorkspacePage
                variant="operational"
                layout="flow"
                context="Sales / Overview"
                title="Revenue operations"
                actions={<Button label="Create quotation" variant="primary" />}
                controls={
                  <ActionGroup
                    label="Flow controls"
                    actions={[
                      <LinkButton label="Today" href="#workspace-flow" size="compact" />,
                      <LinkButton
                        label="This week"
                        href="#workspace-flow"
                        size="compact"
                        variant="tertiary"
                      />,
                    ]}
                  />
                }
                body={
                  <Stack
                    gap="loose"
                    items={[
                      <Grid
                        columns={4}
                        items={[
                          <Metric label="Quotations" value={24} detail="5 new today" />,
                          <Metric label="Sent" value={9} detail="Awaiting reply" tone="info" />,
                          <Metric label="Confirmed" value={18} detail="82,000,000 ₫" tone="positive" />,
                          <Metric label="Blocked" value={2} detail="Needs attention" tone="danger" />,
                        ]}
                      />,
                      <Surface
                        title="Sales flow"
                        body={
                          <Pipeline
                            label="Sales flow"
                            steps={[
                              { id: 'draft', label: 'Quotation', value: 24 },
                              { id: 'sent', label: 'Sent', value: 9, tone: 'info' },
                              { id: 'confirmed', label: 'Confirmed', value: 18, tone: 'positive' },
                              { id: 'invoice', label: 'To invoice', value: 6, tone: 'warning' },
                            ]}
                          />
                        }
                      />,
                      <OrdersTable grouped title="Exceptions" />,
                    ]}
                  />
                }
              />
            }
            railTitle="Daily target"
            railDetail="56 of 82 confirmed orders have been invoiced today."
            railProgress={68}
          />
        ),
      },
      {
        id: 'workspace-canvas',
        name: 'Canvas workspace',
        description:
          'A horizontal board-style surface where the main content can scroll without changing the shell.',
        render: () => (
          <DemoShell
            active="canvas"
            main={
              <WorkspacePage
                variant="operational"
                layout="canvas"
                context="CRM / Pipeline"
                title="Opportunities board"
                actions={<Button label="Create opportunity" variant="primary" />}
                controls={
                  <Inline
                    items={[
                      <LinkButton label="My pipeline" href="#workspace-canvas" size="compact" />,
                      <LinkButton
                        label="All teams"
                        href="#workspace-canvas"
                        size="compact"
                        variant="tertiary"
                      />,
                      <Tag label="High value" removeHref="#workspace-canvas" removeLabel="Remove filter" />,
                    ]}
                  />
                }
                body={
                  <Grid
                    columns={3}
                    items={[
                      <Section
                        title="Qualified"
                        body={
                          <Stack
                            gap="compact"
                            items={[
                              <ContentCard
                                title="Mùa Hạ Riverside"
                                meta="42,000,000 ₫"
                                body="Needs proposal"
                              />,
                              <ContentCard title="Ánh Dương Group" meta="18,000,000 ₫" body="Demo booked" />,
                            ]}
                          />
                        }
                      />,
                      <Section
                        title="Proposal"
                        body={
                          <Stack
                            gap="compact"
                            items={[
                              <ContentCard title="Lotus Hotels" meta="64,000,000 ₫" body="Awaiting CFO" />,
                              <ContentCard
                                title="Bình Minh Retail"
                                meta="30,000,000 ₫"
                                body="Legal review"
                              />,
                            ]}
                          />
                        }
                      />,
                      <Section
                        title="Negotiation"
                        body={
                          <Stack
                            gap="compact"
                            items={[
                              <ContentCard title="Sông Xanh" meta="52,000,000 ₫" body="Discount requested" />,
                              <ContentCard title="Urban Stay" meta="40,000,000 ₫" body="Close this week" />,
                            ]}
                          />
                        }
                      />,
                    ]}
                  />
                }
              />
            }
            railTitle="Pipeline risk"
            railDetail="Three opportunities need owner follow-up before Friday."
            railItems={[
              <Badge label="2 overdue" tone="danger" />,
              <Badge label="6 due this week" tone="warning" />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'navigation',
    name: 'Navigation & progress',
    description: 'Low-luminance selection and compact progress keep attention on the working content.',
    examples: [
      {
        id: 'navigation-items',
        name: 'Navigation and tabs',
        description: 'The active indigo remains restrained in both vertical and horizontal navigation.',
        render: () => (
          <Stack
            items={[
              <Breadcrumbs
                label="Current location"
                maxItems={3}
                overflowLabel="Show intermediate locations"
                items={[
                  { label: 'Workspace', href: '#navigation-items' },
                  { label: 'Sales', href: '#navigation-items' },
                  { label: 'South region', href: '#navigation-items' },
                  { label: 'Orders' },
                ]}
              />,
              <NavList
                label="Product"
                items={[
                  { label: 'Details', href: '#navigation-items', leading: '◇', active: true },
                  { label: 'Variants', href: '#navigation-items', leading: '□', count: 12 },
                  { label: 'Inventory', href: '#navigation-items', leading: '≡' },
                ]}
              />,
              <TabbedView
                id="catalogue-record-views"
                label="Record views"
                items={[
                  { id: 'summary', label: 'Summary', href: '#navigation-items', active: true },
                  { id: 'activity', label: 'Activity', href: '#navigation-items', count: 8 },
                  { id: 'files', label: 'Files', href: '#navigation-items', count: 3 },
                ]}
                body={<p>The active panel owns vertical rhythm and scrolling, without horizontal padding.</p>}
                extension={
                  <a data-ui="tab" href="#navigation-items">
                    Extension
                  </a>
                }
              />,
            ]}
          />
        ),
      },
      {
        id: 'tabs-page-scroll',
        name: 'Page scrolling tabs',
        description:
          'Unbounded page content follows the containing page scroll instead of trapping wheel input.',
        render: () => (
          <TabbedView
            id="catalogue-page-views"
            label="Page views"
            scroll="page"
            items={[{ id: 'settings', label: 'Settings', href: '#navigation-items', active: true }]}
            body={
              <p>
                Use page scrolling for full-page configuration blocks; keep panel scrolling for bounded
                modals.
              </p>
            }
          />
        ),
      },
      {
        id: 'progress',
        name: 'Progress',
        description: 'A four-pixel track communicates state without becoming another panel.',
        render: () => (
          <Stack
            gap="compact"
            items={[
              <Progress label="Project completion" value={68} />,
              <Progress label="Approved" value={92} tone="positive" />,
              <Progress label="At risk" value={54} tone="warning" />,
              <Progress label="Overdue" value={31} tone="danger" />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'patterns',
    name: 'Patterns',
    description: 'Generic workflows assembled from the same primitives.',
    examples: [
      {
        id: 'list-chrome',
        name: 'List chrome',
        description: 'Search, filters, view switch, bulk state and paging for URL-driven collection screens.',
        render: () =>
          Stack({
            items: [
              Stack({
                items: [
                  <ListChrome
                    search={{
                      id: 'care-customer-query',
                      action: '#list-chrome',
                      placeholder: 'Search customers',
                    }}
                    filterMenus={[
                      'Assigned team',
                      'Care requirements',
                      'Source',
                      'Status',
                      'Schedule',
                      'Group',
                    ].map((label, index) => (
                      <Menu
                        id={`care-customer-filter-${index}`}
                        label={label}
                        items={[{ id: 'all', label: 'All', href: '#list-chrome' }]}
                      />
                    ))}
                    facets={[
                      { id: 'active', label: 'Active', href: '#list-chrome', active: true, count: 42 },
                      { id: 'draft', label: 'Draft', href: '#list-chrome', count: 6 },
                    ]}
                    views={[
                      { id: 'table', label: 'Table', href: '#list-chrome', active: true },
                      { id: 'cards', label: 'Cards', href: '#list-chrome' },
                    ]}
                    sort={{
                      id: 'care-customer-sort',
                      action: '#list-chrome',
                      choices: [
                        { value: 'updated-desc', label: 'Recently updated', selected: true },
                        { value: 'name-asc', label: 'Name A-Z' },
                      ],
                    }}
                    status="48 customers"
                    actions={<Button label="Create" variant="primary" size="compact" />}
                    bulk={{
                      selectedCount: 2,
                      summary: '2 customers selected',
                      clearHref: '#list-chrome',
                      actions: [{ id: 'archive', label: 'Archive', name: 'intent', value: 'archive' }],
                    }}
                    pager={{
                      summary: 'Showing 1-25 of 48',
                      nextHref: '#list-chrome',
                      pages: [
                        { label: '1', href: '#list-chrome', active: true },
                        { label: '2', href: '#list-chrome' },
                      ],
                    }}
                  />,
                  <ListChrome
                    bulkPresentation="replace"
                    search={{
                      id: 'selected-care-customer-query',
                      action: '#list-chrome',
                      value: 'Saved search',
                    }}
                    bulk={{
                      selectedCount: 2,
                      form: 'selected-care-customer-form',
                      clearLabel: 'Clear selection',
                      actions: [{ id: 'approve', label: 'Approve', name: 'intent', value: 'approve' }],
                    }}
                  />,
                ],
              }),
              <ListChrome
                filtersToggle={{ label: 'Filters' }}
                filterMenus={
                  <>
                    <DateRangePicker
                      id="customer-period"
                      variant="filter"
                      label="Reporting period"
                      startLabel="From"
                      endLabel="To"
                      locale="en"
                      start={{ id: 'customer-from', name: 'from', value: '2026-10-01' }}
                      end={{ id: 'customer-to', name: 'to', value: '2026-10-31' }}
                    />
                    <Menu
                      id="customer-account"
                      label="Ledger account"
                      selectionMode="single"
                      items={[{ id: 'all', label: 'All accounts', checked: true, href: '#list-chrome' }]}
                    />
                    <Menu
                      id="customer-partner"
                      label="Partner"
                      selectionMode="single"
                      items={[{ id: 'all', label: 'All partners', checked: true, href: '#list-chrome' }]}
                    />
                  </>
                }
                search={{
                  id: 'customer-query',
                  action: '#list-chrome',
                  placeholder: 'Search customers',
                }}
                facets={[
                  { id: 'active', label: 'Active', href: '#list-chrome', active: true, count: 42 },
                  { id: 'draft', label: 'Draft', href: '#list-chrome', count: 6 },
                ]}
                views={[
                  { id: 'table', label: 'Table', href: '#list-chrome', active: true },
                  { id: 'cards', label: 'Cards', href: '#list-chrome' },
                ]}
                sort={{
                  id: 'customer-sort',
                  action: '#list-chrome',
                  choices: [
                    { value: 'updated-desc', label: 'Recently updated', selected: true },
                    { value: 'name-asc', label: 'Name A-Z' },
                  ],
                }}
                status="48 customers"
                actions={<Button label="Create" variant="primary" size="compact" />}
                bulk={{
                  selectedCount: 2,
                  summary: '2 customers selected',
                  clearHref: '#list-chrome',
                  actions: [{ id: 'archive', label: 'Archive', name: 'intent', value: 'archive' }],
                }}
                pager={{
                  summary: 'Showing 1-25 of 48',
                  nextHref: '#list-chrome',
                  pages: [
                    { label: '1', href: '#list-chrome', active: true },
                    { label: '2', href: '#list-chrome' },
                  ],
                }}
              />,
            ],
          }),
      },
      {
        id: 'list-page',
        name: 'List page',
        description:
          'The canonical collection hierarchy: identity with primary actions, URL-driven controls, tool actions and records.',
        render: () => (
          <ListPage
            variant="operational"
            context="Sales / Sales orders"
            eyebrow="Sales"
            title="Sales orders"
            headerActions={<Button label="Create order" variant="primary" />}
            actions={<Button label="Export orders" variant="secondary" />}
            controls={
              <ListChrome
                search={{
                  id: 'orders-query',
                  action: '#list-page',
                  value: 'Mùa Hạ',
                  placeholder: 'Search orders',
                  hidden: { view: 'all' },
                }}
                facets={[
                  { id: 'all', label: 'All', href: '#list-page', active: true, count: 148 },
                  { id: 'ready', label: 'Ready', href: '#list-page', count: 91 },
                  { id: 'review', label: 'Review', href: '#list-page', count: 7 },
                ]}
                views={[
                  { id: 'table', label: 'Table', href: '#list-page', active: true },
                  { id: 'kanban', label: 'Kanban', href: '#list-page' },
                ]}
                sort={{
                  id: 'orders-sort',
                  action: '#list-page',
                  choices: [
                    { value: 'date-desc', label: 'Newest first', selected: true },
                    { value: 'total-desc', label: 'Largest total' },
                    { value: 'customer-asc', label: 'Customer A-Z' },
                  ],
                }}
                bulk={{
                  selectedCount: 1,
                  summary: '1 order selected',
                  clearHref: '#list-page',
                  actions: [
                    { id: 'approve', label: 'Approve', name: 'intent', value: 'approve', variant: 'primary' },
                    { id: 'export', label: 'Export', name: 'intent', value: 'export' },
                  ],
                }}
                pager={{
                  summary: 'Showing 1-3 of 148',
                  previousHref: null,
                  nextHref: '#list-page',
                  pages: [
                    { label: '1', href: '#list-page', active: true },
                    { label: '2', href: '#list-page' },
                    { label: '3', href: '#list-page' },
                  ],
                }}
              />
            }
            body={
              <DataTable
                title="Order list"
                rows={orders}
                id={(row) => row.id}
                rowHref={(row) => `#${row.id}`}
                responsive="stack"
                selection={{ selectedIds: ['SO-1042'] }}
                columns={[
                  {
                    key: 'id',
                    label: 'Order',
                    cell: (row) => row.id,
                    priority: 'primary',
                    kind: 'identifier',
                    sort: { href: '#list-page', direction: 'descending' },
                  },
                  { key: 'customer', label: 'Customer', cell: (row) => row.customer },
                  { key: 'total', label: 'Total', cell: (row) => row.total, align: 'end', kind: 'currency' },
                  {
                    key: 'state',
                    label: 'State',
                    cell: (row) => <Badge label={row.state} tone={toneOf(row.state)} />,
                    kind: 'status',
                  },
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'dashboard-page',
        name: 'Dashboard page',
        description:
          'The canonical overview hierarchy: durable context, compact identity, primary action and an uninterrupted analytical canvas.',
        render: () => (
          <DashboardPage
            variant="operational"
            context="Sales / Overview"
            eyebrow="Commercial workspace"
            title="Sales overview"
            actions={<Button label="Create quotation" variant="primary" />}
            body={
              <Stack
                gap="loose"
                items={[
                  <Grid
                    columns={4}
                    items={[
                      <Metric label="Quotations" value={24} detail="5 new today" />,
                      <Metric label="Sent" value={9} detail="Awaiting a reply" tone="info" />,
                      <Metric label="Confirmed" value={18} detail="82,000,000 ₫" tone="positive" />,
                      <Metric label="To invoice" value={6} detail="Needs attention" tone="warning" />,
                    ]}
                  />,
                  <Surface
                    title="Sales flow"
                    body={
                      <Pipeline
                        label="Sales flow"
                        steps={[
                          { id: 'draft', label: 'Quotation', value: 24 },
                          { id: 'sent', label: 'Sent', value: 9, tone: 'info' },
                          { id: 'confirmed', label: 'Confirmed', value: 18, tone: 'positive' },
                          { id: 'invoice', label: 'To invoice', value: 6, tone: 'warning' },
                        ]}
                      />
                    }
                  />,
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'board-page',
        name: 'Board page',
        description:
          'The canonical horizontal workspace: durable context, compact identity, global controls and an uninterrupted board canvas.',
        render: () => (
          <BoardPage
            variant="operational"
            context="CRM / Pipeline"
            eyebrow="Pipeline"
            title="Sales opportunities"
            actions={<Button label="Create opportunity" variant="primary" />}
            controls={
              <ActionGroup
                label="Board controls"
                actions={[
                  <LinkButton label="My opportunities" href="#board-page" size="compact" />,
                  <LinkButton label="All teams" href="#board-page" size="compact" variant="tertiary" />,
                ]}
              />
            }
            body={
              <Grid
                columns={3}
                items={[
                  <ContentCard title="Qualified" meta="8 opportunities" body="125,000,000 ₫" />,
                  <ContentCard title="Proposal" meta="5 opportunities" body="94,000,000 ₫" />,
                  <ContentCard title="Negotiation" meta="3 opportunities" body="62,000,000 ₫" />,
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'pipeline',
        name: 'Pipeline',
        description:
          'Stages of a process and the work sitting in each. A later stage may hold more than the one before it.',
        render: () => (
          <Pipeline
            label="Order pipeline"
            steps={[
              { id: 'draft', label: 'Draft', value: 24, href: '#pipeline' },
              { id: 'sent', label: 'Sent', value: 9, href: '#pipeline', tone: 'info' },
              { id: 'confirmed', label: 'Confirmed', value: 18, href: '#pipeline', tone: 'positive' },
              { id: 'to-invoice', label: 'To invoice', value: 6, href: '#pipeline', tone: 'warning' },
            ]}
          />
        ),
      },
      {
        id: 'data-table',
        name: 'Data table',
        description: 'Columns are data; rows remain semantic and horizontally contained.',
        render: () => (
          <DataTable
            title="Recent sales orders"
            actions={<LinkButton label="View all orders" href="#app-shell" variant="tertiary" />}
            rows={[] as OrderRow[]}
            id={(row) => row.id}
            rowHref={(row) => `#${row.id}`}
            responsive="stack"
            gutter="compact"
            selection={{ selectedIds: ['SO-1042'] }}
            groups={[
              {
                id: 'ready',
                label: 'Ready to invoice',
                count: 2,
                href: '#data-table',
                rows: orders.slice(0, 2),
                pager: { label: '2 shown in Ready', nextHref: '#data-table' },
              },
              {
                id: 'blocked',
                label: 'Needs decision',
                count: 1,
                rows: orders.slice(2),
              },
            ]}
            columns={[
              {
                key: 'id',
                label: 'Order',
                cell: (row) => row.id,
                priority: 'primary',
                kind: 'identifier',
                sort: { href: '#data-table', direction: 'descending' },
              },
              { key: 'customer', label: 'Customer', cell: (row) => row.customer },
              { key: 'total', label: 'Total', cell: (row) => row.total, align: 'end', kind: 'currency' },
              {
                key: 'state',
                label: 'State',
                cell: (row) => <Badge label={row.state} tone={toneOf(row.state)} />,
                kind: 'status',
              },
            ]}
          />
        ),
      },
      {
        id: 'form-page',
        name: 'Form page',
        description:
          'The canonical form hierarchy: record identity and decision first, a stable form column, then durable context.',
        render: () => (
          <FormPage
            variant="operational"
            context="Customers / Mùa Hạ Riverside"
            title="Mùa Hạ Riverside"
            status={<Badge label="Active" tone="positive" />}
            actions={<Button label="Save partner" variant="primary" />}
            body={
              <Surface
                title="Main information"
                body={
                  <RecordForm
                    action="#form-page"
                    fields={[
                      { id: 'partner-name', name: 'name', label: 'Name', value: 'Mùa Hạ Riverside' },
                      { id: 'partner-ref', name: 'ref', label: 'Reference', value: 'CUS-0042' },
                      {
                        id: 'partner-email',
                        name: 'email',
                        label: 'Email',
                        type: 'email',
                        value: 'hello@muaha.example',
                      },
                      {
                        id: 'partner-phone',
                        name: 'phone',
                        label: 'Phone',
                        type: 'tel',
                        value: '+84 28 3822 0042',
                      },
                    ]}
                    submitLabel="Save partner"
                  />
                }
              />
            }
            aside={
              <Section
                title="Record context"
                body={<Stack gap="compact" items={['Customer since 2023', '6 delivery addresses']} />}
              />
            }
            asideLabel="Partner context"
          />
        ),
      },
      {
        id: 'record-form-three-columns',
        name: 'Record form · three peer fields',
        description:
          'Three columns in a wide form (56rem or more), the default layout in smaller containers, and one column on mobile. Field labels and native submission remain component-owned.',
        render: () => (
          <Surface
            title="Add purchase line"
            body={
              <RecordForm
                action="#record-form-three-columns"
                columns={3}
                fields={[
                  {
                    id: 'purchase-product',
                    name: 'product',
                    label: 'Product',
                    type: 'select',
                    options: [
                      {
                        value: 'carton',
                        label: 'Shipping carton · 30 × 20 × 15cm',
                      },
                    ],
                  },
                  {
                    id: 'purchase-quantity',
                    name: 'quantity',
                    label: 'Quantity',
                    type: 'number',
                    value: '1',
                    required: true,
                  },
                  {
                    id: 'purchase-price',
                    name: 'price',
                    label: 'Unit price',
                    type: 'number',
                    value: '0',
                    required: true,
                  },
                ]}
                submitLabel="Add line"
              />
            }
          />
        ),
      },
      {
        id: 'record-form',
        name: 'Record form',
        description: 'Application supplies translated labels and values, not form markup.',
        render: () => (
          <Surface
            title="Main information"
            body={
              <RecordForm
                action="#record-form"
                fields={[
                  { id: 'record-name', name: 'name', label: 'Display name', value: 'Mùa Hạ Riverside' },
                  {
                    id: 'record-status',
                    name: 'status',
                    label: 'Lifecycle',
                    type: 'select',
                    value: 'ready',
                    options: [
                      { value: 'draft', label: 'Draft' },
                      { value: 'ready', label: 'Ready' },
                    ],
                  },
                  {
                    id: 'record-note',
                    name: 'note',
                    label: 'Internal note',
                    type: 'textarea',
                    value: 'Migration approved by the operations team.',
                    span: 'full',
                  },
                ]}
                submitLabel="Save record"
                cancelHref="#patterns"
                cancelLabel="Cancel"
              />
            }
          />
        ),
      },
      {
        id: 'peer-section-dividers',
        name: 'Peer groups with disclosed fields',
        description:
          'One divided Stack owns the hairlines between groups, including a Disclosure. Surface and flat presentation remove child frames while preserving the parent divider.',
        render: () => (
          <Surface
            title="Call"
            body={
              <Stack
                divided
                items={[
                  <Section title="Result" body="Reached the customer" />,
                  <Disclosure
                    summary="Additional information"
                    body={<Field id="peer-note" name="note" label="Internal note" type="textarea" />}
                  />,
                  <Section title="Next contact" body="Tomorrow at 09:00" />,
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'form-grid',
        name: 'Form grid in sections',
        description:
          'A form split into sections lays each group out as a record form does: three peer fields per row once the group is 52rem wide, one column on a phone. Repeated groups carry an id so their fields say whose they are.',
        render: () => (
          <form action="#form-grid" method="post">
            <Stack
              divided
              items={['Lead guest', 'Second guest'].map((title, index) => (
                <Section
                  id={`form-grid-guest-${index + 1}`}
                  title={title}
                  body={
                    <FormGrid
                      columns={3}
                      items={[
                        <Field
                          id={`form-grid-name-${index}`}
                          name={`guest-${index}-name`}
                          label="Full name"
                          required
                        />,
                        <Field
                          id={`form-grid-birth-${index}`}
                          name={`guest-${index}-birth`}
                          label="Date of birth"
                          type="date"
                          required
                        />,
                        <Field
                          id={`form-grid-document-${index}`}
                          name={`guest-${index}-document`}
                          label="Document"
                          type="select"
                          value="passport"
                          options={[
                            { value: 'passport', label: 'Passport' },
                            { value: 'id', label: 'National ID' },
                          ]}
                        />,
                        <Field
                          id={`form-grid-note-${index}`}
                          name={`guest-${index}-note`}
                          label="Note"
                          type="textarea"
                          span="full"
                        />,
                      ]}
                    />
                  }
                />
              ))}
            />
          </form>
        ),
      },
      {
        id: 'csr-search-link',
        name: 'CSR search workspace',
        description:
          'A hydrated shell links to a search workspace without a native dialog, template or noscript copy.',
        render: () => (
          <AppTopbar
            search={{
              mode: 'link',
              action: '#search',
              label: 'Search workspace',
              placeholder: 'Search',
              submitLabel: 'Search',
            }}
          />
        ),
      },
      {
        id: 'sidebar-wrapped-navigation',
        name: 'Navigation in a sidebar island slot',
        description: 'A single wrapper fills the sidebar; the navigation owns its internal scrolling.',
        render: () => (
          <AppShell
            applications={exampleApplications}
            mode="embedded"
            sidebar={
              <div>
                <AppNavigation
                  id="wrapped-nav"
                  label="Navigation"
                  groups={[
                    {
                      id: 'work',
                      label: 'Work',
                      items: [{ id: 'invoices', label: 'Invoices', href: '#invoices' }],
                    },
                  ]}
                />
              </div>
            }
            main={<Surface title="Invoices" body="The sidebar slot remains visible through its wrapper." />}
          />
        ),
      },
      {
        id: 'metric-exact-long-value',
        name: 'Long exact metric value',
        description:
          'Adaptive card tracks and the metric text column wrap exact amounts instead of clipping them.',
        render: () => (
          <CardGrid
            minimum="wide"
            items={[{ id: 'long', value: '9.007.199.254.740.993 ₫' }]}
            id={(row) => row.id}
            card={(row) => (
              <Metric
                label="Posted revenue with a long translated label"
                value={row.value}
                icon={<Icon name="info" />}
              />
            )}
          />
        ),
      },
      {
        id: 'list-pending-read',
        name: 'Retained results during a read',
        description:
          'The island owns request timing. ListPage announces busy state and dims retained results with the pending opacity token.',
        render: () => (
          <ListPage title="Invoices" busy dimmed body={<OrdersTable title="Retained results" />} />
        ),
      },
      {
        id: 'peek-client-close',
        name: 'Client-owned Peek close',
        description:
          'The closeControl slot accepts a disposable client owner trigger. It remains a non-modal summary.',
        render: () => (
          <PeekLayout
            mode="embedded"
            peekId="client-peek"
            main={<Surface title="Bank transactions" body="Pick a transaction to inspect it." />}
            peek={
              <Peek
                id="client-peek"
                title="FT2628100002"
                body={
                  <DescriptionList
                    columns="auto"
                    items={[{ id: 'amount', label: 'Amount', value: '5,400,000 VND' }]}
                  />
                }
                record={{ label: 'Open reconciliation', href: '#record-page' }}
                closeLabel="Close"
                closeControl={<Button label="Client close" />}
              />
            }
          />
        ),
      },
      {
        id: 'settings-directory',
        name: 'SettingsDirectory',
        description:
          'Every configuration screen the viewer may open, grouped by module: its mark, its name and links. The search narrows links, modules and sections already on the page.',
        render: () => (
          <SettingsDirectory
            id="specimen-settings"
            label="Settings"
            search={{
              label: 'Search settings',
              emptyTitle: 'No setting matches',
              emptyMessage: 'Try another word or clear the search.',
            }}
            sections={[
              {
                id: 'business',
                title: 'Sales and care',
                modules: [
                  {
                    id: 'crm',
                    label: 'CRM',
                    icon: <Icon name="users" />,
                    links: [
                      { id: 'teams', label: 'Teams and assignment', href: '#teams', current: true },
                      { id: 'process', label: 'Sales process', href: '#process' },
                      { id: 'tags', label: 'Profile tags', href: '#tags' },
                    ],
                  },
                  {
                    id: 'care',
                    label: 'Customer care',
                    icon: <Icon name="message-circle" />,
                    links: [
                      { id: 'programs', label: 'Programs', href: '#programs' },
                      { id: 'requests', label: 'Requests and complaints', href: '#requests' },
                    ],
                  },
                  { id: 'hidden', label: 'Not permitted', icon: <Icon name="lock" />, links: [] },
                ],
              },
              {
                id: 'system',
                title: 'Organisation and access',
                modules: [
                  {
                    id: 'users',
                    label: 'Users',
                    icon: <Icon name="shield-check" />,
                    links: [
                      { id: 'users', label: 'Users', href: '#users' },
                      { id: 'roles', label: 'Roles', href: '#roles' },
                    ],
                  },
                ],
              },
            ]}
          />
        ),
      },
      {
        id: 'peek',
        name: 'Peek',
        description:
          'A non-modal summary beside a spatial view: picking another item replaces it. Shown embedded; docked, it stays in view and is a sheet on a phone.',
        render: () => (
          <PeekLayout
            peekId="reservation-peek"
            mode="embedded"
            main={
              <Surface
                title="Room plan"
                body={
                  <Stack
                    items={[
                      <a href="#peek" aria-controls="reservation-peek">
                        Room 101 · R-1041 · Sam Lee
                      </a>,
                      <a href="#peek" aria-controls="reservation-peek" aria-current="true">
                        Room 102 · R-1042 · Alex Morgan
                      </a>,
                      <a href="#peek" aria-controls="reservation-peek">
                        Room 104 · R-1043 · Jordan Diaz
                      </a>,
                    ]}
                  />
                }
              />
            }
            peek={
              <Peek
                id="reservation-peek"
                eyebrow="R-1042"
                title="Alex Morgan"
                status={[
                  <Badge label="Due in" tone="info" />,
                  <Badge label="Deposit paid" tone="positive" />,
                ]}
                previous={{ label: 'Previous arrival', href: '#peek' }}
                next={{ label: 'Next arrival', href: null }}
                closeLabel="Close"
                closeHref="#peek"
                body={
                  <Stack
                    items={[
                      <DescriptionList
                        label="Stay"
                        columns={2}
                        items={[
                          { id: 'arrival', label: 'Arrival', value: <FormattedDate value="2026-09-04" /> },
                          {
                            id: 'departure',
                            label: 'Departure',
                            value: <FormattedDate value="2026-09-07" />,
                          },
                          { id: 'room', label: 'Room', value: '102 · Deluxe king' },
                          { id: 'guests', label: 'Guests', value: '2 adults' },
                        ]}
                      />,
                      <DescriptionList
                        label="Balance"
                        columns={2}
                        items={[
                          {
                            id: 'total',
                            label: 'Total',
                            value: <FormattedMoney value={7200000} currency="VND" />,
                          },
                          {
                            id: 'due',
                            label: 'Balance due',
                            value: <FormattedMoney value={4200000} currency="VND" />,
                          },
                        ]}
                      />,
                    ]}
                  />
                }
                actions={
                  <ActionGroup
                    actions={[
                      <Button label="Check in" variant="primary" />,
                      <Button label="Move room" variant="secondary" />,
                      <Button label="Take payment" variant="secondary" />,
                    ]}
                  />
                }
                record={{ label: 'Open reservation', href: '#record-page' }}
              />
            }
          />
        ),
      },
      {
        id: 'modal-sheet',
        name: 'Modal sheet',
        description: 'Shown embedded here; the production mode occupies the viewport.',
        render: () => (
          <ModalSheet
            id="release-drift-modal"
            mode="embedded"
            title="Resolve release drift"
            closeHref="#modal-sheet"
            closeLabel="Close modal"
            body={
              <Stack
                items={[
                  <Notice
                    title="Two tenants are behind"
                    message="Migration runs separately for each database and preserves failed tenants for retry."
                    tone="warning"
                  />,
                  <ActionGroup
                    actions={[
                      <Button label="Start migration" variant="primary" />,
                      <LinkButton label="Review plan" href="#data-table" variant="tertiary" />,
                    ]}
                  />,
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'workspace-modal',
        name: 'Viewport-width modal workspace',
        description:
          'Explicit spatial dialog with several working columns; title/footer stay around the body.',
        render: () => (
          <ModalSheet
            id="workspace-modal-example"
            mode="embedded"
            presentation="dialog"
            size="workspace"
            height="fixed"
            title="Create order workspace"
            closeHref="#workspace-modal"
            closeLabel="Close workspace"
            body={
              <Grid
                columns={3}
                items={[
                  <Section title="Products" body={<Text>Searchable product list</Text>} />,
                  <Section title="Cart & payment" body={<Text>Quantities, fee and total</Text>} />,
                  <Section title="Delivery" body={<Text>Recipient, carrier and parcel options</Text>} />,
                ]}
              />
            }
          />
        ),
      },
    ],
  },
  {
    id: 'interactions',
    name: 'Interaction essentials',
    description: 'Controlled SSR state with native fallbacks and one optional runtime adapter.',
    examples: [
      {
        id: 'menu',
        name: 'Menu and action menu',
        description: 'Native disclosure supports links, submit actions, descriptions and disabled state.',
        render: () => (
          <Inline
            items={[
              <Menu
                id="record-menu"
                label="Record actions"
                open
                items={[
                  { id: 'record-label', kind: 'label', label: 'Record' },
                  { id: 'empty', kind: 'label', label: 'No matching actions', hidden: true },
                  { id: 'open', label: 'Open record', href: '#record-page' },
                  { id: 'watch', label: 'Watch changes', value: 'watch', checked: true, shortcut: 'W' },
                  { id: 'separator', kind: 'separator' },
                  {
                    id: 'duplicate',
                    label: 'Duplicate',
                    value: 'duplicate',
                    description: 'Create a new draft',
                  },
                  { id: 'archive', label: 'Archive', value: 'archive', destructive: true },
                ]}
              />,
              <ActionMenu
                id="more-actions"
                label="More actions"
                items={[{ id: 'export', label: 'Export report', href: '#data-table' }]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'grouped-action-menu',
        name: 'Grouped action menu',
        description:
          'Groups name related commands for assistive technology; a separator precedes every group after the first.',
        render: () => (
          <ActionMenu
            id="stay-actions"
            label="More actions"
            open
            items={[
              {
                id: 'stay',
                kind: 'group',
                label: 'In-house guest',
                items: [
                  { id: 'move-room', label: 'Move room', value: 'move-room' },
                  { id: 'extend-stay', label: 'Extend stay', value: 'extend-stay' },
                ],
              },
              {
                id: 'cashier',
                kind: 'group',
                label: 'Cashier',
                items: [
                  { id: 'payment', label: 'Take payment', value: 'payment' },
                  { id: 'charge', label: 'Post charge', value: 'charge' },
                ],
              },
              {
                id: 'room',
                kind: 'group',
                label: 'Room',
                items: [
                  {
                    id: 'out-of-service',
                    label: 'Take out of service',
                    value: 'out-of-service',
                    destructive: true,
                  },
                ],
              },
            ]}
          />
        ),
      },
      {
        id: 'context-button',
        name: 'Context button',
        description:
          'Two-line workspace context with server-owned selection and an optional count; it is not a record card.',
        render: () => (
          <Inline
            items={[
              <ContextButton label="Personal inbox" description="Messaging account" count={5} pressed />,
              <ContextButton label="Store inbox" description="Official account" count={3} pressed={false} />,
              <ContextButton label="Unavailable workspace" description="Access required" disabled />,
            ]}
          />
        ),
      },
      {
        id: 'popover',
        name: 'Popover and tooltip',
        description: 'Popover state remains URL-owned; tooltips contain descriptive text only.',
        render: () => (
          <Inline
            items={[
              <Popover
                id="owner-popover"
                label="Record owner"
                trigger={<Badge label="Show owner" />}
                body={<p>Nguyễn Ngọc Linh · Sales operations</p>}
                open
                openHref="#popover"
                closeHref="#popover"
                closeLabel="Close owner details"
              />,
              <Tooltip
                id="sync-tip"
                text="Last synchronized two minutes ago"
                trigger={<Badge label="Synced" tone="positive" />}
              />,
            ]}
          />
        ),
      },
      {
        id: 'dialog',
        name: 'Dialog and confirmation',
        description: 'Named modal semantics with native close and submit paths.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Dialog
                id="details-dialog"
                mode="embedded"
                title="Review assignment"
                description="The current owner keeps access."
                closeHref="#dialog"
                closeLabel="Close dialog"
                body={<p>Assign this record to the operations queue.</p>}
              />,
              <ConfirmDialog
                id="archive-dialog"
                mode="embedded"
                title="Archive record?"
                message="The record leaves active worklists but remains available in history."
                closeHref="#dialog"
                closeLabel="Cancel"
                confirmLabel="Archive"
                details={
                  <Checkbox
                    id="archive-understood"
                    name="understood"
                    label="Keep it out of active worklists"
                  />
                }
              />,
            ]}
          />
        ),
      },
      {
        id: 'feedback-runtime',
        name: 'Transient feedback and loading',
        description:
          'Live-region toasts (one reporting background work with progress), compact progress and content skeletons share state rules.',
        render: () => (
          <Stack
            items={[
              <Inline items={[<Spinner label="Saving record" />, <span>Saving record</span>]} />,
              <Skeleton label="Loading customer summary" lines={3} />,
              <ToastRegion
                label="Notifications"
                toasts={[
                  {
                    id: 'saved',
                    title: 'Record saved',
                    message: 'All changes are synchronized.',
                    tone: 'positive',
                  },
                  {
                    id: 'importing',
                    title: 'Importing products',
                    message: 'products-october.csv · Started by Linh',
                    tone: 'info',
                    progress: { value: 40, label: '180 of 450 rows' },
                  },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'search-filter',
        name: 'Search filter',
        description:
          'Search, filter/group/favorite controls and applied chips share a component-owned 48rem maximum width and fill narrower containers. This hydrated island owns query state; mobile opens the same sections in a sheet. Try the applied facets and a long search phrase to check wrapping. The manager is omitted, so toggling a control updates its chip locally without a server round trip.',
        render: () =>
          createSearchFilterView({ id: 'demo-search-filter', config: searchFilterDemoConfig }).view(),
      },
      {
        id: 'search-filter-expanded',
        name: 'Expanded search filter',
        description:
          'Two-row search toolbar: visible labelled preset values, independent grouping/saved searches and an on-demand custom-rule editor. Applied preset/group state stays in its control; only custom rules and field searches use chips. Compact consumers remain unchanged.',
        render: () =>
          createSearchFilterView({
            id: 'demo-search-filter-expanded',
            config: {
              ...searchFilterDemoConfig,
              labels: { ...searchFilterDemoConfig.labels, customFilterToggle: 'Condition' },
              presentation: 'expanded',
              filters: searchFilterDemoConfig.filters.map((option) => ({
                ...option,
                groupLabel: option.group === 'status' ? 'Status' : 'Created on',
              })),
            },
          }).view(),
      },
      {
        id: 'search-filter-list-chrome',
        name: 'Search filter in list chrome',
        description:
          'ListChrome query slot: the expanded search filter leads the row at its own width; the view switch and a saved-filter action end the row level with the search bar and move under it as one group where the row runs out.',
        render: () => (
          <ListChrome
            query={createSearchFilterView({
              id: 'demo-search-filter-chrome',
              config: { ...searchFilterDemoConfig, presentation: 'expanded' },
            }).view()}
            viewsLabel="View"
            views={[
              { id: 'table', label: 'Table', href: '#search-filter-list-chrome', active: true },
              { id: 'cards', label: 'Cards', href: '#search-filter-list-chrome' },
            ]}
            actions={<LinkButton label="Edit saved filter" href="#search-filter-list-chrome" />}
          />
        ),
      },
      {
        id: 'search-filter-presets',
        name: 'Preset search filter',
        description:
          'The same compact search with only supported preset facets; unsupported custom rules, grouping and favorites are omitted.',
        render: () =>
          createSearchFilterView({
            id: 'demo-search-filter-presets',
            config: {
              ...searchFilterDemoConfig,
              size: 'compact',
              capabilities: { groupBy: false, favorites: false, customFilters: false },
              facets: searchFilterDemoConfig.facets.filter((facet) => facet.type === 'filter'),
              groupBy: [],
              favorites: [],
              customFilterFields: [],
            },
          }).view(),
      },
      {
        id: 'ket-table',
        name: 'Ket table',
        description:
          'Selectable table island with either manager RPCs or native URL navigation. Shown flat, grouped with preloaded rows, URL-driven with an active sort, and with the row the reader came back to marked current. The last specimen delegates paging to its surrounding toolbar. Demo links target this catalogue section; production routes supply real sort, group and page URLs.',
        render: () => (
          <Stack
            items={[
              createKetTableView({ id: 'demo-ket-table', config: ketTableDemoConfig }).view(),
              <KetTable
                columns={[
                  { key: 'work', label: 'Initial collection read', cell: (row: { id: string }) => row.id },
                  { key: 'customer', label: 'Customer', cell: () => 'Customer' },
                ]}
                rows={[]}
                id={(row: { id: string }) => row.id}
                loading={{ rows: 3 }}
                selection={{ formId: 'catalogue-loading-selection', fieldName: 'selected' }}
                responsive="stack"
                labels={ketTableDemoConfig.labels}
                caption="Table-owned loading rows; selection stays disabled until the read answers"
              />,
              <KetTable
                columns={[{ key: 'work', label: 'Retained result', cell: (row: { id: string }) => row.id }]}
                rows={[{ id: 'Previous result' }]}
                id={(row) => row.id}
                busy
                labels={ketTableDemoConfig.labels}
                caption="Delayed refresh retains and dims the previous answer"
              />,
              <Surface
                title="Table inside a working surface"
                body={createKetTableView({
                  id: 'demo-ket-table-in-surface',
                  config: ketTableDemoConfig,
                }).view()}
              />,
              <KetTable
                columns={[
                  {
                    key: 'name',
                    label: 'Server collection',
                    wrap: true,
                    cell: (row: { id: string; name: string }) => <strong>{row.name}</strong>,
                    sortHref: '#ket-table',
                  },
                ]}
                rows={[
                  {
                    id: 'server-row',
                    name: 'Semantic server cell with a descriptive product name that wraps while the row grows to keep all of its content readable',
                  },
                ]}
                id={(row) => row.id}
                rowHref={() => '#ket-table'}
                layout="fixed"
                caption="Fixed columns · URL-driven server collection"
                labels={ketTableDemoConfig.labels}
              />,
              <KetTable
                columns={[
                  { key: 'id', label: 'Reservation', cell: (row: { id: string; guest: string }) => row.id },
                  { key: 'guest', label: 'Guest', cell: (row: { id: string; guest: string }) => row.guest },
                ]}
                rows={[
                  { id: 'R-1041', guest: 'Sam Lee' },
                  { id: 'R-1042', guest: 'Alex Morgan' },
                  { id: 'R-1043', guest: 'Jordan Park' },
                ]}
                id={(row) => row.id}
                rowHref={(row) => `#ket-table-${row.id}`}
                currentRow="R-1042"
                caption="The row the reader came back to from its record page"
                labels={ketTableDemoConfig.labels}
              />,
              <Code value={rowAnchorHref('/reservations?page=2', 'R-1042', { top: 336, left: 214 })} />,
              <Text>
                Native record links carry the measured row position and table scroll in returnTo. Back and the
                record header restore that position; unmeasured links centre the row.
              </Text>,
              createKetTableView({ id: 'demo-ket-table-grouped', config: ketTableGroupedDemoConfig }).view(),
              createKetTableView({
                id: 'demo-ket-table-navigation',
                config: {
                  ...ketTableDemoConfig,
                  manager: undefined,
                  pager: false,
                  sort: { field: 'name', direction: 'asc' },
                  columns: ketTableDemoConfig.columns.map((column) => ({
                    ...column,
                    sortable: false,
                    sortHref: column.key === 'name' ? '#ket-table' : undefined,
                  })),
                },
              }).view(),
            ]}
          />
        ),
      },
      {
        id: 'relation-select',
        name: 'Relation select',
        description:
          'Unlike its neighbors above, this is a ketjs-view island — it owns state and fetches its own results client-side, so it keeps working after this static snapshot only once the page hydrates it. Shown in its default (closed) state with one value already chosen; distinct from RelationPicker below, which is href-driven and receives results pre-fetched by the server.',
        render: () => (
          <Stack
            items={[
              createRelationSelectView({
                id: 'demo-relation-select',
                config: relationSelectDemoConfig,
              }).view(),
              createRelationSelectView(
                {
                  id: 'demo-relation-add',
                  config: {
                    ...relationSelectDemoConfig,
                    value: null,
                    ariaLabel: 'Add a partner',
                    labels: { ...relationSelectDemoConfig.labels, choose: 'Add a partner' },
                  },
                },
                {
                  options: () => relationSelectDemoConfig.options,
                  resetAfterSelect: true,
                  onCreate: () => {},
                },
              ).view(),
              Field({
                id: 'demo-relation-validation',
                name: 'partnerId',
                label: 'Partner',
                error: 'Choose an active partner.',
                control: createRelationSelectView({
                  id: 'demo-relation-validation-picker',
                  config: {
                    ...relationSelectDemoConfig,
                    name: 'partnerId',
                    value: null,
                    triggerId: 'demo-relation-validation',
                    invalid: true,
                    describedBy: 'demo-relation-validation-error',
                    ariaLabel: 'Partner',
                  },
                }).view(),
              }),
            ]}
          />
        ),
      },
      {
        id: 'lightbox',
        name: 'Lightbox',
        description:
          'A Fancybox-style image viewer, also an island: thumbnails open a full-screen stage with zoom (buttons, wheel, click to toggle 2×), drag to pan, pinch on a touch screen, previous/next and a counter; Escape closes and returns focus to the thumbnail. `createLightbox` is the same viewer without thumbnails, for a view that renders its own.',
        render: () => createLightboxView({ id: 'demo-lightbox', config: lightboxDemoConfig }).view(),
      },
    ],
  },
  {
    id: 'form-controls',
    name: 'Form controls and pickers',
    description: 'Typed, server-rendered controls preserve user input and native submission semantics.',
    examples: [
      {
        id: 'scalar-fields',
        name: 'Scalar fields',
        description: 'Text, long text, search, exact numeric and money values share one field contract.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <TextField id="customer" name="customer" label="Customer" value="An Việt" required />,
              <SearchField id="reference" name="reference" label="Reference" value="SO-1042" />,
              <NumberField id="quantity" name="quantity" label="Quantity" value="12" min="0" />,
              <MoneyField id="total" name="total" label="Total" value="18450000.00" />,
              <TextArea
                id="note"
                name="note"
                label="Internal note"
                value="Deliver before 17:00."
                span="full"
              />,
            ]}
          />
        ),
      },
      {
        id: 'selection-controls',
        name: 'Selection controls',
        description: 'Native checkbox, group, radio, switch and select states remain submit-capable.',
        render: () => (
          <Stack
            items={[
              <Checkbox id="priority" name="priority" label="Priority order" value />,
              <CheckboxGroup
                id="channels"
                name="channels"
                label="Channels"
                options={[
                  { value: 'email', label: 'Email', checked: true },
                  { value: 'sms', label: 'SMS' },
                ]}
              />,
              <RadioGroup
                id="delivery"
                name="delivery"
                label="Delivery"
                value="standard"
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'express', label: 'Express' },
                ]}
              />,
              <Switch id="notify" name="notify" label="Notify owner" checked />,
              <Switch id="selected-only" name="selected-only" label="Selected" inline />,
              <Select
                id="warehouse"
                name="warehouse"
                label="Warehouse"
                value="hn"
                options={[
                  { value: 'hn', label: 'Hà Nội' },
                  { value: 'hcm', label: 'Hồ Chí Minh' },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'comboboxes',
        name: 'Combobox and tags',
        description: 'Query, open state and selected values remain controlled by URL or application state.',
        render: () => {
          const options = [
            { value: 'linh', label: 'Ngọc Linh', description: 'Sales operations' },
            { value: 'minh', label: 'Minh Anh', description: 'Fulfilment' },
          ]
          return (
            <Stack
              items={[
                <Combobox
                  id="owner"
                  name="owner"
                  label="Owner"
                  query="Ngọc"
                  value="linh"
                  options={options.map((option) => ({
                    ...option,
                    leading: <Avatar name={option.label} size="small" />,
                  }))}
                  open
                  openHref="#comboboxes"
                  closeHref="#comboboxes"
                />,
                <MultiCombobox
                  id="watchers"
                  name="watchers"
                  label="Watchers"
                  query=""
                  options={options}
                  values={['linh']}
                  open={false}
                  openHref="#comboboxes"
                  closeHref="#comboboxes"
                  removeHref={() => '#comboboxes'}
                />,
                <TagPicker
                  id="tags"
                  name="tags"
                  label="Tags"
                  query=""
                  options={[{ value: 'urgent', label: 'Urgent' }]}
                  values={['urgent']}
                  open={false}
                  openHref="#comboboxes"
                  closeHref="#comboboxes"
                  removeHref={() => '#comboboxes'}
                />,
              ]}
            />
          )
        },
      },
      {
        id: 'date-time',
        name: 'Date pickers and local time',
        description:
          'Interactive calendars, seven quick ranges, draft selection and native civil-date submission. Open /dates for the focused playground.',
        render: () => (
          <Stack
            items={[
              <DatePickerExamples />,
              <DateTimePicker
                id="appointment"
                name="appointment"
                label="Appointment"
                value="2026-09-08T14:30"
              />,
              <TimePicker id="cutoff" name="cutoff" label="Cut-off" value="17:00" />,
            ]}
          />
        ),
      },
      {
        id: 'uploads',
        name: 'File upload and drop zone',
        description: 'Native file input owns submission; the application owns transport and storage.',
        render: () => (
          <Stack
            items={[
              <Field
                id="catalogue-product-photo"
                name="product-photo"
                label="Product photo"
                layout="inline"
                control={
                  <ImageDropZone
                    label="Product photo"
                    picker={
                      <label data-ui="image-drop-picker">
                        <input
                          id="catalogue-product-photo"
                          type="file"
                          accept="image/*"
                          aria-label="Choose product photo"
                        />
                        <span>Choose or drop photo</span>
                      </label>
                    }
                  />
                }
              />,
              <FileUpload id="invoice" name="invoice" label="Invoice" accept="application/pdf" />,
              <DropZone
                id="photos"
                name="photos"
                label="Delivery photos"
                accept="image/*"
                multiple
                preview={null}
                status="Drop images here or click to choose · Up to 10 files"
              />,
            ]}
          />
        ),
      },
      {
        id: 'relation-picker',
        name: 'Relation picker',
        description: 'The renderer only receives permission-filtered records from the application adapter.',
        render: () => (
          <RelationPicker
            id="partner"
            name="partner"
            label="Partner"
            query="An"
            value="an-viet"
            results={[
              { id: 'an-viet', name: 'An Việt', city: 'Hà Nội' },
              { id: 'anh-duong', name: 'Ánh Dương', city: 'Đà Nẵng' },
            ]}
            getValue={(partner) => partner.id}
            getLabel={(partner) => partner.name}
            getDescription={(partner) => partner.city}
            open
            openHref="#relation-picker"
            closeHref="#relation-picker"
          />
        ),
      },
    ],
  },
  {
    id: 'data-operations',
    name: 'Data operations',
    description: 'URL-owned collection controls and bounded data renderers for operational work.',
    examples: [
      {
        id: 'collection-controls',
        name: 'Search, filter and sort',
        description: 'Every control has a canonical URL and preserves unrelated query state.',
        render: () => (
          <Stack
            items={[
              <SearchBar action="/orders" value="An Việt" hidden={{ state: 'open' }} />,
              <FilterBar
                filters={[
                  <LinkButton href="/orders?state=open" label="Open" size="compact" />,
                  <LinkButton href="/orders?owner=me" label="My records" size="compact" />,
                  <SortMenu
                    id="sort-orders"
                    choices={[
                      {
                        id: 'updated',
                        label: 'Recently updated',
                        href: '/orders?sort=updated',
                        active: true,
                      },
                      { id: 'value', label: 'Highest value', href: '/orders?sort=value' },
                    ]}
                  />,
                ]}
              />,
              <AppliedFilters
                filters={[
                  { id: 'state', label: 'State', value: 'Open', removeHref: '/orders?q=An+Việt' },
                  { id: 'owner', label: 'Owner', value: 'Me', removeHref: '/orders?state=open' },
                ]}
                clearHref="/orders"
              />,
            ]}
          />
        ),
      },
      {
        id: 'saved-views',
        name: 'Saved views and settings',
        description:
          'The renderer carries version tokens while the application owns persistence and permission.',
        render: () => (
          <Stack
            items={[
              <SavedViews
                views={[
                  {
                    id: 'all',
                    label: 'All orders',
                    href: '/orders',
                    active: true,
                    description: '148 records',
                  },
                  {
                    id: 'review',
                    label: 'Needs review',
                    href: '/orders?view=review',
                    description: '7 records',
                  },
                ]}
              />,
              <ViewSettings
                id="order-view"
                action="/orders/views"
                version="7"
                settings={[
                  { id: 'customer', label: 'Customer', visible: true, disabled: true },
                  { id: 'total', label: 'Total', visible: true },
                  { id: 'owner', label: 'Owner', visible: false },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'resource-list',
        name: 'Resource list',
        description: 'One keyboard link per row with optional selection and paging composition.',
        render: () => (
          <ResourceList
            label="Orders"
            rows={orders}
            id={(row) => row.id}
            href={(row) => `/orders/${row.id}`}
            primary={(row) => `${row.id} · ${row.customer}`}
            secondary={(row) => row.total}
            meta={(row) => <Badge label={row.state} tone={toneOf(row.state)} />}
            selectedIds={['SO-1042']}
            pager={{ summary: '1–3 of 148', nextHref: '/orders?page=2' }}
          />
        ),
      },
      {
        id: 'data-grid',
        name: 'Bounded data grid',
        description:
          'Column order, visibility and pinning are explicit; row rendering is capped before virtualization.',
        render: () => (
          <DataGrid
            label="Order analysis"
            rows={orders}
            id={(row) => row.id}
            maxRows={500}
            columns={[
              { key: 'id', label: 'Order', cell: (row) => row.id, pinned: 'start', width: '8rem' },
              { key: 'customer', label: 'Customer', cell: (row) => row.customer, width: '18rem' },
              { key: 'total', label: 'Total', cell: (row) => row.total, width: '10rem' },
              { key: 'state', label: 'State', cell: (row) => row.state, width: '9rem' },
            ]}
          />
        ),
      },
      {
        id: 'timeframe-filter',
        name: 'Timeframe filter',
        description:
          'The period a screen reports on: every option is a link, with the resolved range and build time beside it.',
        render: () => (
          <TimeframeFilter
            id="specimen-period"
            label="Report period"
            options={[
              { id: 'today', label: 'Today', href: '#timeframe-filter' },
              { id: 'last_7_days', label: 'Last 7 days', href: '#timeframe-filter' },
              { id: 'last_30_days', label: 'Last 30 days', href: '#timeframe-filter', active: true },
              { id: 'this_month', label: 'This month', href: '#timeframe-filter' },
            ]}
            range="2026-08-06 → 2026-09-04"
            asOf="2026-09-04 09:40"
            asOfLabel="Updated"
            note="Asia/Ho_Chi_Minh"
          />
        ),
      },
      {
        id: 'bar-chart',
        name: 'Bar chart',
        description:
          'Magnitudes on one scale as real text: plain bars for ranking, a fixed maximum for rates, segments for a split.',
        render: () => (
          <Stack
            items={[
              <BarChart
                label="Lost opportunities by reason"
                bars={[
                  { id: 'price', label: 'Price or budget', value: 9, caption: '42.9%' },
                  { id: 'fit', label: 'Not a fit', value: 6, caption: '28.6%' },
                  { id: 'competitor', label: 'Chose a competitor', value: 4, caption: '19.0%' },
                ]}
                value={(bar) => String(bar.value)}
              />,
              <BarChart
                label="Support SLA"
                max={100}
                bars={[
                  { id: 'met', label: 'Met', value: 94.2, caption: '194 requests' },
                  { id: 'breached', label: 'Breached', value: 2.4, caption: '5 requests' },
                ]}
                value={(bar) => `${bar.value}%`}
                scale={['0%', '50%', '100%']}
              />,
              <BarChart
                label="Revenue by customer type"
                keys={[
                  { id: 'returning', label: 'Returning', series: 1 },
                  { id: 'new', label: 'New', series: 2 },
                ]}
                bars={[
                  {
                    id: 'jul',
                    label: 'July',
                    value: 379,
                    segments: [
                      { series: 1, value: 147 },
                      { series: 2, value: 232 },
                    ],
                  },
                  {
                    id: 'aug',
                    label: 'August',
                    value: 428.6,
                    segments: [
                      { series: 1, value: 164.6 },
                      { series: 2, value: 264 },
                    ],
                  },
                ]}
                value={(bar) => `${bar.value}m`}
              />,
              <BarChart label="Empty" bars={[]} value={() => ''} empty="No data in this period" />,
            ]}
          />
        ),
      },
      {
        id: 'column-chart',
        name: 'Column chart',
        description:
          'A magnitude over ordered periods: one series, a stacked split with a legend, and a reference level.',
        render: () => {
          const days = [12.4, 13.1, 11.8, 14.6, 15.2, 9.8, 10.4, 14.9, 15.6, 16.1, 12.2, 13.7, 15.8, 16.4]
          const money = (value: number): string => `${value.toFixed(1)}m ₫`
          return (
            <Stack
              items={[
                <ColumnChart
                  label="Daily ad spend, 30 Sep to 13 Oct"
                  points={days.map((value, index) => ({
                    id: `d${index}`,
                    label: index === 0 ? '30/09' : `${String(index).padStart(2, '0')}/10`,
                    value,
                  }))}
                  value={(point) => money(point.value)}
                  tick={(value) => `${Math.round(value)}m`}
                  reference={{ value: 14, label: 'Daily budget 14m ₫' }}
                  labelEvery={3}
                />,
                <ColumnChart
                  label="Orders by channel per week"
                  keys={[
                    { id: 'web', label: 'Website', series: 1 },
                    { id: 'chat', label: 'Chat', series: 2 },
                    { id: 'phone', label: 'Phone', series: 3 },
                  ]}
                  points={[
                    {
                      id: 'w38',
                      label: 'Week 38',
                      value: 96,
                      segments: [
                        { series: 1, value: 52 },
                        { series: 2, value: 31 },
                        { series: 3, value: 13 },
                      ],
                    },
                    {
                      id: 'w39',
                      label: 'Week 39',
                      value: 112,
                      segments: [
                        { series: 1, value: 58 },
                        { series: 2, value: 38 },
                        { series: 3, value: 16 },
                      ],
                    },
                    {
                      id: 'w40',
                      label: 'Week 40',
                      value: 104,
                      segments: [
                        { series: 1, value: 50 },
                        { series: 2, value: 36 },
                        { series: 3, value: 18 },
                      ],
                    },
                    {
                      id: 'w41',
                      label: 'Week 41',
                      value: 131,
                      segments: [
                        { series: 1, value: 64 },
                        { series: 2, value: 47 },
                        { series: 3, value: 20 },
                      ],
                    },
                  ]}
                  value={(point) => `${point.value} orders`}
                />,
                <ColumnChart label="Empty" points={[]} value={() => ''} empty="No data in this period" />,
              ]}
            />
          )
        },
      },
      {
        id: 'data-matrix',
        name: 'Data matrix',
        description:
          'Ordered rows compare the same dimensions while workflow content stays application-owned.',
        render: () => (
          <DataMatrix
            label="Care checkpoints and evidence"
            rowLabel="Checkpoint"
            eyebrow="Outcome tracking"
            title="Barrier recovery routine"
            description="Started 01 September 2026"
            summary={<Badge label="2 / 3 complete" tone="info" />}
            columns={[
              { id: 'front', label: 'Front', description: 'Required' },
              { id: 'left', label: 'Left profile' },
              { id: 'right', label: 'Right profile' },
            ]}
            rows={[
              {
                id: 'day-1',
                label: 'D+1 · Baseline',
                description: '02/09/2026',
                status: <Badge label="Complete" tone="positive" />,
                cells: { front: 'Photo 01', left: 'Photo 02', right: 'Photo 03' },
              },
              {
                id: 'day-7',
                label: 'D+7 · Adaptation',
                description: '08/09/2026',
                status: <Badge label="Planned" tone="warning" />,
                actions: <Button label="Open checkpoint" size="compact" />,
                cells: { front: 'Upload', left: 'Upload', right: 'Not required' },
              },
            ]}
          />
        ),
      },
      {
        id: 'tree',
        name: 'Tree and tree grid',
        description:
          'Hierarchy uses native links; tabular hierarchy is reserved for independent multi-column data.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Tree
                label="Workspace pages"
                nodes={[
                  {
                    id: 'sales',
                    label: 'Sales',
                    expanded: true,
                    children: [
                      { id: 'orders', label: 'Orders', href: '/orders', active: true },
                      { id: 'reports', label: 'Reports', href: '/reports' },
                    ],
                  },
                ]}
              />,
              <TreeGrid
                label="Account hierarchy"
                primaryLabel="Account"
                rows={[
                  {
                    row: { id: '100', name: 'Assets', balance: '120.000.000 ₫' },
                    level: 1,
                    hasChildren: true,
                  },
                  { row: { id: '110', name: 'Cash', balance: '42.000.000 ₫' }, level: 2 },
                ]}
                id={(row) => row.id}
                primary={(row) => `${row.id} · ${row.name}`}
                rowHref={(row) => `#account-${row.id}`}
                columns={[{ key: 'balance', label: 'Balance', cell: (row) => row.balance }]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'inline-edit',
        name: 'Inline edit',
        description: 'Controlled edit state keeps a native form fallback, stale version and rejected input.',
        render: () => (
          <InlineEdit
            id="customer-name"
            label="Customer"
            value="An Việt"
            editing
            editHref="?edit=customer"
            cancelHref="?edit="
            action="/orders/SO-1042/customer"
            name="customer"
            inputValue="An Việt Trading"
            version="7"
          />
        ),
      },
    ],
  },
  {
    id: 'record-workspace',
    name: 'Record and workspace composition',
    description: 'Neutral record facts, activity and media compose inside the three canonical page patterns.',
    examples: [
      {
        id: 'record-display',
        name: 'Record facts and formatted values',
        description: 'Identity, status and locale-aware values remain small, reusable display primitives.',
        render: () => (
          <Stack
            items={[
              <Inline
                items={[
                  <Person name="Ngọc Linh" detail="Sales operations" />,
                  <AvatarGroup
                    label="Order collaborators"
                    people={[
                      { id: 'linh', name: 'Ngọc Linh' },
                      { id: 'minh', name: 'Minh Anh' },
                      { id: 'ha', name: 'Thu Hà' },
                      { id: 'nam', name: 'Hoàng Nam' },
                      { id: 'vy', name: 'Thảo Vy' },
                    ]}
                    max={4}
                  />,
                  <Status label="Ready" tone="positive" />,
                ]}
              />,
              <DescriptionList
                columns={3}
                items={[
                  { id: 'date', label: 'Delivery date', value: <FormattedDate value="2026-09-08" /> },
                  { id: 'quantity', label: 'Quantity', value: <FormattedNumber value={1200} /> },
                  {
                    id: 'total',
                    label: 'Total',
                    value: <FormattedMoney value={18450000} currency="VND" />,
                  },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'record-facts-fill',
        name: 'Record facts that fill the row',
        description:
          'columns="auto" fits 12rem columns to the list width, up to four, so lists of one width align.',
        render: () => (
          <Stack
            divided
            items={[
              <DescriptionList
                columns="auto"
                items={[
                  { id: 'arrival', label: 'Arrival', value: <FormattedDate value="2026-09-04" /> },
                  { id: 'departure', label: 'Departure', value: <FormattedDate value="2026-09-06" /> },
                  { id: 'nights', label: 'Nights', value: <FormattedNumber value={2} /> },
                  { id: 'guests', label: 'Guests', value: '2 adults' },
                  { id: 'rate', label: 'Rate plan', value: 'Flexible with breakfast' },
                  { id: 'source', label: 'Source', value: 'Direct' },
                ]}
              />,
              <DescriptionList
                columns="auto"
                items={[
                  { id: 'property', label: 'Property', value: 'Harbour View Resort' },
                  { id: 'room', label: 'Room', value: 'Not assigned' },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'record-composition',
        name: 'Record summary, actions and rail',
        description: 'One identity header and one neutral aside prevent nested-card drift.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Stack
                items={[
                  <RecordSummary
                    title="SO-1042"
                    subtitle="An Việt Trading"
                    person={{ name: 'Ngọc Linh', detail: 'Owner' }}
                    status={{ label: 'Ready', tone: 'positive' }}
                    facts={[
                      { id: 'date', label: 'Delivery', value: '08/09/2026' },
                      { id: 'total', label: 'Total', value: '18.450.000 ₫' },
                    ]}
                  />,
                  <RecordActions
                    actions={[
                      <Button label="Confirm" variant="primary" />,
                      <ActionMenu id="record-more" label="More" items={[]} />,
                    ]}
                  />,
                ]}
              />,
              <RecordRail
                sections={[
                  {
                    id: 'owner',
                    title: 'Owner',
                    body: <Person name="Ngọc Linh" detail="Sales operations" />,
                  },
                  { id: 'health', title: 'Health', body: <Status label="On track" tone="positive" /> },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'stage-path',
        name: 'Stage path',
        description:
          'Where one record stands in its process. Passed steps carry a check, the current one is filled, a closed outcome takes its tone; a narrow path folds to the current name.',
        render: () => (
          <Stack
            items={[
              <StagePath
                label="Sales path"
                completeLabel="completed"
                steps={[
                  { id: 'qualified', label: 'Qualified', state: 'complete', href: '#stage-path' },
                  { id: 'consulting', label: 'Consulting', state: 'complete', href: '#stage-path' },
                  { id: 'proposal', label: 'Proposal', state: 'current' },
                  { id: 'negotiation', label: 'Negotiation', state: 'upcoming', href: '#stage-path' },
                  { id: 'close', label: 'Close', state: 'upcoming', href: '#stage-path' },
                ]}
              />,
              <StagePath
                label="Closed sales path"
                completeLabel="completed"
                steps={[
                  { id: 'qualified', label: 'Qualified', state: 'complete' },
                  { id: 'proposal', label: 'Proposal', state: 'complete' },
                  { id: 'negotiation', label: 'Negotiation', state: 'upcoming' },
                  { id: 'lost', label: 'Lost', state: 'current', tone: 'danger' },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'activity-audit',
        name: 'Activity timeline and audit log',
        description:
          'Applications own permission, redaction and queries; renderers expose all result states.',
        render: () => {
          const activity = [
            {
              id: 'a1',
              actor: 'Ngọc Linh',
              action: 'moved the order to Ready',
              datetime: '2026-09-08T14:30:00+07:00',
              timeLabel: '14:30 today',
            },
            {
              id: 'a2',
              actor: 'System',
              action: 'synchronized a protected value',
              datetime: '2026-09-08T14:25:00+07:00',
              timeLabel: '14:25 today',
              redacted: true,
            },
          ]
          return (
            <Grid
              columns={2}
              items={[
                <ActivityTimeline label="Activity" items={activity} />,
                <AuditLog label="Audit log" items={activity} />,
              ]}
            />
          )
        },
      },
      {
        id: 'attachments-media',
        name: 'Attachments and media',
        description:
          'Storage URLs and mutations stay in the application; public components render authorized results.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Inline
                items={[
                  <Thumbnail alt="Product without a photo" size="small" />,
                  <Thumbnail alt="Product without a photo" />,
                  <Thumbnail
                    alt="Sample product illustration"
                    size="large"
                    fit="contain"
                    src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 fill=%22%23fff%22/%3E%3Ccircle cx=%2232%22 cy=%2237%22 r=%2220%22 fill=%22%23ec9a20%22/%3E%3Cpath d=%22M32 17Q33 5 46 9Q43 19 32 17%22 fill=%22%23387450%22/%3E%3C/svg%3E"
                  />,
                ]}
              />,
              <ContentCard
                title="Orange juice 1L, cold pressed"
                href="#catalogue-card"
                media={<Thumbnail alt="" />}
                mediaPlacement="start"
                summary="OJ-1L · Drinks · Bottle"
                meta={
                  <Inline
                    align="between"
                    items={[
                      <Text variant="headingLg" numeric>
                        45,000 ₫
                      </Text>,
                      <Badge label="Active" tone="positive" size="small" />,
                    ]}
                  />
                }
              />,
              <Attachments
                label="Order attachments"
                items={[
                  { id: 'invoice', name: 'invoice-SO-1042.pdf', href: '/files/invoice', meta: '238 KB' },
                  { id: 'contract', name: 'Restricted contract', redacted: true },
                ]}
              />,
              <MediaGallery
                label="Delivery media"
                items={[
                  { id: 'restricted', alt: '', redacted: true, caption: 'Permission required' },
                  {
                    id: 'proof',
                    alt: 'Delivery proof placeholder',
                    src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23eef0fb%22/%3E%3Cpath d=%22M80 220l70-80 50 50 50-70 80 100%22 fill=%22none%22 stroke=%22%23566fd1%22 stroke-width=%2212%22/%3E%3C/svg%3E',
                    caption: 'Delivery proof',
                  },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'canonical-recipes',
        name: 'Canonical page recipes',
        description:
          'Worklist, analytical list, settings and master-detail vary slots—not page-pattern count.',
        render: () => (
          <Grid
            columns={3}
            items={[
              <ContentCard title="ListPage" body="Worklist · analytical list · settings" />,
              <ContentCard title="RecordPage" body="Summary · facts · timeline · attachments" />,
              <ContentCard title="WorkspacePage" body="Master-detail · board · schedule · timeline canvas" />,
            ]}
          />
        ),
      },
      {
        id: 'canvas-recipes',
        name: 'Optional canvas recipes',
        description: 'Board, schedule and timeline keep spatial columns and local horizontal overflow.',
        render: () => (
          <div data-pattern="workspace" data-workspace-mode="canvas">
            <Grid
              columns={3}
              items={[
                <ContentCard title="Backlog" body="SO-1047 · SO-1048" />,
                <ContentCard title="In progress" body="SO-1042 · SO-1043" />,
                <ContentCard title="Done" body="SO-1039 · SO-1040" />,
              ]}
            />
          </div>
        ),
      },
    ],
  },
]
