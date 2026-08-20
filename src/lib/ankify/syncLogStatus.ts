export function syncLogStatus(result: {
  created: number;
  updated: number;
  errors: unknown[];
}): 'success' | 'partial' | 'error' {
  if (result.errors.length === 0) {
    return 'success';
  }
  if (result.created + result.updated > 0) {
    return 'partial';
  }
  return 'error';
}
