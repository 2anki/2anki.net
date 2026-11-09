import express from 'express';

import { fieldSizeForPlan } from './uploadFieldsByPlan';
import { getUploadLimits } from '../../lib/misc/getUploadLimits';

const withLocals = (locals: Record<string, unknown>) =>
  ({ locals }) as unknown as express.Response;

describe('fieldSizeForPlan', () => {
  it.each([
    ['a signed-out caller', {}, false],
    ['a free signed-in caller', { owner: 42 }, false],
    ['a subscriber', { owner: 42, subscriber: true }, true],
    ['a lifetime member', { owner: 42, patreon: true }, true],
  ])('gives %s the file upload field limit', (_who, locals, paying) => {
    expect(fieldSizeForPlan(withLocals(locals))).toBe(
      getUploadLimits(paying).fieldSize
    );
  });
});
