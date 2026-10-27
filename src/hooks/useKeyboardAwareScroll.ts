import { useCallback, useEffect, useRef } from 'react';
import {
  ScrollView,
  TextInput,
  Keyboard,
  Platform,
  UIManager,
  type NativeSyntheticEvent,
  type TargetedEvent,
} from 'react-native';

export interface UseKeyboardAwareScrollOptions {
  extraOffset?: number; // default 80
}

/**
 * Custom hook to ensure any focused TextInput within a ScrollView
 * is automatically scrolled smoothly into view above the keyboard.
 */
export function useKeyboardAwareScroll(options?: UseKeyboardAwareScrollOptions) {
  const extraOffset = options?.extraOffset ?? 80;
  const scrollViewRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const lastFocusedNodeRef = useRef<any>(null);

  const scrollToNode = useCallback(
    (nodeOrTag: any) => {
      if (!nodeOrTag) return;
      lastFocusedNodeRef.current = nodeOrTag;

      const scrollView = scrollViewRef.current;
      if (!scrollView) return;

      // Small delay to allow soft keyboard animation and layout adjustments to settle
      setTimeout(() => {
        try {
          const innerNode =
            (scrollView as any)?.getInnerViewNode?.() ||
            (scrollView as any)?._innerView?.nativeInstance;

          // Strategy 1: HostInstance measureLayout (React Native 0.70+)
          if (innerNode && typeof nodeOrTag.measureLayout === 'function') {
            nodeOrTag.measureLayout(
              innerNode,
              (_left: number, top: number) => {
                const targetY = Math.max(0, top - extraOffset);
                scrollView.scrollTo({ y: targetY, animated: true });
              },
              () => {
                // Strategy 2: RN scrollResponder fallback
                (scrollView as any)?.scrollResponderScrollNativeHandleToKeyboard?.(
                  nodeOrTag,
                  extraOffset,
                  true
                );
              }
            );
            return;
          }

          // Strategy 3: Tag number via UIManager
          if (typeof nodeOrTag === 'number' && innerNode) {
            UIManager.measureLayout(
              nodeOrTag,
              innerNode,
              () => {
                (scrollView as any)?.scrollResponderScrollNativeHandleToKeyboard?.(
                  nodeOrTag,
                  extraOffset,
                  true
                );
              },
              (_left: number, top: number) => {
                const targetY = Math.max(0, top - extraOffset);
                scrollView.scrollTo({ y: targetY, animated: true });
              }
            );
            return;
          }

          // Strategy 4: scrollResponder fallback
          (scrollView as any)?.scrollResponderScrollNativeHandleToKeyboard?.(
            nodeOrTag,
            extraOffset,
            true
          );
        } catch {
          // Gracefully ignore layout errors
        }
      }, 50);
    },
    [extraOffset]
  );

  const handleFocusCapture = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent> | any) => {
      const target = event?.nativeEvent?.target || event?.target;
      if (target) {
        scrollToNode(target);
      }
    },
    [scrollToNode]
  );

  // When keyboard opens, make sure the currently focused input is in full view
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      const target =
        lastFocusedNodeRef.current ||
        (TextInput.State as any)?.currentlyFocusedInput?.() ||
        (TextInput.State as any)?.currentlyFocusedField?.();
      if (target) {
        scrollToNode(target);
      }
    });

    return () => sub.remove();
  }, [scrollToNode]);

  return {
    scrollViewRef,
    scrollToNode,
    handleFocusCapture,
  };
}
