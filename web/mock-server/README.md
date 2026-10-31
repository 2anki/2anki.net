# Mock Server for 2anki Web Application

⚠️ **DEVELOPMENT/TESTING ONLY** - This server is intended for development and testing environments only. Do not deploy to production.

This mock server provides a comprehensive API simulation for testing the 2anki web application with Playwright.

## Overview

The mock server runs on `http://localhost:2020` and provides mocked responses for all API endpoints used by the 2anki web application. This allows for reliable and fast end-to-end testing without depending on external services.

## Security Considerations

- **CORS Configuration**: Restricted to development origins only (`localhost:3000`)
- **Framework Fingerprinting**: X-Powered-By header disabled to prevent Express.js version disclosure
- **Security Headers**: Additional security headers enabled (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, CSP)
- **Environment Variables**: Use `MOCK_SERVER_ALLOWED_ORIGINS` to add custom origins (comma-separated)
- **Port Configuration**: Use `MOCK_SERVER_PORT` to change the default port (2020)
- **No Authentication**: This server does not implement real authentication - for testing only

## Features

- **Complete API Coverage**: Mocks all API endpoints found in the application
- **Swagger Documentation**: Interactive API documentation available at `/docs`
- **Realistic Data**: Provides realistic mock data for testing scenarios
- **Secure CORS**: Properly configured CORS for development environments only
- **Error Handling**: Includes proper error responses for testing error scenarios

## API Endpoints

### User Management
- `GET /api/users/debug/locals` - Get user information and features
- `POST /api/users/logout` - Logout user
- `POST /api/users/login` - Login user
- `POST /api/users/link_email` - Link email to account
- `GET /api/users/auth/google/init` - Start Google sign-in (redirects to a mock authorize URL)
- `GET /api/users/auth/microsoft/init` - Start Microsoft sign-in (redirects to a mock authorize URL)
- `GET /api/users/auth/google` - Google OAuth redirect

### Notion Integration
- `GET /api/notion/get-notion-link` - Get Notion connection info
- `POST /api/notion/pages` - Search Notion pages
- `GET /api/notion/page/:pageId` - Get specific page
- `GET /api/notion/database/:databaseId` - Get specific database
- `POST /api/notion/convert` - Convert Notion content to Anki

### File Management
- `POST /api/upload/file` - Upload file
- `GET /api/upload/mine` - Get user uploads
- `DELETE /api/upload/mine/:key` - Delete upload
- `GET /api/upload/jobs` - Get conversion jobs
- `DELETE /api/upload/jobs/:id` - Delete job
- `GET /api/download/u/:key` - Download file

### Settings & Rules
- `POST /api/settings/create/:objectId` - Create settings
- `GET /api/settings/find/:id` - Get settings
- `GET /api/settings/card-options` - Get card options
- `POST /api/settings/delete/:pageId` - Delete settings
- `POST /api/rules/create/:id` - Create rules
- `GET /api/rules/find/:id` - Get rules

### Favorites
- `POST /api/favorite/create` - Add to favorites
- `POST /api/favorite/delete` - Remove from favorites
- `GET /api/favorite/mine` - Get user favorites

### Utility
- `GET /health` - Health check
- `GET /docs` - Swagger documentation
- `GET /docs/swagger.json` - Swagger JSON specification

## Usage

### Running the Mock Server

```bash
# Start only the mock server
npm run mock-server

# Run Playwright tests with mock server
npm run test:e2e:with-mock

# Or run tests normally (Playwright will auto-detect when mock server is needed)
npm run test:e2e
```

### Accessing Swagger Documentation

Once the server is running, visit:
- Interactive docs: http://localhost:2020/docs
- JSON specification: http://localhost:2020/docs/swagger.json

### Example Test Usage

```typescript
import { test, expect } from '@playwright/test';

test('should interact with mock API', async ({ page }) => {
  // Make API calls through the page context
  const response = await page.request.get('http://localhost:2020/api/users/debug/locals');
  const data = await response.json();
  expect(data.features.kiUI).toBe(true);
});
```

## Mock Data

The server includes realistic mock data for:
- **Users**: Test user with various features and permissions
- **Notion Objects**: Sample pages and databases
- **Jobs**: Conversion jobs in various states
- **Uploads**: Sample file uploads
- **Favorites**: Favorited Notion objects

## Configuration

The mock server is configured to:
- Run on port 2020 (matching the Vite proxy configuration)
- Accept CORS requests from the frontend
- Provide consistent, deterministic responses
- Include proper HTTP status codes and error handling

## Integration with Playwright

The Playwright configuration automatically starts the mock server when needed:

```typescript
// Conditionally start mock server based on environment or test patterns
webServer: shouldRunMockServer ? [
  {
    command: 'node mock-server/server.js',
    url: 'http://localhost:2020/health',
    reuseExistingServer: !process.env.CI,
  },
  // ... frontend server config
] : {
  // ... just frontend server
}
```

This ensures that:
1. The mock server only starts when actually needed
2. The frontend proxy correctly routes API calls to the mock server
3. Tests can rely on consistent API responses
4. No external dependencies are required for testing

## Benefits

- **Fast Tests**: No network latency or external service dependencies
- **Reliable**: Consistent responses every test run
- **Isolated**: Tests don't affect real data or services
- **Comprehensive**: All API scenarios can be tested
- **Documented**: Swagger docs make it easy to understand available endpoints