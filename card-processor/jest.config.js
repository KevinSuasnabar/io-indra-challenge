/** @type {import('jest').Config} */
const swcTransform = {
  '^.+\\.ts$': ['@swc/jest'],
};

module.exports = {
  projects: [
    {
      displayName: 'unit',
      rootDir: __dirname,
      testEnvironment: 'node',
      transform: swcTransform,
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
      setupFiles: ['<rootDir>/test/setup/test-env.ts'],
    },
    {
      displayName: 'integration',
      rootDir: __dirname,
      testEnvironment: 'node',
      transform: swcTransform,
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      setupFiles: ['<rootDir>/test/setup/test-env.ts'],
    },
  ],
};
