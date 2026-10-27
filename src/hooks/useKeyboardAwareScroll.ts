import { useCallback, useEffect, useRef } from 'react';
import {
  ScrollView,
  TextInput,
  Keyboard,
  Platform,
  UIManager,
  findNodeHandle,
  Dimensions,
  type NativeSyntheticEvent,
  type TargetedEvent,
  type NativeScrollEvent,
} from 'react-native';

export interface UseKeyboardAwareScrollOptions {
  extraOffset?: number; // default 80
}

/**
 * Custom hook to ensure any focused TextInput within a ScrollView
 * is automatically scrolled smoothly into view above the keyboard.
 * Compatible with React Native 0.88 Fabric (New Architecture) and Paper.
 */
export function useKeyboardAwareScroll(options?: UseKeyboardAwareScrollOptions) {
  const extraOffset = options?.extraOffset ?? 80;
  const scrollViewRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const lastFocusedNodeRef = useRef<any>(null);
  const scrollYRef = useRef<number>(0);
  const keyboardHeightRef = useRef<number>(0);
  const keyboardScreenYRef = useRef<number>(0);
  const isKeyboardVisibleRef = useRef<boolean>(false);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const fallbackMeasureInWindow = useCallback(
    (nodeOrTag: any, scrollView: any, currentScrollY: number) => {
      const windowHeight = Dimensions.get('window').height;
      const keyboardTop =
        keyboardScreenYRef.current > 0
          ? keyboardScreenYRef.current
          : isKeyboardVisibleRef.current && keyboardHeightRef.current > 0
            ? windowHeight - keyboardHeightRef.current
            : windowHeight;

      const measureCallback = (
        _x: number,
        inputY: number,
        _width: number,
        inputHeight: number,
      ) => {
        if (!inputHeight && !inputY) return;

        // Compare input bottom against keyboard top
        const inputBottom = inputY + inputHeight + extraOffset;
        if (inputBottom > keyboardTop) {
          const overlap = inputBottom - keyboardTop;
          scrollView.scrollTo({
            y: currentScrollY + overlap,
            animated: true,
          });
        } else if (inputY < extraOffset) {
          // Input is scrolled too far up behind top header/insets
          const underflow = extraOffset - inputY;
          scrollView.scrollTo({
            y: Math.max(0, currentScrollY - underflow),
            animated: true,
          });
        }
      };

      if (typeof nodeOrTag?.measureInWindow === 'function') {
        nodeOrTag.measureInWindow(measureCallback);
      } else if (typeof nodeOrTag === 'number' && UIManager?.measureInWindow) {
        UIManager.measureInWindow(nodeOrTag, measureCallback);
      } else {
        const activeInput = (TextInput.State as any)?.currentlyFocusedInput?.();
        if (activeInput && typeof activeInput.measureInWindow === 'function') {
          activeInput.measureInWindow(measureCallback);
        }
      }
    },
    [extraOffset],
  );

  const scrollToNode = useCallback(
    (nodeOrTag: any) => {
      if (!nodeOrTag) return;
      lastFocusedNodeRef.current = nodeOrTag;

      const scrollView = scrollViewRef.current;
      if (!scrollView) return;

      // Small delay to allow soft keyboard animation and layout adjustments to settle
      setTimeout(() => {
        try {
          const currentScrollY = scrollYRef.current;

          // Strategy 1: Fabric-native measureLayout directly on the ScrollView host component
          if (typeof nodeOrTag.measureLayout === 'function') {
            nodeOrTag.measureLayout(
              scrollView,
              (_left: number, top: number, _width: number, height: number) => {
                const targetY = Math.max(0, top - extraOffset);
                scrollView.scrollTo({ y: targetY, animated: true });
              },
              () => {
                // If measureLayout relative to scrollView fails, fallback to Strategy 2 (measureInWindow)
                fallbackMeasureInWindow(nodeOrTag, scrollView, currentScrollY);
              },
            );
            return;
          }

          // Strategy 2: measureInWindow (HostComponent method on Fabric & Paper)
          fallbackMeasureInWindow(nodeOrTag, scrollView, currentScrollY);
        } catch {
          // Gracefully ignore layout errors
        }
      }, 60);
    },
    [extraOffset, fallbackMeasureInWindow],
  );

  const handleFocusCapture = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent> | any) => {
      const target = event?.nativeEvent?.target || event?.target;
      if (target) {
        scrollToNode(target);
      }
    },
    [scrollToNode],
  );

  // When keyboard opens, ensure the currently focused input is in full view
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      isKeyboardVisibleRef.current = true;
      if (e?.endCoordinates) {
        keyboardHeightRef.current = e.endCoordinates.height;
        keyboardScreenYRef.current = e.endCoordinates.screenY;
      }

      const target =
        lastFocusedNodeRef.current ||
        (TextInput.State as any)?.currentlyFocusedInput?.() ||
        (TextInput.State as any)?.currentlyFocusedField?.();
      if (target) {
        scrollToNode(target);
      }
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      isKeyboardVisibleRef.current = false;
      keyboardHeightRef.current = 0;
      keyboardScreenYRef.current = 0;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToNode]);

  return {
    scrollViewRef,
    scrollToNode,
    handleFocusCapture,
    onScroll: handleScroll,
  };
}

