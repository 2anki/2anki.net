import fs from 'fs';
import path from 'path';
import { swaggerSpec } from './swagger';

// Define proper types for Swagger spec
interface SwaggerSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, any>>;
  components: {
    schemas: Record<string, any>;
    securitySchemes: Record<string, any>;
  };
}

describe('Swagger Documentation Coverage', () => {
  const routesDir = path.join(__dirname, '../routes');

  // Extract all route definitions from route files
  const extractRouteDefinitions = (): Array<{
    file: string;
    method: string;
    path: string;
    line: number;
  }> => {
    const routes: Array<{
      file: string;
      method: string;
      path: string;
      line: number;
    }> = [];
    const routeFiles = fs
      .readdirSync(routesDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));

    routeFiles.forEach((file) => {
      const filePath = path.join(routesDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Match router method calls: router.get(), router.post(), etc.
        const routeMatch = line.match(
          /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/
        );
        if (routeMatch) {
          const [, method, routePath] = routeMatch;

          // Skip middleware-only routes and Swagger documentation routes
          if (
            !routePath.includes('/api/docs') &&
            !routePath.includes('swagger') &&
            !line.includes('swaggerUi.serve') &&
            !line.includes('swaggerUi.setup')
          ) {
            routes.push({
              file,
              method: method.toUpperCase(),
              path: routePath,
              line: index + 1,
            });
          }
        }
      });
    });

    return routes;
  };

  // Extract documented paths from Swagger spec
  const extractSwaggerPaths = (): Set<string> => {
    const documentedPaths = new Set<string>();
    const spec = swaggerSpec as SwaggerSpec;

    if (spec.paths) {
      Object.keys(spec.paths).forEach((path) => {
        const pathItem = spec.paths[path];
        Object.keys(pathItem).forEach((method) => {
          // Convert Swagger path format {id} to Express format :id
          const expressPath = path.replace(/\{([^}]+)\}/g, ':$1');
          documentedPaths.add(`${method.toUpperCase()} ${expressPath}`);
        });
      });
    }

    return documentedPaths;
  };

  // Check if a route has Swagger documentation in the file
  const hasSwaggerDocInFile = (
    filePath: string,
    routePath: string,
    method: string
  ): boolean => {
    const content = fs.readFileSync(path.join(routesDir, filePath), 'utf-8');

    // Convert Express path format to Swagger format for better matching
    const swaggerPath = routePath.replace(/:([^/]+)/g, '{$1}');

    // Handle wildcard patterns in routes (e.g., /patr*on)
    const wildcardPath = routePath.replace(/\*/g, '.*');

    // Look for @swagger comment followed by the path and method
    // Try multiple path format variations
    const patterns = [
      // Original Express format
      new RegExp(
        `@swagger[\\s\\S]*?${escapeRegex(routePath)}:[\\s\\S]*?${method.toLowerCase()}:`,
        'i'
      ),
      // Swagger format with curly braces
      new RegExp(
        `@swagger[\\s\\S]*?${escapeRegex(swaggerPath)}:[\\s\\S]*?${method.toLowerCase()}:`,
        'i'
      ),
      // Handle wildcard patterns like /patr*on -> /patreon
      new RegExp(
        `@swagger[\\s\\S]*?${escapeRegex(routePath.replace(/\*/g, ''))}[^/]*:[\\s\\S]*?${method.toLowerCase()}:`,
        'i'
      ),
      // Handle patterns with trailing slashes
      new RegExp(
        `@swagger[\\s\\S]*?${escapeRegex(routePath.replace(/\/$/, ''))}/?:[\\s\\S]*?${method.toLowerCase()}:`,
        'i'
      ),
      new RegExp(
        `@swagger[\\s\\S]*?${escapeRegex(swaggerPath.replace(/\/$/, ''))}/?:[\\s\\S]*?${method.toLowerCase()}:`,
        'i'
      ),
    ];

    return patterns.some((pattern) => pattern.test(content));
  };

  const escapeRegex = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  it('should have Swagger documentation for all endpoints', () => {
    const routes = extractRouteDefinitions();
    const documentedPaths = extractSwaggerPaths();
    const undocumentedRoutes: Array<{
      file: string;
      method: string;
      path: string;
      line: number;
    }> = [];

    console.log('\n=== Swagger Documentation Coverage Report ===');
    console.log(`Found ${routes.length} route endpoints`);
    console.log(
      `Found ${documentedPaths.size} documented paths in Swagger spec`
    );

    routes.forEach((route) => {
      const routeKey = `${route.method} ${route.path}`;
      const swaggerPath = route.path.replace(/:([^/]+)/g, '{$1}');
      const swaggerKey = `${route.method} ${swaggerPath}`;

      // Check if documented in Swagger spec or has inline documentation
      const isDocumentedInSpec = documentedPaths.has(swaggerKey);
      const hasInlineDoc = hasSwaggerDocInFile(
        route.file,
        route.path,
        route.method
      );

      if (!isDocumentedInSpec && !hasInlineDoc) {
        undocumentedRoutes.push(route);
        console.log(`❌ MISSING: ${routeKey} (${route.file}:${route.line})`);
      } else {
        console.log(`✅ DOCUMENTED: ${routeKey}`);
      }
    });

    if (undocumentedRoutes.length > 0) {
      console.log(
        `\n🚨 Found ${undocumentedRoutes.length} undocumented endpoints:`
      );
      undocumentedRoutes.forEach((route) => {
        console.log(
          `   - ${route.method} ${route.path} in ${route.file}:${route.line}`
        );
      });
      console.log('\nPlease add Swagger documentation for these endpoints.');
      console.log('Example format:');
      console.log('/**');
      console.log(' * @swagger');
      console.log(' * /api/example/{id}:');
      console.log(' *   get:');
      console.log(' *     summary: Example endpoint');
      console.log(' *     description: Description of what this endpoint does');
      console.log(' *     tags: [Tag]');
      console.log(' *     parameters:');
      console.log(' *       - in: path');
      console.log(' *         name: id');
      console.log(' *         required: true');
      console.log(' *         schema:');
      console.log(' *           type: string');
      console.log(' *     responses:');
      console.log(' *       200:');
      console.log(' *         description: Success');
      console.log(' */');
    }

    // The test fails if there are undocumented routes
    expect(undocumentedRoutes).toHaveLength(0);
  });

  it('should have valid Swagger specification', () => {
    const spec = swaggerSpec as SwaggerSpec;
    expect(spec).toBeDefined();
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe('2anki Server API');
    expect(spec.paths).toBeDefined();
  });

  it('should have proper API documentation structure', () => {
    const spec = swaggerSpec as SwaggerSpec;
    // Ensure we have the basic components defined
    expect(spec.components).toBeDefined();
    expect(spec.components.schemas).toBeDefined();
    expect(spec.components.securitySchemes).toBeDefined();

    // Check that essential schemas are defined
    const requiredSchemas = ['Error', 'Success', 'User', 'Upload'];
    requiredSchemas.forEach((schema) => {
      expect(spec.components.schemas[schema]).toBeDefined();
    });

    // Check that security schemes are properly defined
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.cookieAuth).toBeDefined();
  });

  describe('chat endpoint contract documentation', () => {
    const spec = swaggerSpec as SwaggerSpec;

    it('documents /api/chat/message as a Server-Sent Events stream', () => {
      const op = spec.paths['/api/chat/message']?.post;
      expect(op).toBeDefined();
      const ok = op.responses['200'];
      expect(ok).toBeDefined();
      expect(ok.content).toHaveProperty('text/event-stream');
    });

    it('documents /api/chat/conversations/{id}/regenerate as a Server-Sent Events stream', () => {
      const op = spec.paths['/api/chat/conversations/{id}/regenerate']?.post;
      expect(op).toBeDefined();
      const ok = op.responses['200'];
      expect(ok).toBeDefined();
      expect(ok.content).toHaveProperty('text/event-stream');
      const props =
        op.requestBody.content['application/json'].schema.properties;
      expect(props.templateSlug).toBeDefined();
    });

    it('documents templateSlug and multipart files for /api/chat/message', () => {
      const op = spec.paths['/api/chat/message']?.post;
      const jsonProps =
        op.requestBody.content['application/json'].schema.properties;
      expect(jsonProps.templateSlug).toBeDefined();
      const multipart = op.requestBody.content['multipart/form-data'];
      expect(multipart).toBeDefined();
      expect(multipart.schema.properties.files).toBeDefined();
    });

    it('documents the expanded attachment MIME types for /api/chat/message', () => {
      const op = spec.paths['/api/chat/message']?.post;
      const filesDescription =
        op.requestBody.content['multipart/form-data'].schema.properties.files
          .description;
      expect(filesDescription).toContain('application/zip');
      expect(filesDescription).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      expect(filesDescription).toContain('text/markdown');
      expect(filesDescription).toContain('text/plain');
    });

    it('exposes ChatBasicCard, ChatMcqCard, and the three SSE frame schemas', () => {
      const schemas = spec.components.schemas;
      expect(schemas.ChatBasicCard).toBeDefined();
      expect(schemas.ChatMcqCard).toBeDefined();
      expect(schemas.ChatTokenFrame).toBeDefined();
      expect(schemas.ChatDoneFrame).toBeDefined();
      expect(schemas.ChatErrorFrame).toBeDefined();
    });

    it('models the done-frame cards entry as a oneOf of basic and MCQ shapes', () => {
      const doneFrame = spec.components.schemas.ChatDoneFrame;
      const cards = doneFrame.properties.data.properties.cards;
      expect(cards.items.oneOf).toBeDefined();
      const refs = cards.items.oneOf.map(
        (entry: { $ref: string }) => entry.$ref
      );
      expect(refs).toContain('#/components/schemas/ChatBasicCard');
      expect(refs).toContain('#/components/schemas/ChatMcqCard');
    });

    it('models /api/chat/deck cards as a oneOf of basic and MCQ shapes', () => {
      const op = spec.paths['/api/chat/deck']?.post;
      const cards =
        op.requestBody.content['application/json'].schema.properties.cards;
      expect(cards.items.oneOf).toBeDefined();
      const refs = cards.items.oneOf.map(
        (entry: { $ref: string }) => entry.$ref
      );
      expect(refs).toContain('#/components/schemas/ChatBasicCard');
      expect(refs).toContain('#/components/schemas/ChatMcqCard');
    });

    it('documents templateSlug on /api/chat/deck', () => {
      const op = spec.paths['/api/chat/deck']?.post;
      const props =
        op.requestBody.content['application/json'].schema.properties;
      expect(props.templateSlug).toBeDefined();
    });

    it('documents the error-frame types for /api/chat/message', () => {
      const errorFrame = spec.components.schemas.ChatErrorFrame;
      const variants = errorFrame.properties.data.oneOf;
      const types = variants.map(
        (variant: { properties: { type: { enum: string[] } } }) =>
          variant.properties.type.enum[0]
      );
      expect(types).toEqual(
        expect.arrayContaining([
          'consent_required',
          'conversation_not_found',
          'server_error',
        ])
      );
      expect(types).not.toContain('rate_limit');
    });

    it('documents /api/notion/login as deprecated and points to get-notion-link', () => {
      const op = spec.paths['/api/notion/login']?.get;
      expect(op).toBeDefined();
      expect(op.deprecated).toBe(true);
      expect(op.description).toMatch(/get-notion-link/);
    });
  });

  describe('Ankify swagger descriptions parse as YAML', () => {
    const spec = swaggerSpec as SwaggerSpec;

    it('registers /api/ankify/sync-to-ankiweb with its full description string', () => {
      const op = spec.paths['/api/ankify/sync-to-ankiweb']?.post;
      expect(op).toBeDefined();
      expect(op.description).toBe(
        'Allowlisted endpoint. Returns { ok: true }. 409 when no active client, 503 when AnkiConnect is unreachable.'
      );
    });

    it('keeps every Ankify description as a string, never a parsed mapping', () => {
      const ankifyPaths = Object.keys(spec.paths).filter((p) =>
        p.startsWith('/api/ankify/')
      );
      expect(ankifyPaths.length).toBeGreaterThan(0);
      ankifyPaths.forEach((p) => {
        Object.values(spec.paths[p]).forEach(
          (op: { description?: unknown }) => {
            if (op.description != null) {
              expect(typeof op.description).toBe('string');
            }
          }
        );
      });
    });
  });
});
