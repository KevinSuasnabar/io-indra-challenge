const fs = require('node:fs');
const path = require('node:path');

const swcTransform = { '^.+\\.ts$': ['@swc/jest'] };

function project(service, kind) {
  const rootDir = path.join(__dirname, service);
  const setupFile = path.join(rootDir, 'test/setup/test-env.ts');

  return {
    displayName: `${service}:${kind}`,
    rootDir,
    testEnvironment: 'node',
    transform: swcTransform,
    testMatch: [`<rootDir>/test/${kind}/**/*.test.ts`],
    ...(fs.existsSync(setupFile) ? { setupFiles: [setupFile] } : {}),
  };
}

module.exports = {
  projects: [
    project('card-issuer', 'unit'),
    project('card-issuer', 'integration'),
    project('card-processor', 'unit'),
    project('card-processor', 'integration'),
  ],
};
