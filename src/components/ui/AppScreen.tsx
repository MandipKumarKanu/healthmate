import React from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  KeyboardAvoidingView,
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
}

export function AppScreen({
  children,
  scrollable = false,
  style,
  contentContainerStyle,
  extraScrollHeight = 80,
}: AppScreenProps) {
  const insets = useSafeAreaInsets();
  const { scrollViewRef, handleFocusCapture } = useKeyboardAwareScroll({
    extraOffset: extraScrollHeight,
  });

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }, style]}>
      <StatusBar style="dark" />
      {scrollable ? (
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          // Android already resizes this window (softwareKeyboardLayoutMode: "resize").
          // Applying "height" here as well double-shrinks the screen.
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <ScrollView
            ref={scrollViewRef}
            style={styles.scroll}
            contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            automaticallyAdjustKeyboardInsets={false}
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
