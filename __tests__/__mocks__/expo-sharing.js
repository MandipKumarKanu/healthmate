let lastShared = null;

const isAvailableAsync = async () => true;
const shareAsync = async (uri, options) => {
  lastShared = { uri, options };
};

const __getLastShared = () => lastShared;
const __resetMockSharing = () => {
  lastShared = null;
};

module.exports = {
  isAvailableAsync,
  shareAsync,
  __getLastShared,
  __resetMockSharing,
};
