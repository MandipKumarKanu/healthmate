module.exports = {
  openDatabaseSync: jest.fn(() => {
    throw new Error('Native SQLite not available in test runner');
  }),
};
