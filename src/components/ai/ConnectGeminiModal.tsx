import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Linking,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { aiAssistantService } from '../../services/aiAssistantService';

interface ConnectGeminiModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: (key: string, action?: 'scan' | 'done') => void;
  onKeySaved?: (key: string) => void;
  onDisconnected?: () => void;
}

export function ConnectGeminiModal({
  visible,
  onClose,
  onSuccess,
  onKeySaved,
  onDisconnected,
}: ConnectGeminiModalProps) {
  const [keyDraft, setKeyDraft] = useState('');
  const [isSecure, setIsSecure] = useState(true);
  const [isLoadingKey, setIsLoadingKey] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Load the persisted key whenever the modal opens, and ignore stale reads
  // if it closes before SecureStore responds.
  useEffect(() => {
    let active = true;
    if (visible) {
      setIsLoadingKey(true);
      setError(null);
      setIsVerifying(false);
      setShowCelebration(false);
      setCopiedLink(false);

      aiAssistantService
        .getApiKey()
        .then((key) => {
          if (!active) return;
          setCurrentKey(key);
          setKeyDraft(key || '');
        })
        .catch(() => {
          if (!active) return;
          setCurrentKey(null);
          setKeyDraft('');
          setError('Could not read the saved Gemini key from secure storage. Please try again.');
        })
        .finally(() => {
          if (active) setIsLoadingKey(false);
        });
    }

    return () => {
      active = false;
    };
  }, [visible]);

  const handleOpenAiStudio = async () => {
    const url = 'https://aistudio.google.com/app/apikey';
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      }
    } catch (e) {
      console.warn('Could not open AI Studio URL:', e);
    }
  };

  const handlePasteKey = async () => {
    try {
      const clipboardContent = await Clipboard.getStringAsync();
      if (clipboardContent && clipboardContent.trim().length > 0) {
        setKeyDraft(clipboardContent.trim());
        setError(null);
      }
    } catch (e) {
      console.warn('Could not read clipboard:', e);
    }
  };

  const handleVerifyAndSave = async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) {
      setError('Please paste or enter your Gemini API key.');
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      const result = await aiAssistantService.verifyApiKey(trimmed);
      if (!result.valid) {
        setError(result.error || 'Verification failed. Please check your key.');
        setIsVerifying(false);
        return;
      }

      // Valid! Save securely
      await aiAssistantService.saveApiKey(trimmed);
      setCurrentKey(trimmed);
      onKeySaved?.(trimmed);
      setIsVerifying(false);
      setShowCelebration(true);
    } catch (err: any) {
      setIsVerifying(false);
      setError(
        err?.message || 'Verification failed. Please check your internet and try again.'
      );
    }
  };

  const handleDisconnect = async () => {
    try {
      await aiAssistantService.deleteApiKey();
      setCurrentKey(null);
      setKeyDraft('');
      setError(null);
      setShowCelebration(false);
      onDisconnected?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not remove the saved key. Please try again.');
    }
  };

  const handleFinish = (action: 'scan' | 'done') => {
    setShowCelebration(false);
    onSuccess?.(keyDraft.trim(), action);
    onClose();
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 6)}••••${key.slice(-4)}`;
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
          style={styles.keyboardContainer}
        >
          <View style={styles.card}>
            {/* Header */}
            <View style={styles.headerRow}>
              <View style={styles.headerTitleRow}>
                <View style={styles.geminiBadge}>
                  <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                </View>
                <View>
                  <Text style={styles.title}>Personal AI Setup</Text>
                  <Text style={styles.subtitle}>Google Gemini 3.5 Flash-Lite</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {showCelebration ? (
                /* Celebration View (MCQ Choice 4) */
                <View style={styles.celebrationContainer}>
                  <View style={styles.celebrationIconCircle}>
                    <Ionicons
                      name="checkmark-circle"
                      size={54}
                      color={Colors.success}
                    />
                  </View>

                  <Text style={styles.celebrationTitle}>
                    Done! API Key Setup Complete
                  </Text>
                  <Text style={styles.celebrationSubtitle}>
                    You unlocked the full potential! Your Personal AI is now
                    connected to HealthMate for high-accuracy medicine detection
                    and dosage parsing.
                  </Text>

                  <View style={styles.connectedPillRow}>
                    <View style={styles.connectedDot} />
                    <Text style={styles.connectedPillText}>
                      Connected to Gemini 3.5 Flash-Lite
                    </Text>
                  </View>

                  <View style={styles.celebrationActions}>
                    <TouchableOpacity
                      style={styles.primaryScanBtn}
                      onPress={() => handleFinish('scan')}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="scan-outline" size={18} color="#FFFFFF" />
                      <Text style={styles.primaryScanBtnText}>
                        Start First Scan
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.secondaryDoneBtn}
                      onPress={() => handleFinish('done')}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.secondaryDoneBtnText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                /* Main Configuration View */
                <>
                  {/* Status Banner */}
                  <View
                    style={[
                      styles.statusBanner,
                      currentKey
                        ? styles.statusBannerConnected
                        : styles.statusBannerNotConnected,
                    ]}
                  >
                    <View style={styles.statusBannerLeft}>
                      <View
                        style={[
                          styles.statusDot,
                          currentKey
                            ? styles.statusDotActive
                            : styles.statusDotInactive,
                        ]}
                      />
                      <Text style={styles.statusBannerText}>
                        Status:{' '}
                        <Text style={styles.statusBannerBold}>
                          {currentKey
                            ? `Connected (${maskKey(currentKey)})`
                            : 'Not Connected'}
                        </Text>
                      </Text>
                    </View>
                  </View>

                  {/* Why AI Card */}
                  <View style={styles.infoBox}>
                    <Text style={styles.infoBoxTitle}>
                      What Personal AI does:
                    </Text>
                    <View style={styles.infoBoxRow}>
                      <Ionicons
                        name="scan"
                        size={15}
                        color={Colors.primary}
                        style={{ marginTop: 2 }}
                      />
                      <Text style={styles.infoBoxText}>
                        <Text style={{ fontWeight: '600' }}>
                          Smart Packaging OCR:
                        </Text>{' '}
                        Reads noisy medicine labels to extract brand, generic
                        salt, strength, dosage form, batch, and expiry.
                      </Text>
                    </View>
                    <View style={styles.infoBoxRow}>
                      <Ionicons
                        name="shield-checkmark-outline"
                        size={15}
                        color={Colors.primary}
                        style={{ marginTop: 2 }}
                      />
                      <Text style={styles.infoBoxText}>
                        <Text style={{ fontWeight: '600' }}>Secure Storage:</Text>{' '}
                        Your key is stored securely on this phone and sent to Google
                        only when you use a Gemini feature.
                      </Text>
                    </View>
                  </View>

                  {/* Step 1: Get Key Link */}
                  <View style={styles.instructionCard}>
                    <View style={styles.instructionHeader}>
                      <Text style={styles.instructionStep}>
                        Step 1: Get free API Key
                      </Text>
                      <TouchableOpacity
                        style={styles.openLinkBtn}
                        onPress={handleOpenAiStudio}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.openLinkBtnText}>
                          Open AI Studio
                        </Text>
                        <Feather
                          name="external-link"
                          size={13}
                          color={Colors.primary}
                        />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.instructionSub}>
                      1. Tap above to open Google AI Studio in browser.{'\n'}
                      2. Sign in with Google & tap &quot;Create API Key&quot;.{'\n'}
                      3. Copy your key and paste it below.
                    </Text>
                  </View>

                  {/* Step 2: Input Field */}
                  <View style={styles.inputSection}>
                    <View style={styles.inputHeaderRow}>
                      <Text style={styles.inputLabel}>
                        Step 2: Paste Gemini API Key
                      </Text>
                      <TouchableOpacity
                        style={styles.pasteBtn}
                        onPress={handlePasteKey}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name="clipboard-outline"
                          size={14}
                          color={Colors.primary}
                        />
                        <Text style={styles.pasteBtnText}>Paste</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.inputWrapper}>
                      <TextInput
                        style={styles.textInput}
                        placeholder="AIzaSy..."
                        placeholderTextColor={Colors.textTertiary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry={isSecure}
                        value={keyDraft}
                        onChangeText={(t) => {
                          setKeyDraft(t);
                          setError(null);
                        }}
                      />
                      <TouchableOpacity
                        style={styles.eyeBtn}
                        onPress={() => setIsSecure(!isSecure)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Feather
                          name={isSecure ? 'eye' : 'eye-off'}
                          size={18}
                          color={Colors.textSecondary}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Error Alert */}
                  {error ? (
                    <View style={styles.errorAlert}>
                      <Ionicons
                        name="alert-circle"
                        size={18}
                        color={Colors.error}
                      />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  ) : null}

                  {/* Action Buttons */}
                  <View style={styles.buttonGroup}>
                    <TouchableOpacity
                      style={[
                        styles.verifyButton,
                        (!keyDraft.trim() || isVerifying) &&
                          styles.verifyButtonDisabled,
                      ]}
                      onPress={handleVerifyAndSave}
                      disabled={!keyDraft.trim() || isVerifying || isLoadingKey}
                      activeOpacity={0.8}
                    >
                      {isLoadingKey ? (
                        <>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={styles.verifyButtonText}>Loading saved key...</Text>
                        </>
                      ) : isVerifying ? (
                        <>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={styles.verifyButtonText}>
                            Verifying with Gemini...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Ionicons
                            name="shield-checkmark-outline"
                            size={18}
                            color="#FFFFFF"
                          />
                          <Text style={styles.verifyButtonText}>
                            {currentKey ? 'Update & Verify Key' : 'Verify & Connect AI'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {currentKey ? (
                      <TouchableOpacity
                        style={styles.disconnectButton}
                        onPress={handleDisconnect}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={15}
                          color={Colors.error}
                        />
                        <Text style={styles.disconnectButtonText}>
                          Disconnect AI Key
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  keyboardContainer: {
    width: '100%',
    maxWidth: 420,
  },
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    maxHeight: '90%',
    padding: Spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  geminiBadge: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  scrollContent: {
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
  },
  statusBannerConnected: {
    backgroundColor: Colors.successLight,
  },
  statusBannerNotConnected: {
    backgroundColor: '#F3F4F6',
  },
  statusBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotActive: {
    backgroundColor: Colors.success,
  },
  statusDotInactive: {
    backgroundColor: Colors.textTertiary,
  },
  statusBannerText: {
    fontSize: 13,
    color: Colors.textPrimary,
  },
  statusBannerBold: {
    fontWeight: '700',
  },
  infoBox: {
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  infoBoxTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  infoBoxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  infoBoxText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary,
  },
  instructionCard: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: '#D4E8FC',
  },
  instructionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  instructionStep: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  openLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#C3E0FA',
  },
  openLinkBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  instructionSub: {
    fontSize: 12,
    lineHeight: 18,
    color: '#284B70',
  },
  inputSection: {
    marginBottom: Spacing.md,
  },
  inputHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryLight,
  },
  pasteBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: Spacing.md,
  },
  textInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  eyeBtn: {
    padding: Spacing.xs,
  },
  errorAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.errorLight,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: '#F9D5D8',
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: Colors.errorDark,
    lineHeight: 16,
  },
  buttonGroup: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
  },
  verifyButtonDisabled: {
    backgroundColor: '#9ECDF7',
  },
  verifyButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  disconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  disconnectButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.error,
  },
  celebrationContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },
  celebrationIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  celebrationTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  celebrationSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  connectedPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.successLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    marginBottom: Spacing.xl,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  connectedPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.successDark,
  },
  celebrationActions: {
    width: '100%',
    gap: Spacing.md,
  },
  primaryScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
  },
  primaryScanBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryDoneBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
  },
  secondaryDoneBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
});
