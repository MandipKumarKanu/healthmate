import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppStore } from '../store/appStore';
import { Colors } from '../theme/colors';

export default function IndexScreen() {
  const router = useRouter();
  const { profile, isInitialized } = useAppStore();

  useEffect(() => {
    if (!isInitialized) return;

    if (profile && profile.onboardingCompleted) {
      router.replace('/(tabs)/home');
    } else {
      router.replace('/onboarding');
    }
  }, [isInitialized, profile, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
