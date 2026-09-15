import { getOwner, getOwnerId } from './getOwner';

import { Response } from 'express';

const mockResponse = (owner: unknown): Response<any, Record<string, any>> => {
  const res: Partial<Response<any, Record<string, any>>> = {};
  res.status = jest.fn().mockReturnValue(res) as Response<
    any,
    Record<string, any>
  >['status'];
  res.json = jest.fn().mockReturnValue(res) as Response<
    any,
    Record<string, any>
  >['json'];
  res.locals = { owner };
  return res as Response<any, Record<string, any>>;
};

describe('getOwner', () => {
  test('returns the owner from the response', () => {
    const result = getOwner(mockResponse(1));
    expect(result).toEqual(1);
  });

  test('throws an error if the owner is not set', () => {
    expect(getOwner()).toBe(undefined);
  });
});

describe('getOwnerId', () => {
  test('returns the numeric owner id', () => {
    expect(getOwnerId(mockResponse(42))).toBe(42);
  });

  test('preserves a zero owner id instead of collapsing it to null', () => {
    expect(getOwnerId(mockResponse(0))).toBe(0);
  });

  test('parses a stringified owner id', () => {
    expect(getOwnerId(mockResponse('7'))).toBe(7);
  });

  test('returns null when no owner is present', () => {
    expect(getOwnerId()).toBeNull();
    expect(getOwnerId(mockResponse(undefined))).toBeNull();
  });

  test('returns null for a non-numeric owner', () => {
    expect(getOwnerId(mockResponse('not-a-number'))).toBeNull();
  });
});
