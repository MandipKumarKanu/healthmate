import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../theme/colors';
import { useKeyboardAwareScroll } from '../../hooks/useKeyboardAwareScroll';

interface AppScreenProps {
  children: React.ReactNode;
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  extraScrollHeight?: number;
  safeAreaEdges?: ('top' | 'bottom')[];
}

export function AppScreen({
  children,
  scrollable = false,
  style,
  contentContainerStyle,
  extraScrollHeight = 80,
  safeAreaEdges = ['top', 'bottom'],
}: AppScreenProps) {
  const insets = useSafeAreaInsets();
  const { scrollViewRef, handleFocusCapture, onScroll } = useKeyboardAwareScroll({
    extraOffset: extraScrollHeight,
  });

  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: safeAreaEdges.includes('top') ? insets.top : 0,
          // When soft keyboard is visible, remove safe area bottom padding
          // to eliminate the redundant dead space above the keyboard.
          paddingBottom: isKeyboardVisible
            ? 0
            : safeAreaEdges.includes('bottom')
              ? insets.bottom
              : 0,
        },
        style,
      ]}
    >
      <StatusBar style="dark" />
      {scrollable ? (
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          // Android: 'undefined' behavior relies on the system's adjustResize,
          // which Android disables when the app draws edge-to-edge — the window
          // stopped resizing and inputs hid under the keyboard. 'height' is
          // driven by JS keyboard events and keeps working edge-to-edge.
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <ScrollView
            ref={scrollViewRef}
            style={styles.scroll}
            contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={true}
            onScroll={onScroll}
            scrollEventThrottle={16}
          >
            <View style={styles.focusCaptureWrapper} onFocusCapture={handleFocusCapture}>
              {children}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[styles.contentContainer, contentContainerStyle]}>{children}</View>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
  focusCaptureWrapper: {
    flexGrow: 1,
  },
});
