import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { html, renderIsland, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { KetGridIslandConfig } from '@ketvietlab/design-system'
import { islands as backendIslands } from '../../backend/islands.ts'
import { ketGridLocale } from '../../../ui/ket-grid-locale.ts'
import { emptyState, Notice, RecordForm, Section, shell, stack, WorkspacePage } from '../../../ui/index.ts'
import { OperatorSkillsHelp } from './operator-skills-help.tsx'
import type { Frame } from '../../../ui/index.ts'

/** One saved skill row: a person, a skill some work center needs, a level and the lead flag. */
export type OperatorSkillRow = { id: string; userId: string; skill: string; level: number; lead: boolean }

export type OperatorSkillsData = {
  rows: OperatorSkillRow[]
  /** The people a skill may be recorded for, by their own name. */
  people: Array<{ id: string; name: string }>
  /** The skills the work centers need, each with the centers that need it. */
  skills: Array<{ skill: string; centers: string[] }>
  /** Whether the reader may change the grid. */
  configure: boolean
}

export const SKILLS_FORM = 'manufacturing-operator-skills'

const skillsGrid = (_: Translator, data: OperatorSkillsData): KetGridIslandConfig => {
  // A saved row's person may have left the company; their name still reads.
  const known = new Map(data.people.map((person) => [person.id, person.name]))
  const people = [
    ...data.people,
    ...data.rows.filter((row) => !known.has(row.userId)).map((row) => ({ id: row.userId, name: row.userId })),
  ]
  return {
    label: _('manufacturing_backend.skills.title'),
    ...ketGridLocale(_.locale === 'en' ? 'en' : 'vi'),
    columns: [
      {
        key: 'userId',
        label: _('manufacturing_backend.skills.person'),
        type: 'select',
        editable: data.configure,
        required: true,
        // A saved row keeps its person and skill; changing either is a new row.
        lockedBy: 'saved',
        options: people.map((person) => ({ value: person.id, label: person.name })),
        width: 220,
        grow: 1,
      },
      {
        key: 'skill',
        label: _('manufacturing_backend.skills.skill'),
        type: 'select',
        editable: data.configure,
        required: true,
        lockedBy: 'saved',
        options: data.skills.map((entry) => ({
          value: entry.skill,
          label: `${entry.skill} · ${entry.centers.join(', ')}`,
        })),
        width: 220,
        grow: 1,
      },
      {
        key: 'level',
        label: _('manufacturing_backend.skills.level'),
        type: 'number',
        editable: data.configure,
        required: true,
        min: 0,
        max: 5,
        width: 96,
      },
      {
        key: 'lead',
        label: _('manufacturing_backend.skills.lead'),
        type: 'checkbox',
        editable: data.configure,
        width: 120,
      },
    ],
    rows: data.rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      skill: row.skill,
      level: row.level,
      lead: row.lead,
      saved: true,
    })),
    name: 'skills',
    form: SKILLS_FORM,
    visibleRows: 12,
    ...(data.configure
      ? { newRow: { userId: '', skill: '', level: 2, lead: false, saved: false }, removable: true }
      : { readOnly: true }),
  }
}

/**
 * Who does which work center skill, and how well (#1931): 2 is enough to be given the work, and a
 * lead takes it only when no worker of the same level is freer. Behind the settings gear, beside
 * the work centers that name the skills.
 */
export const operatorSkillsScreen = (
  _: Translator,
  frame: Frame,
  data: OperatorSkillsData,
  action: string,
  errors: string[] = [],
  saved = false,
): TemplateResult =>
  shell(
    _,
    _('manufacturing_backend.skills.title'),
    <WorkspacePage
      variant="operational"
      frame={frame}
      title={_('manufacturing_backend.skills.title')}
      body={stack([
        <OperatorSkillsHelp lang={_.locale === 'en' ? 'en' : 'vi'} />,
        <Section
          title={_('manufacturing_backend.skills.grid')}
          body={stack([
            errors.length ? (
              <Notice
                tone="danger"
                title={_('manufacturing_backend.error.invalid')}
                message={errors.join(' ')}
              />
            ) : null,
            saved && !errors.length ? (
              <Notice
                tone="positive"
                title={_('manufacturing_backend.skills.saved')}
                message={_('manufacturing_backend.skills.savedHelp')}
              />
            ) : null,
            data.skills.length ? (
              <Notice
                tone="info"
                title={_('manufacturing_backend.skills.levels')}
                message={_('manufacturing_backend.skills.levelsHelp')}
              />
            ) : null,
            data.skills.length
              ? html`${trustedMarkup(
                  renderIsland(
                    'backend.ket-grid',
                    (props) => backendIslands['backend.ket-grid'].view!(props as never),
                    { id: 'manufacturing-operator-skills-grid', config: skillsGrid(_, data) },
                  ),
                )}`
              : emptyState(
                  _('manufacturing_backend.skills.noSkills'),
                  _('manufacturing_backend.skills.noSkillsHelp'),
                ),
            data.configure && data.skills.length ? (
              <RecordForm
                id={SKILLS_FORM}
                action={action}
                hidden={{ action: 'save' }}
                fields={[]}
                submit={_('manufacturing_backend.skills.save')}
                submitVariant="primary"
              />
            ) : null,
          ])}
        />,
      ])}
    />,
    { ...frame, titled: false, topbar: false },
  )
