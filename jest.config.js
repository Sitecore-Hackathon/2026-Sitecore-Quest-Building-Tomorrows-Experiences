const nextJest = require("next/jest.js");

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],
  collectCoverageFrom: [
    "src/app/api/smartspot/**/*.ts",
    "src/app/smartspot/utils/**/*.ts",
    "src/app/smartspot/components/**/*.tsx",
  ],
};

module.exports = createJestConfig(config);
