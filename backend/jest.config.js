/**
 * Jest configuration for the POS backend.  The tests use ts-jest to
 * compile TypeScript on the fly.  Integration tests spin up an
 * Express app instance with a separate SQLite database (file based
 * or in-memory) and exercise the critical business flows.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
};