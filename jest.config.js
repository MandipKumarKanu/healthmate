module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^expo-sqlite$': '<rootDir>/__tests__/__mocks__/expo-sqlite.js',
    '^expo-notifications$': '<rootDir>/__tests__/__mocks__/expo-notifications.js',
    '^react-native$': '<rootDir>/__tests__/__mocks__/react-native.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};
