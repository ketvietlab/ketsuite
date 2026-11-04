import assert from 'node:assert/strict'
import { test } from 'node:test'
import { presetCover, themePresets } from '../packages/website-client/client/theme/presets.ts'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

/**
 * Every bundled preset's card in the Studio shows a picture. The cosmetics cover lives one folder
 * down, which the single-segment theme route never matched, so its card showed a broken image.
 */
test('Studio themes: every preset cover the theme cards link resolves to an SVG', async (t) => {
  const { app } = await bootWebsiteStudio()
  t.after(() => app.close())
  const designer = app.client.anonymous()
  await designer.login({ login: 'studio-designer', password: 'studio-local' })
  for (const preset of themePresets) {
    const cover = presetCover(preset)
    // The test client follows the theme route's redirect to the bundled asset.
    const image = await designer.get(cover)
    assert.equal(image.status, 200, `${preset}: ${cover}`)
    assert.match(image.headers.get('content-type') ?? '', /svg/, preset)
    assert.match(await image.text(), /<svg/, preset)
  }
})
