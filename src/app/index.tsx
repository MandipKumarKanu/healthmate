import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
// import { useAppStore } from '../store/appStore';
// import { profileRepository } from '../database/repositories/profileRepository';
import { Colors } from '../theme/colors';

export default function IndexScreen() {
  const router = useRouter();
  // const { profile, isInitialized } = useAppStore();

  useEffect(() => {
    // TEMPORARY: Open alarm screen immediately on app launch for preview
    router.replace({
      pathname: '/alarm',
      params: {
        medicineName: 'Metformin',
        amount: '500 mg · 1 tablet',
        time: '08:00',
        label: 'Morning Dose',
      },
    });

    /*
    // ORIGINAL ROUTING (temporarily commented out to view alarm screen):
    if (!isInitialized) return;

    if (profile && profile.onboardingCompleted) {
      router.replace('/(tabs)/home');
      return;
    }

    const step = profileRepository.getOnboardingStep();
    if (step === 'permissions' || (profile && profile.name && profile.name.trim().length > 0)) {
      router.replace('/onboarding/permissions' as any);
    } else {
      router.replace('/onboarding');
    }
    */
  }, [router]);

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
