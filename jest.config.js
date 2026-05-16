module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverage: false,
  collectCoverageFrom: [
    'server.js',
    'public/js/colors.js',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
    '/cypress/',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90,
    },
  },
  testTimeout: 15000,
};
