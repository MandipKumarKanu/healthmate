import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  Animated,
  ActivityIndicator,
  TouchableOpacity,
  Easing,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import AndroidIconMonochrome from '../../../assets/images/android-icon-monochrome.png';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { ScanStage } from '../../services/ocrRecognition';

interface AiAnalysisProgressViewProps {
  currentStage: ScanStage;
  statusMessage?: string;
  hasBackImage: boolean;
  error?: string | null;
  onRetry?: () => void;
  onManualEntry?: () => void;
}

interface StageStep {
  id: string;
  title: string;
  subtitle: string;
  iconName: string;
}

export function AiAnalysisProgressView({
  currentStage,
  statusMessage,
  hasBackImage,
  error,
  onRetry,
  onManualEntry,
}: AiAnalysisProgressViewProps) {
  // Pulse animation for central core aura
  const [pulseAnim] = useState(() => new Animated.Value(1));
  const [glowAnim] = useState(() => new Animated.Value(0.45));

  // 3D Orbital Revolving Animations
  const [orbitAnim1] = useState(() => new Animated.Value(0));
  const [orbitAnim2] = useState(() => new Animated.Value(0));
  const [orbitAnim3] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // Breathing aura
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1.08,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.9,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.45,
            duration: 1400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    // Orbit 1: Primary blob (fast forward)
    const orbitLoop1 = Animated.loop(
      Animated.timing(orbitAnim1, {
        toValue: 1,
        duration: 3200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    // Orbit 2: Green/emerald blob (counter-clockwise)
    const orbitLoop2 = Animated.loop(
      Animated.timing(orbitAnim2, {
        toValue: 1,
        duration: 4400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    // Orbit 3: Amber/cyan particle (inclined)
    const orbitLoop3 = Animated.loop(
      Animated.timing(orbitAnim3, {
        toValue: 1,
        duration: 5600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    pulseLoop.start();
    orbitLoop1.start();
    orbitLoop2.start();
    orbitLoop3.start();

    return () => {
      pulseLoop.stop();
      orbitLoop1.stop();
      orbitLoop2.stop();
      orbitLoop3.stop();
    };
  }, [pulseAnim, glowAnim, orbitAnim1, orbitAnim2, orbitAnim3]);

  // Rotations for 3D orbital blobs
  const spin1 = orbitAnim1.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const spin2 = orbitAnim2.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });

  const spin3 = orbitAnim3.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Define steps
  const steps: StageStep[] = [
    {
      id: 'preparing',
      title: 'Preparing images',
      subtitle: hasBackImage
        ? 'Optimizing front and back packaging resolutions'
        : 'Optimizing packaging image resolution',
      iconName: 'image-outline',
    },
    {
      id: 'ocr',
      title: 'Extracting text (OCR)',
      subtitle: hasBackImage
        ? 'Reading front and back packaging in parallel'
        : 'Reading visible packaging text',
      iconName: 'scan-outline',
    },
    {
      id: 'cleaning',
      title: 'Cleaning messy text',
      subtitle: 'Repairing digit confusions and formatting lines',
      iconName: 'brush-outline',
    },
    {
      id: 'ai_analysis',
      title: 'Analysing with HealthMate AI',
      subtitle: 'Identifying brand, active salt, and dates',
      iconName: 'sparkles-outline',
    },
    {
      id: 'complete',
      title: 'Generating result',
      subtitle: 'Structuring information for review',
      iconName: 'checkmark-circle-outline',
    },
  ];

  const getStepState = (stepId: string): 'pending' | 'active' | 'completed' => {
    const stageOrder: Record<ScanStage, number> = {
      idle: 0,
      preparing: 1,
      front_ocr: 2,
      back_ocr: 2,
      parallel_ocr: 2,
      cleaning: 3,
      ai_analysis: 4,
      complete: 5,
    };

    const currentRank = stageOrder[currentStage] ?? 0;

    let stepRank = 0;
    if (stepId === 'preparing') stepRank = 1;
    else if (stepId === 'ocr') stepRank = 2;
    else if (stepId === 'cleaning') stepRank = 3;
    else if (stepId === 'ai_analysis') stepRank = 4;
    else if (stepId === 'complete') stepRank = 5;

    if (currentRank > stepRank) return 'completed';
    if (currentRank === stepRank) return 'active';
    return 'pending';
  };

  return (
    <View style={styles.container}>
      {/* 3D Revolving Orbital System */}
      <View style={styles.orbitStage}>
        {/* Ambient Pulsing Backlight */}
        <Animated.View
          style={[
            styles.glowOuter,
            {
              transform: [{ scale: pulseAnim }],
              opacity: glowAnim,
            },
          ]}
        />

        {/* Orbit Track 1: Tilted Ellipse (-28deg) with primary blob */}
        <View style={[styles.orbitTrack, styles.orbitTrack1]} pointerEvents="none">
          <View style={styles.orbitRing1} />
          <Animated.View style={[styles.orbitArm, { transform: [{ rotate: spin1 }] }]}>
            <View style={styles.blob1} />
          </Animated.View>
        </View>

        {/* Orbit Track 2: Counter-tilted Ellipse (+34deg) with emerald blob */}
        <View style={[styles.orbitTrack, styles.orbitTrack2]} pointerEvents="none">
          <View style={styles.orbitRing2} />
          <Animated.View style={[styles.orbitArm, { transform: [{ rotate: spin2 }] }]}>
            <View style={styles.blob2} />
          </Animated.View>
        </View>

        {/* Orbit Track 3: Steeper Ellipse (+76deg) with cyan micro-blob */}
        <View style={[styles.orbitTrack, styles.orbitTrack3]} pointerEvents="none">
          <View style={styles.orbitRing3} />
          <Animated.View style={[styles.orbitArm, { transform: [{ rotate: spin3 }] }]}>
            <View style={styles.blob3} />
          </Animated.View>
        </View>

        {/* Central Core: Dark Capsule with Monochrome App Icon */}
        <Animated.View
          style={[
            styles.coreContainer,
            {
              transform: [{ scale: pulseAnim }],
            },
          ]}
        >
          <View style={styles.coreInner}>
            <Image
              source={AndroidIconMonochrome}
              style={styles.monochromeIcon}
              resizeMode="contain"
              accessibilityLabel="HealthMate AI"
            />
          </View>
        </Animated.View>
      </View>

      <Text style={styles.title}>Analysing with HealthMate AI</Text>
      <Text style={styles.subtitle}>
        {hasBackImage
          ? "We're extracting text from both images and understanding the medicine details."
          : "We're extracting text and understanding the medicine details."}
      </Text>

      {/* Error Card if failure occurred */}
      {error ? (
        <View style={styles.errorCard}>
          <View style={styles.errorHeader}>
            <Ionicons name="alert-circle-outline" size={24} color={Colors.error} />
            <Text style={styles.errorTitle}>Analysis Encountered an Issue</Text>
          </View>
          <Text style={styles.errorBody}>{error}</Text>
          <View style={styles.errorActions}>
            {onRetry && (
              <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.8}>
                <Feather name="refresh-cw" size={15} color="#FFFFFF" />
                <Text style={styles.retryBtnText}>Retry Analysis</Text>
              </TouchableOpacity>
            )}
            {onManualEntry && (
              <TouchableOpacity
                style={styles.manualBtn}
                onPress={onManualEntry}
                activeOpacity={0.8}
              >
                <Feather name="edit-3" size={15} color={Colors.primary} />
                <Text style={styles.manualBtnText}>Add Manually</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        /* Real Processing Steps */
        <View style={styles.stepsCard}>
          {steps.map((step) => {
            const state = getStepState(step.id);
            return (
              <View key={step.id} style={styles.stepRow}>
                <View style={styles.stepIconCol}>
                  {state === 'completed' ? (
                    <View style={styles.stepBadgeCompleted}>
                      <Feather name="check" size={14} color="#FFFFFF" />
                    </View>
                  ) : state === 'active' ? (
                    <View style={styles.stepBadgeActive}>
                      <ActivityIndicator size="small" color={Colors.primary} />
                    </View>
                  ) : (
                    <View style={styles.stepBadgePending}>
                      <View style={styles.stepDotPending} />
                    </View>
                  )}
                </View>

                <View style={styles.stepTextContainer}>
                  <Text
                    style={[
                      styles.stepTitle,
                      state === 'active' && styles.stepTitleActive,
                      state === 'completed' && styles.stepTitleCompleted,
                    ]}
                  >
                    {step.title}
                  </Text>
                  <Text style={styles.stepSubtitle}>{step.subtitle}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Pro Tip Card */}
      <View style={styles.proTipCard}>
        <Ionicons name="bulb-outline" size={20} color={Colors.primary} />
        <View style={styles.proTipTextCol}>
          <Text style={styles.proTipTitle}>Pro Tip</Text>
          <Text style={styles.proTipBody}>
            {hasBackImage
              ? 'Both front and back images give the most complete active salt and batch identification.'
              : 'Adding the back side of the package in future scans helps identify composition, manufacturer, and batch details.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  orbitStage: {
    width: 190,
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: Spacing.md,
  },
  glowOuter: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: Colors.primaryLight,
  },
  orbitTrack: {
    position: 'absolute',
    width: 170,
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitTrack1: {
    transform: [{ rotate: '-28deg' }, { scaleY: 0.44 }],
  },
  orbitTrack2: {
    transform: [{ rotate: '34deg' }, { scaleY: 0.44 }],
  },
  orbitTrack3: {
    transform: [{ rotate: '78deg' }, { scaleY: 0.38 }],
  },
  orbitRing1: {
    position: 'absolute',
    width: 156,
    height: 156,
    borderRadius: 78,
    borderWidth: 1.5,
    borderColor: 'rgba(7, 136, 245, 0.28)',
    borderStyle: 'dashed',
  },
  orbitRing2: {
    position: 'absolute',
    width: 164,
    height: 164,
    borderRadius: 82,
    borderWidth: 1.5,
    borderColor: 'rgba(50, 195, 106, 0.28)',
  },
  orbitRing3: {
    position: 'absolute',
    width: 172,
    height: 172,
    borderRadius: 86,
    borderWidth: 1.2,
    borderColor: 'rgba(56, 189, 248, 0.22)',
  },
  orbitArm: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  blob1: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#0788F5',
    shadowColor: '#0788F5',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  blob2: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#32C36A',
    shadowColor: '#32C36A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 7,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  blob3: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#38BDF8',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 6,
  },
  coreContainer: {
    width: 82,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  coreInner: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },
  monochromeIcon: {
    width: 46,
    height: 46,
    tintColor: '#FFFFFF',
  },
  title: {
    ...Typography.heading2,
    textAlign: 'center',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  stepsCard: {
    width: '100%',
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    gap: 16,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepIconCol: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeCompleted: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeActive: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgePending: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F1F1F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotPending: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C5C5D0',
  },
  stepTextContainer: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  stepTitleActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  stepTitleCompleted: {
    color: Colors.textPrimary,
  },
  stepSubtitle: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  errorCard: {
    width: '100%',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.cardPadding,
    marginBottom: Spacing.lg,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.error,
  },
  errorBody: {
    fontSize: 13,
    color: '#991B1B',
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 10,
  },
  retryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    borderRadius: Radius.md,
    gap: 6,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  manualBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingVertical: 10,
    borderRadius: Radius.md,
    gap: 6,
  },
  manualBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  proTipCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0F7FF',
    borderWidth: 1,
    borderColor: '#D0E7FC',
    borderRadius: Radius.card,
    padding: Spacing.cardPadding,
    gap: 12,
  },
  proTipTextCol: {
    flex: 1,
  },
  proTipTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 2,
  },
  proTipBody: {
    fontSize: 12,
    color: '#3B82F6',
    lineHeight: 17,
  },
});
