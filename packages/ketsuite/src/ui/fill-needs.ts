// What a fill needs the viewer to be allowed to call.
//
// A fill is one template for every viewer of a tenant: KetJS compiles it once and
// hands it the joint's props, nothing about who is looking. A fill that shows a
// person something they may not read (their unread count, a record's chatter)
// would show them only a refusal, and a request the server turned down. So the
// fill names what it needs in its own condition,
// `{% if may.mail.countUnread %}…{% endif %}`, and whoever places the joint
// answers for this viewer: the shell on a server page (`jointFor`), the record's
// context function on a client page (`recordIslandsFor`). Only the functions a
// joint's fills name are asked about.

const NAMED = /\bmay\.([a-z][a-z0-9_]*)\.([a-zA-Z][a-zA-Z0-9]*)\b/gu

/** The function keys a fill template names in `may.<module>.<function>` conditions. */
export const functionsNamedBy = (template: string): string[] => [
  ...new Set([...template.matchAll(NAMED)].map((match) => `${match[1]}.${match[2]}`)),
]

/**
 * The `may` prop of a joint, `{ mail: { countUnread: true } }`: for each function
 * its fills name, whether this viewer may call it.
 */
export const mayFor = async (
  fills: ReadonlyArray<{ joint: string; template: string }>,
  joint: string,
  allows: (name: string) => boolean | Promise<boolean>,
): Promise<Record<string, Record<string, boolean>>> => {
  const names = [
    ...new Set(
      fills.filter((fill) => fill.joint === joint).flatMap((fill) => functionsNamedBy(fill.template)),
    ),
  ]
  const answers = await Promise.all(names.map((name) => allows(name)))
  const may: Record<string, Record<string, boolean>> = {}
  names.forEach((name, index) => {
    const [module = '', fn = ''] = name.split('.')
    may[module] = { ...may[module], [fn]: answers[index] === true }
  })
  return may
}
