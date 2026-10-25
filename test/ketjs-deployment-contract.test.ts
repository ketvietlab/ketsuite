import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose } from '@ketvietlab/ketjs'
import type { DeploymentSpec } from '@ketvietlab/ketjs'
import {
  createCommerceDeployment,
  createHospitalityDeployment,
  createKetsuiteDeployment,
  createOfficeDeployment,
} from '../packages/ketsuite/src/deployment.ts'

// KetJS 0.6 refuses at boot what 0.5 let through: a company model in a deployment
// that does not scope by company, and a signed-in session without a permission
// policy. It warns, until 1.0 refuses, about a function whose effects reach a
// module outside its depends and optional lists. This test composes each packaged
// deployment exactly as `bootRuntime` does, so a branch that adds such a module,
// session or function fails here, in a second and without a database, instead of
// at its first boot.

const deployments: Record<string, () => DeploymentSpec> = {
  ketsuite: createKetsuiteDeployment,
  commerce: createCommerceDeployment,
  hospitality: createHospitalityDeployment,
  office: createOfficeDeployment,
}

const bootManifest = (spec: DeploymentSpec) =>
  compose([...spec.modules, ...(spec.theme ? [spec.theme] : []), ...(spec.themes ?? [])], {
    requiredRegions: spec.requires ?? [],
    headless: spec.headless ?? false,
    companies: spec.companies === true,
    requirePermissionCoverage: spec.permissions?.requireCoverage,
    modulePermissionDeclarations: spec.permissions?.modules,
    roleTemplates: spec.permissions?.roleTemplates,
  })

for (const [name, create] of Object.entries(deployments)) {
  test(`${name}: composes on KetJS 0.6 with company scope and no contract warning`, () => {
    const spec = create()
    assert.equal(
      spec.companies,
      true,
      `${name} must declare companies: true; every KetSuite row has a company`,
    )
    if (spec.serve?.sessions)
      assert.ok(spec.serve.permissions, `${name} signs users in, so it needs serve.permissions`)
    const manifest = bootManifest(spec)
    assert.equal(manifest.companies, true)
    // Each warning names its function, the model it touches and the module to add to
    // `depends`, or to `optional` when the integration is soft.
    assert.deepEqual(
      (manifest.diagnostics ?? []).map((finding) => `${finding.code}: ${finding.message}`),
      [],
    )
  })
}
