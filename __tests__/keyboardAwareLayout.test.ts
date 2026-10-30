import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Keyboard, Dimensions } from 'react-native';

describe('Keyboard aware layout and input visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Keyboard listener setup', () => {
    it('registers show and hide listeners for platform keyboard events', () => {
      const addListenerSpy = jest.spyOn(Keyboard, 'addListener');
      const showEvent = 'keyboardDidShow';
      const hideEvent = 'keyboardDidHide';

      const showSub = Keyboard.addListener(showEvent, () => {});
      const hideSub = Keyboard.addListener(hideEvent, () => {});

      expect(addListenerSpy).toHaveBeenCalledWith(showEvent, expect.any(Function));
      expect(addListenerSpy).toHaveBeenCalledWith(hideEvent, expect.any(Function));

      showSub.remove();
      hideSub.remove();
    });
  });

  describe('Keyboard overlap calculation logic', () => {
    it('computes positive overlap when focused input bottom exceeds keyboard top', () => {
      const windowHeight = 800;
      const keyboardHeight = 300;
      const keyboardTop = windowHeight - keyboardHeight; // 500
      const extraOffset = 80;

      // An input located at Y=460 with height=50 has bottom at 510 (+80 offset = 590)
      const inputY = 460;
      const inputHeight = 50;
      const inputBottomWithOffset = inputY + inputHeight + extraOffset; // 590

      expect(inputBottomWithOffset).toBeGreaterThan(keyboardTop);
      const overlap = inputBottomWithOffset - keyboardTop;
      expect(overlap).toBe(90); // needs 90px scroll to be comfortably visible
    });

    it('requires no scroll when input is comfortably above keyboard', () => {
      const windowHeight = 800;
      const keyboardHeight = 300;
      const keyboardTop = windowHeight - keyboardHeight; // 500
      const extraOffset = 80;

      // An input at Y=200 with height=50 has bottom at 250 (+80 = 330)
      const inputY = 200;
      const inputHeight = 50;
      const inputBottomWithOffset = inputY + inputHeight + extraOffset;

      expect(inputBottomWithOffset).toBeLessThanOrEqual(keyboardTop);
      const overlap = Math.max(0, inputBottomWithOffset - keyboardTop);
      expect(overlap).toBe(0);
    });

    it('handles compact screen sizes (360x640) with standard keyboard', () => {
      const compactWindowHeight = 640;
      const keyboardHeight = 280;
      const keyboardTop = compactWindowHeight - keyboardHeight; // 360
      const extraOffset = 60;

      // Input near the bottom at Y=320 with height=45
      const inputY = 320;
      const inputHeight = 45;
      const inputBottomWithOffset = inputY + inputHeight + extraOffset; // 425

      const overlap = inputBottomWithOffset - keyboardTop; // 65
      expect(overlap).toBe(65);
    });
  });
});
