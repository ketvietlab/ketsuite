import type { CatalogueSource } from './source.ts'

export const permissions = {
  posture: 'permission-bearing',
  bundles: ['author', 'configure', 'operate', 'project-access', 'project-delete', 'view'],
  functions: {
    'board.remember': ['operate', 'operate'],
    'board.scope': ['read', 'view'],
    'column.archive': ['configure', 'configure', 'flow.configuration-audit'],
    'column.list': ['read', 'view'],
    'column.save': ['configure', 'configure', 'flow.configuration-audit'],
    'epic.archive': ['operate', 'operate'],
    'epic.editContent': ['operate', 'author'],
    'epic.get': ['read', 'view'],
    'epic.list': ['read', 'view'],
    'epic.listAll': ['read', 'view'],
    'epic.save': ['operate', 'operate'],
    'field.archive': ['configure', 'configure', 'flow.configuration-audit'],
    'field.list': ['read', 'view'],
    'field.save': ['configure', 'configure', 'flow.configuration-audit'],
    // Taking work out of every figure the project reports, and putting it
    // back. Ordinary work rather than configuration: cancelling your own task
    // is not a decision about how the project is run.
    'issue.archive': ['operate', 'operate'],
    'issue.restore': ['operate', 'operate'],
    'issue.assignSprint': ['operate', 'operate'],
    'issue.bulk': ['operate', 'operate'],
    'issue.copyTo': ['operate', 'operate'],
    'issue.transfer': ['operate', 'operate'],
    'issue.buckets': ['read', 'view'],
    'issue.comment': ['operate', 'operate'],
    'issue.dependencies': ['read', 'view'],
    'issue.dependency.add': ['operate', 'operate'],
    'issue.dependency.remove': ['operate', 'operate'],
    'issue.editDescription': ['operate', 'author'],
    'issue.get': ['read', 'view'],
    'issue.group': ['read', 'view'],
    'issue.list': ['read', 'view'],
    'issue.move': ['operate', 'operate'],
    'issue.options': ['read', 'view'],
    'issue.save': ['operate', 'operate'],
    'issue.follow': ['operate', 'operate'],
    'issue.unfollow': ['operate', 'operate'],
    'issueType.archive': ['configure', 'configure', 'flow.configuration-audit'],
    'issueType.list': ['read', 'view'],
    'issueType.save': ['configure', 'configure', 'flow.configuration-audit'],
    'page.archive': ['operate', 'operate'],
    'page.editContent': ['operate', 'author'],
    'page.get': ['read', 'view'],
    'page.list': ['read', 'view'],
    'page.listAll': ['read', 'view'],
    // Re-parenting moves a whole branch of the wiki, not one record.
    'page.move': ['configure', 'configure', 'flow.domain-policy'],
    'page.reorder': ['operate', 'operate'],
    'page.restore': ['operate', 'operate'],
    'page.save': ['operate', 'operate'],
    // The widest reach Flow grants: reading every project regardless of who
    // was added to it. Its own capability, so nobody holds it by holding
    // something else, and a policy authority because it is the answer to
    // "who can see the project we hid".
    'project.access.grant': ['security', 'project-access', 'flow.domain-policy'],
    'project.count': ['read', 'view'],
    'project.access.list': ['sensitive', 'project-access', 'flow.domain-policy'],
    'project.access.revoke': ['security', 'project-access', 'flow.domain-policy'],
    // Ending a project is not configuring one. Its own capability so that a
    // role which reshapes boards every week cannot destroy one by accident,
    // and its own policy authority because the act does not come back.
    'project.delete': ['security', 'project-delete', 'flow.domain-policy'],
    'project.deletion.list': ['sensitive', 'project-delete', 'flow.domain-policy'],
    'project.editContent': ['operate', 'author'],
    'project.get': ['read', 'view'],
    'project.list': ['read', 'view'],
    // Who is on a project decides what they may read, which is a decision
    // about the project rather than a day of work in it.
    'project.member.add': ['configure', 'configure', 'flow.configuration-audit'],
    'project.member.list': ['read', 'view'],
    'project.member.remove': ['configure', 'configure', 'flow.configuration-audit'],
    'project.save': ['configure', 'configure', 'flow.configuration-audit'],
    'project.stats': ['read', 'view'],
    'sprint.close': ['operate', 'operate'],
    'sprint.delete': ['operate', 'operate'],
    'sprint.list': ['read', 'view'],
    'sprint.save': ['operate', 'operate'],
    'sprint.start': ['operate', 'operate'],
    // Archiving a tag removes it from every issue in every project of the
    // company and cannot be undone — a wider reach than the rest of `configure`.
    'tag.archive': ['configure', 'configure', 'flow.configuration-audit'],
    'tag.list': ['read', 'view'],
    'tag.save': ['configure', 'configure', 'flow.configuration-audit'],
  },
  exemptions: {},
} satisfies CatalogueSource
