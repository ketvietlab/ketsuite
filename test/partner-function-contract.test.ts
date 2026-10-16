import assert from 'node:assert/strict'
import { test } from 'node:test'
import { functions } from '../packages/ketsuite/src/modules/partner/functions/index.ts'

test('partner functions: split registry preserves all fourteen inputs, effects and permissions', () => {
  const expected = {
    listPartners: {
      input: {
        role: 'text?',
        kind: 'text?',
        search: 'text?',
        ids: 'json?',
        includeArchived: 'bool?',
        sortField: 'text?',
        sortDirection: 'text?',
        limit: 'int?',
        offset: 'int?',
        groupBy: 'json?',
        groupPath: 'json?',
      },
      output: {
        id: 'id',
        kind: 'text',
        name: 'text',
        ref: 'text?',
        email: 'text?',
        phone: 'text?',
        contactConsent: 'bool?',
        active: 'bool',
      },
      effects: ['read:partner.Partner', 'read:partner.Role'],
      agent: true,
    },
    countPartners: {
      input: {
        role: 'text?',
        kind: 'text?',
        search: 'text?',
        includeArchived: 'bool?',
      },
      output: {
        count: 'int',
      },
      effects: ['read:partner.Partner', 'read:partner.Role'],
    },
    getPartner: {
      input: {
        id: 'id',
      },
      output: {
        id: 'id',
        kind: 'text',
        name: 'text',
        parentId: 'id?',
        vat: 'text?',
        ref: 'text?',
        email: 'text?',
        phone: 'text?',
        contactConsent: 'bool?',
        lang: 'text?',
        active: 'bool',
        addresses: 'json?',
        roles: 'json?',
      },
      effects: [
        'read:partner.Partner',
        'read:partner.Address',
        'read:partner.AddressDefault',
        'read:partner.Role',
        'read:address.Country',
        'read:address.CurrentCatalog',
        'read:address.Division',
      ],
      agent: true,
    },
    listAddresses: {
      input: {
        partnerId: 'id',
        use: 'text?',
      },
      output: {
        id: 'id',
        partnerId: 'id',
        use: 'text',
        street1: 'text',
        street2: 'text?',
        locality: 'text?',
        postalCode: 'text?',
        countryCode: 'text',
        countryId: 'id?',
        divisionId: 'id?',
        divisionText: 'text?',
        oneLine: 'text',
        isDefault: 'bool',
      },
      effects: [
        'read:partner.Address',
        'read:partner.AddressDefault',
        'read:address.Country',
        'read:address.CurrentCatalog',
        'read:address.Division',
      ],
      agent: true,
    },
    savePartner: {
      input: {
        id: 'id',
        kind: 'text',
        name: 'text',
        parentId: 'id?',
        vat: 'text?',
        ref: 'text?',
        email: 'text?',
        phone: 'text?',
        contactConsent: 'bool?',
        lang: 'text?',
      },
      output: {
        ok: 'bool',
        id: 'id?',
        errors: 'json?',
      },
      effects: ['read:partner.Partner', 'write:partner.Partner'],
      idempotent: true,
      agent: true,
    },
    normalizePartnerPhones: {
      input: {
        after: 'text?',
        limit: 'int?',
      },
      output: {
        scanned: 'int',
        changed: 'int',
        next: 'text?',
      },
      effects: ['read:partner.Partner', 'write:partner.Partner'],
      idempotent: true,
    },
    archivePartner: {
      input: {
        id: 'id',
        active: 'bool',
      },
      output: {
        id: 'id',
        active: 'bool',
      },
      effects: ['write:partner.Partner'],
      idempotent: true,
      agent: true,
    },
    archivePartners: {
      input: {
        ids: 'json',
        active: 'bool',
      },
      output: {
        ok: 'bool',
        updated: 'int?',
        errors: 'json?',
      },
      effects: ['read:partner.Partner', 'write:partner.Partner'],
      idempotent: true,
      agent: true,
    },
    saveAddress: {
      input: {
        id: 'id',
        partnerId: 'id',
        use: 'text',
        street: 'text?',
        street1: 'text?',
        street2: 'text?',
        city: 'text?',
        locality: 'text?',
        zip: 'text?',
        postalCode: 'text?',
        state: 'text?',
        divisionText: 'text?',
        country: 'text?',
        countryCode: 'text?',
        countryId: 'id?',
        divisionId: 'id?',
        isDefault: 'bool?',
      },
      output: {
        ok: 'bool',
        id: 'id?',
        errors: 'json?',
      },
      effects: [
        'read:partner.Partner',
        'read:partner.Address',
        'read:partner.AddressDefault',
        'write:partner.Address',
        'write:partner.AddressDefault',
        'read:address.Country',
        'read:address.CurrentCatalog',
        'read:address.Division',
      ],
      idempotent: true,
      agent: true,
    },
    snapshotAddress: {
      input: {
        id: 'id',
      },
      output: {
        ok: 'bool',
        snapshot: 'json?',
        errors: 'json?',
      },
      effects: [
        'read:partner.Address',
        'read:address.Country',
        'read:address.CurrentCatalog',
        'read:address.Division',
      ],
      agent: true,
    },
    grantRole: {
      input: {
        id: 'id',
        partnerId: 'id',
        role: 'text',
      },
      output: {
        ok: 'bool',
        id: 'id?',
        errors: 'json?',
      },
      effects: ['read:partner.Partner', 'read:partner.Role', 'write:partner.Role'],
      idempotent: true,
      agent: true,
    },
    revokeRole: {
      input: {
        partnerId: 'id',
        role: 'text',
      },
      output: {
        ok: 'bool',
        removed: 'int',
      },
      effects: ['read:partner.Role', 'write:partner.Role'],
      idempotent: true,
      agent: true,
    },
    saveTerms: {
      input: {
        id: 'id',
        partnerId: 'id',
        creditLimit: 'decimal?',
        note: 'text?',
      },
      output: {
        ok: 'bool',
        id: 'id?',
        errors: 'json?',
      },
      effects: ['read:partner.Partner', 'read:partner.CompanyTerms', 'write:partner.CompanyTerms'],
      idempotent: true,
      agent: true,
    },
    getTerms: {
      input: {
        partnerId: 'id',
      },
      output: {
        id: 'id',
        partnerId: 'id',
        creditLimit: 'decimal?',
        note: 'text?',
      },
      effects: ['read:partner.CompanyTerms'],
      agent: true,
    },
  }
  const actual = Object.fromEntries(
    Object.entries(functions).map(([key, { handler: _handler, ...contract }]) => [key, contract]),
  )
  assert.deepEqual(actual, expected)
})
