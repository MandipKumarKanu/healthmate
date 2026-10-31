const DateTimePicker = (props) => null;
DateTimePicker.displayName = 'DateTimePicker';

const DateTimePickerAndroid = {
  open: jest.fn(),
  dismiss: jest.fn().mockResolvedValue(true),
};

module.exports = {
  __esModule: true,
  default: DateTimePicker,
  DateTimePickerAndroid,
};
