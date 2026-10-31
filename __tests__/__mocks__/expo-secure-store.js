// Deterministic in-memory mock for expo-secure-store used by tests.
const store = new Map();

module.exports = {
  getItemAsync: jest.fn().mockImplementation(async (key) => {
    return store.has(key) ? store.get(key) : null;
  }),
  setItemAsync: jest.fn().mockImplementation(async (key, value) => {
    store.set(key, value);
  }),
  deleteItemAsync: jest.fn().mockImplementation(async (key) => {
    store.delete(key);
  }),

  // Test helpers
  __clearStore: () => {
    store.clear();
  },
  __getStoreContents: () => Object.fromEntries(store.entries()),
};
