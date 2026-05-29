/**
 * Phase 39 (2026-05-21) — unit tests for MetafieldValidationService.
 * Locks in per-type validation behaviour so a future "make it less
 * strict" change can't slip through silently.
 */

import { MetafieldValidationService } from './metafield-validation.service';

function makeService(repoOverrides: Partial<Record<string, unknown>> = {}) {
  const repo: any = {
    findDefinitions: jest.fn().mockResolvedValue([]),
    findProductMetafields: jest.fn().mockResolvedValue([]),
    getCategoryHierarchyIds: jest.fn().mockResolvedValue([]),
    ...repoOverrides,
  };
  return new MetafieldValidationService(repo);
}

describe('MetafieldValidationService.validateValue', () => {
  const service = makeService();

  it('passes blank values (treated as delete-value)', () => {
    const def: any = { id: '1', key: 'k', name: 'K', type: 'SINGLE_LINE_TEXT', isRequired: false, validations: null, choices: null };
    expect(service.validateValue(def, '')).toEqual({ ok: true });
    expect(service.validateValue(def, null)).toEqual({ ok: true });
    expect(service.validateValue(def, undefined)).toEqual({ ok: true });
  });

  it('rejects URLs that are not http/https', () => {
    const def: any = { id: '1', key: 'site', name: 'Site', type: 'URL', isRequired: false, validations: null, choices: null };
    const result = service.validateValue(def, 'javascript:alert(1)');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/http\(s\)/);
  });

  it('enforces text minLength/maxLength', () => {
    const def: any = { id: '1', key: 'k', name: 'K', type: 'SINGLE_LINE_TEXT', isRequired: false, validations: { minLength: 3, maxLength: 5 }, choices: null };
    expect(service.validateValue(def, 'ab').ok).toBe(false);
    expect(service.validateValue(def, 'abcdef').ok).toBe(false);
    expect(service.validateValue(def, 'abcd').ok).toBe(true);
  });

  it('enforces integer + min/max for NUMBER_INTEGER', () => {
    const def: any = { id: '1', key: 'q', name: 'Q', type: 'NUMBER_INTEGER', isRequired: false, validations: { min: 1, max: 5 }, choices: null };
    expect(service.validateValue(def, 1.5).ok).toBe(false);
    expect(service.validateValue(def, 0).ok).toBe(false);
    expect(service.validateValue(def, 6).ok).toBe(false);
    expect(service.validateValue(def, 3).ok).toBe(true);
  });

  it('enforces choice membership for SINGLE_SELECT', () => {
    const def: any = { id: '1', key: 'c', name: 'C', type: 'SINGLE_SELECT', isRequired: false, validations: null, choices: [{ value: 'red' }, { value: 'blue' }] };
    expect(service.validateValue(def, 'red').ok).toBe(true);
    expect(service.validateValue(def, 'green').ok).toBe(false);
  });

  it('enforces array shape + choice membership for MULTI_SELECT', () => {
    const def: any = { id: '1', key: 'c', name: 'C', type: 'MULTI_SELECT', isRequired: false, validations: null, choices: [{ value: 'a' }, { value: 'b' }] };
    expect(service.validateValue(def, ['a']).ok).toBe(true);
    expect(service.validateValue(def, ['a', 'b']).ok).toBe(true);
    expect(service.validateValue(def, ['a', 'z']).ok).toBe(false);
    expect(service.validateValue(def, 'a').ok).toBe(false);
  });

  it('enforces #RRGGBB hex for COLOR', () => {
    const def: any = { id: '1', key: 'c', name: 'C', type: 'COLOR', isRequired: false, validations: null, choices: null };
    expect(service.validateValue(def, '#ff0000').ok).toBe(true);
    expect(service.validateValue(def, 'red').ok).toBe(false);
    expect(service.validateValue(def, '#fff').ok).toBe(false);
  });

  it('rejects unknown definition types', () => {
    const def: any = { id: '1', key: 'k', name: 'K', type: 'NEW_FANCY_TYPE', isRequired: false, validations: null, choices: null };
    expect(service.validateValue(def, 'whatever').ok).toBe(false);
  });
});

describe('MetafieldValidationService.validateRequiredOnSubmit', () => {
  it('returns empty when categoryId is null', async () => {
    const service = makeService();
    const result = await service.validateRequiredOnSubmit('p1', null);
    expect(result).toEqual({ missing: [] });
  });

  it('lists missing required definitions', async () => {
    const service = makeService({
      getCategoryHierarchyIds: jest.fn().mockResolvedValue(['c1', 'c2']),
      findDefinitions: jest.fn().mockResolvedValue([
        { id: 'd1', key: 'material', name: 'Material' },
        { id: 'd2', key: 'season', name: 'Season' },
      ]),
      findProductMetafields: jest.fn().mockResolvedValue([
        { metafieldDefinitionId: 'd1' },
      ]),
    });
    const result = await service.validateRequiredOnSubmit('p1', 'c1');
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toEqual({ key: 'season', name: 'Season' });
  });

  it('returns empty when every required is satisfied', async () => {
    const service = makeService({
      getCategoryHierarchyIds: jest.fn().mockResolvedValue(['c1']),
      findDefinitions: jest.fn().mockResolvedValue([{ id: 'd1', key: 'x', name: 'X' }]),
      findProductMetafields: jest.fn().mockResolvedValue([{ metafieldDefinitionId: 'd1' }]),
    });
    const result = await service.validateRequiredOnSubmit('p1', 'c1');
    expect(result.missing).toEqual([]);
  });
});
