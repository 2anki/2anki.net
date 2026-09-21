/**
 * Mock API Server for Development and Testing
 *
 * WARNING: This server is intended for development and testing only.
 * Do not use this configuration in production environments.
 *
 * This mock server uses the same TypeScript interfaces as the main application
 * from the generated API files in ../src/generated/
 */

import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';

const app = express();
const PORT = process.env.MOCK_SERVER_PORT || 2020;

// Security: Disable X-Powered-By header to prevent framework fingerprinting
app.disable('x-powered-by');

// CORS configuration for development/testing only
const getAllowedOrigins = () => {
  const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:5173', // Vite dev server
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];

  if (process.env.MOCK_SERVER_ALLOWED_ORIGINS) {
    return [
      ...defaultOrigins,
      ...process.env.MOCK_SERVER_ALLOWED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ];
  }

  return defaultOrigins;
};

const corsOptions = {
  origin: getAllowedOrigins(),
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

// Middleware
app.use(cors(corsOptions));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' 'unsafe-eval'"
  );
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mock data using the same structure as the generated types
const mockUsers = [
  {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    isSubscriber: false,
    isPatreon: false,
    features: { kiUI: true },
  },
];

const mockNotionObjects = [
  {
    id: 'page-1',
    object: 'page',
    title: 'Sample Page',
    url: 'https://notion.so/sample-page',
    icon: '📄',
    data: {
      id: 'page-1',
      object: 'page',
      created_time: '2023-01-01T00:00:00.000Z',
      properties: {},
    },
    isFavorite: false,
  },
  {
    id: 'database-1',
    object: 'database',
    title: 'Sample Database',
    url: 'https://notion.so/sample-database',
    icon: '🗃️',
    data: {
      id: 'database-1',
      object: 'database',
      created_time: '2023-01-01T00:00:00.000Z',
      properties: {},
    },
    isFavorite: false,
  },
];

const mockJobs = [
  {
    id: 1,
    object_id: 'page-1',
    type: 'page',
    title: 'Sample Page Job',
    status: 'completed',
    created_at: '2023-01-01T00:00:00.000Z',
  },
];

// Simple API documentation for the mock server
const mockApiSpec = {
  openapi: '3.0.0',
  info: {
    title: '2anki Mock API',
    version: '1.0.0',
    description:
      'Mock API for 2anki application testing. Real API types are generated in ../src/generated/ from the server OpenAPI spec.',
  },
  servers: [{ url: 'http://localhost:2020', description: 'Mock server' }],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: { 200: { description: 'Service is healthy' } },
      },
    },
    '/api/users/debug/locals': {
      get: {
        summary: 'Get user debug information',
        responses: { 200: { description: 'User debug info' } },
      },
    },
    '/api/notion/pages': {
      post: {
        summary: 'Search Notion pages',
        responses: { 200: { description: 'Search results' } },
      },
    },
    '/api/upload/mine': {
      get: {
        summary: 'Get user uploads',
        responses: { 200: { description: 'List of uploads' } },
      },
    },
  },
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(mockApiSpec));

// API Routes
app.get('/api/users/debug/locals', (req, res) => {
  const cookieHeader = req.headers.cookie ?? '';
  const tokenMatch = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
  const tokenValue = tokenMatch ? tokenMatch[1] : null;

  if (tokenValue === 'stale-jwt-token') {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({
    locals: {
      owner: 1,
      patreon: false,
      subscriber: false,
      subscriptionInfo: {
        active: false,
        email: 'test@example.com',
        linked_email: 'test@example.com',
      },
    },
    linked_email: 'test@example.com',
    user: mockUsers[0],
    features: { kiUI: true },
  });
});

app.post('/api/users/logout', (req, res) => {
  res.json({ success: true });
});

app.post('/api/users/login', (req, res) => {
  const { email, password } = req.body;
  if (email === 'test@example.com' && password === 'password') {
    res.json({ success: true, token: 'mock-token' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/users/link_email', (req, res) => {
  res.json({ success: true });
});

app.get('/api/users/auth/google', (req, res) => {
  res.redirect('https://accounts.google.com/oauth/authorize?mock=true');
});

app.get('/api/notion/get-notion-link', (req, res) => {
  res.json({
    connected: true,
    workspace: 'Test Workspace',
    user: 'Test User',
  });
});

app.post('/api/notion/pages', (req, res) => {
  const { query } = req.body;
  const results = mockNotionObjects.filter((obj) =>
    obj.title.toLowerCase().includes(query.toLowerCase())
  );
  res.json({ results });
});

app.post('/api/notion/top-level-pages', (req, res) => {
  const { query = '' } = req.body;
  const results = mockNotionObjects
    .filter((obj) => obj.object === 'page')
    .filter((obj) => obj.title.toLowerCase().includes(query.toLowerCase()));
  res.json({ results });
});

app.post('/api/notion/convert', (req, res) => {
  const { id, type, title } = req.body;
  const newJob = {
    id: mockJobs.length + 1,
    object_id: id,
    type: type || 'page',
    title: title || 'Converted Content',
    status: 'processing',
    created_at: new Date().toISOString(),
  };
  mockJobs.push(newJob);
  res.json({ success: true, jobId: newJob.id });
});

const LEGACY_CHECKOUT_PRICES = {
  cohort: 'legacy',
  legacy: true,
  monthly: { cents: 600 },
  annual: { cents: 6000 },
  lockInDeadline: null,
};

const V2_CHECKOUT_PRICES = {
  cohort: 'v2',
  legacy: false,
  monthly: { cents: 799 },
  annual: { cents: 6400 },
  lockInDeadline: null,
};

app.get('/api/checkout/prices', (req, res) => {
  const cohort =
    req.query.cohort === 'v2' ? V2_CHECKOUT_PRICES : LEGACY_CHECKOUT_PRICES;
  res.json(cohort);
});

app.get('/api/upload/jobs', (req, res) => {
  res.json(mockJobs);
});

app.get('/api/upload/mine', (req, res) => {
  res.json([]);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/docs/swagger.json', (req, res) => {
  res.json(mockApiSpec);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock server running on http://localhost:${PORT}`);
  console.log(`Swagger docs available at http://localhost:${PORT}/docs`);
  console.log(
    'Note: Real API types are generated in ../src/generated/ from server OpenAPI spec'
  );
});

export default app;
