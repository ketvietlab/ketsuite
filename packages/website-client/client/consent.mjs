// A visitor's answer to the site's tracking notice, kept in a first-party cookie.
// The answer names the notice version it was given to: a new wording asks again.

export const CONSENT_COOKIE = 'kv_visit_consent'
/** How long an answer is remembered before the visitor is asked again. */
const ANSWER_DAYS = 180

/**
 * @param {Document} doc
 * @param {number | string} version
 * @returns {'yes' | 'no' | null}
 */
export function readConsent(doc, version) {
  const entry = String(doc.cookie || '')
    .split(/;\s*/)
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`))
  if (!entry) return null
  let value = ''
  try {
    value = decodeURIComponent(entry.slice(CONSENT_COOKIE.length + 1))
  } catch {
    return null
  }
  const [given, answer] = value.split(':')
  if (Number(given) !== Number(version)) return null
  return answer === 'yes' || answer === 'no' ? answer : null
}

/**
 * @param {Document} doc
 * @param {number | string} version
 * @param {'yes' | 'no'} answer
 */
export function writeConsent(doc, version, answer) {
  const secure = doc.defaultView?.location?.protocol === 'https:' ? '; Secure' : ''
  doc.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(`${version}:${answer}`)}; Path=/; Max-Age=${
    ANSWER_DAYS * 24 * 60 * 60
  }; SameSite=Lax${secure}`
}
