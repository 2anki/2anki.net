import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  emitAnswersPages,
  emitConvertHubPage,
  emitLandingPages,
  emitMetaOnlyPages,
  emitNotionMarketplacePage,
} from './scripts/prerenderLandingPages';
import { keepRootAssetsSameOrigin } from './scripts/keepRootAssetsSameOrigin';
import { sameOriginBuiltUrl } from './scripts/sameOriginBuiltUrl';

const SHORT_SHA_LENGTH = 7;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function shortenFullSha(value: string): string {
  return FULL_SHA_PATTERN.test(value)
    ? value.slice(0, SHORT_SHA_LENGTH)
    : value;
}

function resolveRelease(envValue: string | undefined): string {
  const fromEnv = envValue?.trim() ?? '';
  if (fromEnv !== '') {
    return shortenFullSha(fromEnv);
  }
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5_000,
    }).trim();
    return shortenFullSha(sha);
  } catch {
    return '';
  }
}

function landingPrerender(): Plugin {
  return {
    name: '2anki-landing-prerender',
    apply: 'build',
    closeBundle() {
      const buildDir = path.resolve(__dirname, 'build');
      emitLandingPages(buildDir);
      emitNotionMarketplacePage(buildDir);
      emitConvertHubPage(buildDir);
      emitAnswersPages(buildDir);
      emitMetaOnlyPages(buildDir);
    },
  };
}

function rootAssetsSameOrigin(): Plugin {
  return {
    name: '2anki-root-assets-same-origin',
    enforce: 'post',
    transformIndexHtml(html) {
      return keepRootAssetsSameOrigin(html);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  const rawAssetBaseUrl = process.env.ASSET_BASE_URL || '/';
  const base = rawAssetBaseUrl.endsWith('/')
    ? rawAssetBaseUrl
    : `${rawAssetBaseUrl}/`;

  return {
    base,

    experimental: {
      renderBuiltUrl(filename) {
        return sameOriginBuiltUrl(filename);
      },
    },

    plugins: [
      react(),
      svgr({
        // SVG as React components
        svgrOptions: {
          exportType: 'default',
        },
        include: '**/*.svg',
      }),
      landingPrerender(),
      rootAssetsSameOrigin(),
    ],

    // Test configuration
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      css: true,
      deps: {
        inline: ['@exodus/bytes'],
      },
      include: [
        'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
        'scripts/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
      ],
      exclude: ['tests/**/*', 'e2e/**/*'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        reportsDirectory: 'coverage',
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.{test,spec}.{ts,tsx}',
          'src/setupTests.ts',
          'src/schemas/**',
          'src/react-app-env.d.ts',
        ],
      },
    },

    // Define aliases
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    // Development server configuration
    server: {
      port: 3000,
      host: true,
      open: true,
      proxy: {
        // Proxy API requests to backend
        '/api': {
          target: 'http://localhost:2020',
          changeOrigin: true,
          secure: false,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, _res) => {
              console.log('proxy error', err);
            });
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              console.log(
                'Sending Request to the Target:',
                req.method,
                req.url
              );
            });
            proxy.on('proxyRes', (proxyRes, req, _res) => {
              console.log(
                'Received Response from the Target:',
                proxyRes.statusCode,
                req.url
              );
            });
          },
        },
        // Token-gated ankify session paths (slice 1). The backend handles
        // validation + proxy to the per-session noVNC port in-process.
        '/v': {
          target: 'http://localhost:2020',
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },

    // Build configuration
    build: {
      outDir: 'build',
      // Dev sourcemaps are handled by Vite automatically
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('react-router-dom')) return 'router';
          },
        },
      },
    },

    // CSS configuration
    css: {
      modules: {
        // CSS Modules configuration
        generateScopedName: '[name]__[local]___[hash:base64:5]',
      },
      preprocessorOptions: {
        scss: {
          // SCSS global imports if needed
          additionalData: ``,
        },
      },
    },

    // Environment variables configuration
    define: {
      // Keep existing REACT_APP_ variables for compatibility
      ...Object.keys(env).reduce((prev, key) => {
        if (key.startsWith('REACT_APP_')) {
          prev[`process.env.${key}`] = JSON.stringify(env[key]);
        }
        return prev;
      }, {}),
      'process.env.REACT_APP_RELEASE': JSON.stringify(
        resolveRelease(process.env.REACT_APP_RELEASE ?? env.REACT_APP_RELEASE)
      ),
    },

    // Additional configuration
    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
  };
});
