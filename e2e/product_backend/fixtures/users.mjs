// Shared by the seed and the specs: the password every seeded person signs in with, and
// where the server listens.
export const PORT = Number(process.env.E2E_PORT ?? 4173)
export const PASSWORD = 'product-e2e-pass'
