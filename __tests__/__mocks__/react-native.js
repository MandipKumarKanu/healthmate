const Platform = {
  OS: 'android',
  select: (obj) => (obj && obj.android !== undefined ? obj.android : obj?.default),
};

module.exports = {
  Platform,
};
