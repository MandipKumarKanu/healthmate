import React, { useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { useAppStore } from '../../store/appStore';

const { width: screenWidth } = Dimensions.get('window');

export default function OnboardingWelcomeScreen() {
  const router = useRouter();
  const profile = useAppStore((state) => state.profile);

  useEffect(() => {
    if (profile?.onboardingCompleted) {
      router.replace('/(tabs)/home');
    }
  }, [profile?.onboardingCompleted, router]);

  const handleNext = () => {
    router.push('/onboarding/profile');
  };

  return (
    <AppScreen scrollable={false} contentContainerStyle={styles.container}>
      <View style={styles.content}>
        {/* Top Header: Logo Icon & App Name */}
        <View style={styles.topHeader}>
          <View style={styles.appIcon}>
            <MaterialCommunityIcons
              name="heart-pulse"
              size={36}
              color="#FFFFFF"
            />
          </View>
          <Text style={styles.brandTitle}>HealthMate AI</Text>
        </View>

        {/* Central 3D Hero Graphic */}
        <View style={styles.graphicContainer}>
          <Image
            source={require('../../../assets/images/medication_routine_hero.png')}
            style={styles.heroImage}
            resizeMode="contain"
            accessibilityLabel="Medication routine illustration"
          />
        </View>

        {/* Headline & Supporting Text */}
        <View style={styles.textContainer}>
          <Text style={styles.stepIndicator}>STEP 1 OF 3</Text>
          <Text style={styles.headline}>
            Your medication,{'\n'}organized beautifully.
          </Text>
          <Text style={styles.subhead}>
            A little clarity for your everyday routine. Keep medicines, reminders
            and label questions together.
          </Text>
        </View>

        {/* Action Section: Next Button & Privacy Footnote */}
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Next, proceed to profile setup"
          >
            <Text style={styles.nextButtonText}>Next</Text>
            <Feather
              name="arrow-right"
              size={18}
              color="#FFFFFF"
              style={styles.nextArrow}
            />
          </TouchableOpacity>

          <View style={styles.privacyNote}>
            <Feather name="lock" size={13} color={Colors.textSecondary} />
            <Text style={styles.privacyText}>
              Private & stored locally on your device
            </Text>
          </View>
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FD',
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
    justifyContent: 'space-between',
  },
  topHeader: {
    alignItems: 'center',
    marginTop: 8,
  },
  appIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#0788F5',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0788F5',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
    letterSpacing: -0.3,
  },
  graphicContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    width: '100%',
    height: Math.min(screenWidth * 0.72, 300),
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0788F5',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  headline: {
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
    letterSpacing: -0.5,
    color: '#0F172A',
    marginBottom: 12,
  },
  subhead: {
    fontSize: 15,
    lineHeight: 22,
    color: '#64748B',
    fontWeight: '400',
  },
  actionSection: {
    alignItems: 'center',
    width: '100%',
  },
  nextButton: {
    width: '100%',
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: '#0788F5',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0788F5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  nextArrow: {
    marginLeft: 8,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  privacyText: {
    fontSize: 12,
    color: '#64748B',
    marginLeft: 6,
  },
});
