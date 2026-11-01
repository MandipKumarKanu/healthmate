import { useState, useEffect } from 'react';
import { Keyboard, Platform, LayoutAnimation, UIManager } from 'react-native';

// Only needed in Old Architecture; New Architecture (Fabric) handles layout animations natively without this call
if (
  Platform.OS === 'android' &&
  !(globalThis as any).nativeFabricUIManager &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch {}
}

/**
 * Hook providing live keyboard height and visibility with smooth layout animation.
 * Ideal for lifting dialogs/modals above the soft keyboard without squishing their content.
 */
export function useKeyboardHeight(animate = true) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      if (animate) {
        try {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        } catch {}
      }
      setKeyboardHeight(e.endCoordinates.height);
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      if (animate) {
        try {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        } catch {}
      }
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [animate]);

  return {
    keyboardHeight,
    isKeyboardVisible: keyboardHeight > 0,
  };
}

