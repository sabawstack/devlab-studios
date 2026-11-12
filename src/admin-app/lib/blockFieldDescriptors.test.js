import { describe, expect, it } from 'vitest'
import { BLOCK_FIELDS, BLOCK_LABELS, createEmptyBlockProps } from './blockFieldDescriptors'
import { PAGE_BLOCK_TYPES } from '../../lib/schemas/blocks'
import { SCENE_IDS } from '../../config/scenes'
import { INQUIRY_TYPES } from '../../lib/schemas/inquiry'

// The admin form for a block is generated from these descriptors, so a block
// type the schema accepts but the admin cannot describe could never be added.
const OWN_EDITOR = new Set(['workProjectShowcase']) // edited in WorkPageManager

describe('block field descriptors', () => {
  it.each(PAGE_BLOCK_TYPES.filter((type) => !OWN_EDITOR.has(type)))('%s has a label and fields', (type) => {
    expect(BLOCK_LABELS[type]).toBeTruthy()
    expect(BLOCK_FIELDS[type]?.length).toBeGreaterThan(0)
  })

  it('the scene select offers exactly the registered scenes', () => {
    const field = BLOCK_FIELDS.scene.find((entry) => entry.name === 'sceneId')
    expect(field.options.map((option) => option.value)).toEqual(SCENE_IDS)
  })

  it('a new scene block starts on a registered scene', () => {
    expect(SCENE_IDS).toContain(createEmptyBlockProps('scene').sceneId)
  })

  it('the CTA inquiry-type select only offers known types', () => {
    const field = BLOCK_FIELDS.cta.find((entry) => entry.name === 'inquiryType')
    for (const option of field.options) {
      if (option.value) expect(INQUIRY_TYPES).toContain(option.value)
    }
    expect(field.options.map((option) => option.value)).toContain('operations_care')
  })
})
