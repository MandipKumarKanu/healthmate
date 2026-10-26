import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Camera from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { AppScreen } from '../../components/ui/AppScreen';

type PermissionState = 'idle' | 'granted' | 'denied' | 'unavailable';

export default function OnboardingPermissionsScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notificationState, setNotificationState] = useState<PermissionState>('idle');
  const [exactAlarmState, setExactAlarmState] = useState<PermissionState>('idle');
  const [cameraState, setCameraState] = useState<PermissionState>('idle');
  const [photosState, setPhotosState] = useState<PermissionState>('idle');
  const [, requestCameraPermission] = Camera.useCameraPermissions();

  const finishSetup = () => router.replace('/(tabs)/home');

  const requestPermissions = async () => {
    setBusy(true);
    try {
      const notification = await Notifications.requestPermissionsAsync();
      const notificationsGranted = notification.granted || notification.status === 'granted';
      setNotificationState(notificationsGranted ? 'granted' : 'denied');

      if (Platform.OS === 'android') {
        try {
          const existing = await Notifications.getExactAlarmPermissionsAsync();
          const exact = existing.granted ? existing : await Notifications.requestExactAlarmPermissionsAsync();
          setExactAlarmState(exact.granted ? 'granted' : 'denied');
        } catch {
          setExactAlarmState('unavailable');
        }
      } else {
        setExactAlarmState('unavailable');
      }

      // Camera and photo access are optional. Request them here only because the
      // user tapped the setup action; declining does not block app access.
      try {
        const camera = await requestCameraPermission();
        setCameraState(camera.granted ? 'granted' : 'denied');
      } catch {
        setCameraState('unavailable');
      }

      try {
        const photos = await ImagePicker.requestMediaLibraryPermissionsAsync();
        setPhotosState(photos.granted ? 'granted' : 'denied');
      } catch {
        setPhotosState('unavailable');
      }

      if (!notificationsGranted) {
        Alert.alert(
          'Reminders need notification access',
          'HealthMate can still open, but medication alerts will not appear until notifications are allowed in Android Settings.'
        );
      }
    } catch {
      Alert.alert('Permission setup incomplete', 'You can continue now and change permissions later in system settings.');
    } finally {
      setBusy(false);
    }
  };

  const stateLabel = (state: PermissionState) => {
    if (state === 'granted') return 'Allowed';
    if (state === 'denied') return 'Not allowed';
    if (state === 'unavailable') return 'Not available';
    return '';
  };

  const PermissionCard = ({ icon, title, description, important, state }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    description: string;
    important?: boolean;
    state: PermissionState;
  }) => (
    <View style={styles.card}>
      <View style={styles.iconBox}><Ionicons name={icon} size={27} color="#5B65D9" /></View>
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDescription}>{description}</Text>
        {!!stateLabel(state) && <Text style={[styles.status, state === 'granted' ? styles.allowed : styles.denied]}>{stateLabel(state)}</Text>}
      </View>
      <Text style={[styles.priority, important ? styles.important : styles.optional]}>{important ? 'Important' : 'Optional'}</Text>
    </View>
  );

  return (
    <AppScreen scrollable={false} contentContainerStyle={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.shield}><MaterialCommunityIcons name="shield-check-outline" size={38} color="#5B65D9" /></View>
          <View style={styles.headerCopy}>
            <Text style={styles.step}>STEP 3 OF 3</Text>
            <Text style={styles.heading}>Set up your permissions</Text>
            <Text style={styles.subtitle}>Help HealthMate keep your routine on track.</Text>
          </View>
        </View>

        <View style={styles.cards}>
          <PermissionCard icon="notifications-outline" title="Medicine notifications" description="Receive reminders at the right time." important state={notificationState} />
          <PermissionCard icon="alarm-outline" title="Precise reminders" description="Improve timing accuracy where supported." important state={exactAlarmState} />
          <PermissionCard icon="camera-outline" title="Camera access" description="Scan medicine labels when needed." state={cameraState} />
          <PermissionCard icon="images-outline" title="Photos and images" description="Choose prescriptions from your photos." state={photosState} />
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={requestPermissions} disabled={busy} activeOpacity={0.85} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Set up reminders</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={finishSetup} disabled={busy} accessibilityRole="button">
          <Text style={styles.skipText}>I'll do this later</Text>
        </TouchableOpacity>
        <Text style={styles.footer}>You can change permissions anytime in Android Settings.</Text>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F2FA' },
  scroll: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 28 },
  shield: { width: 76, height: 76, borderRadius: 24, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  step: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: '#5B65D9', marginBottom: 5 },
  heading: { fontSize: 27, lineHeight: 32, fontWeight: '800', color: '#202033', letterSpacing: -0.7 },
  subtitle: { fontSize: 15, lineHeight: 21, color: '#77778C', marginTop: 7 },
  cards: { gap: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 17, minHeight: 132, flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBox: { width: 60, height: 60, borderRadius: 19, backgroundColor: '#F0EFFD', alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1 },
  cardTitle: { fontSize: 19, lineHeight: 25, fontWeight: '700', color: '#252538' },
  cardDescription: { fontSize: 14, lineHeight: 20, color: '#7B7B8D', marginTop: 5 },
  priority: { fontSize: 12, fontWeight: '600', marginLeft: 2 },
  important: { color: '#5B65D9' },
  optional: { color: '#888899' },
  status: { fontSize: 11, fontWeight: '700', marginTop: 5 },
  allowed: { color: '#27865C' },
  denied: { color: '#C35A5A' },
  primaryButton: { marginTop: 22, minHeight: 62, borderRadius: 22, backgroundColor: '#5964DF', alignItems: 'center', justifyContent: 'center', shadowColor: '#4651CC', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 4 },
  primaryText: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },
  skipButton: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 18, marginTop: 4 },
  skipText: { color: '#5B65D9', fontSize: 14, fontWeight: '600' },
  footer: { color: '#828297', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
});
