import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const OPS_ROUTER = join(__dirname, '../../../../src/routes/OpsRouter.ts');

const POST_OPS_ROUTE = /router\.post\(\s*['"]([^'"]+)['"]/g;

function postOpsRoutes(): string[] {
  const source = readFileSync(OPS_ROUTER, 'utf8');
  const paths = Array.from(
    source.matchAll(POST_OPS_ROUTE),
    (match) => match[1]
  );
  return paths.filter((path) => path.startsWith('/api/ops/'));
}

function opsClientSource(): string {
  const entries = readdirSync(__dirname, { recursive: true }) as string[];
  return entries
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => readFileSync(join(__dirname, name), 'utf8'))
    .join('\n');
}

describe('every POST /api/ops route in OpsRouter has an OpsPage client trigger', () => {
  const routes = postOpsRoutes();
  const clientSource = opsClientSource();

  it('extraction reads router.post("/api/ops/…") paths from OpsRouter source text', () => {
    expect(routes).toContain('/api/ops/send-pass-winback');
    expect(routes).toContain('/api/ops/delete-inactive-users');
    expect(routes.length).toBeGreaterThanOrEqual(8);
  });

  it.each(routes)(
    'POST %s appears as a fetch URL in a non-test web/src/pages/OpsPage module',
    (route) => {
      expect(clientSource).toContain(route);
    }
  );
});
