import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { aiRepository } from '../../database/repositories/aiRepository';
import { aiAssistantService } from '../../services/aiAssistantService';
import { networkService } from '../../services/networkService';
import { ConnectGeminiModal } from '../../components/ai/ConnectGeminiModal';
import { FormattedAIMessage } from '../../components/ai/FormattedAIMessage';
import { AIMessage } from '../../types';

const INITIAL_SUGGESTIONS = [
  'What is the difference between mg and mL?',
  'What does an active ingredient mean?',
  'How do batch numbers work?',
  'How should I store my medicines?',
];

const KNOWLEDGE_RESPONSES: Record<string, string> = {
  mg: 'Milligrams (mg) describe mass, while milliliters (mL) describe volume. For liquid medicines, use the measuring device supplied or recommended for that product, not a household spoon.',
  ingredient:
    'An active ingredient is the actual chemical substance in a medicine that creates the therapeutic effect. Generic medicines generally contain the same active ingredient, but products can differ in formulation or inactive ingredients. Confirm the exact product with its leaflet or a pharmacist.',
  batch:
    'A batch number (or lot number) is a unique alphanumeric code assigned by the manufacturer during production. It allows pharmacies and health authorities to track specific production runs and identify medications in case of quality checks or recalls.',
  store:
    'Storage instructions vary by product. Follow the storage conditions printed on the original package or patient leaflet, including any refrigeration instructions.',
};

/** Fixed offline answers for the app's short on-medicine-panel deep links:
 *  "Explain {medicine} simply" and "Why is {medicine} prescribed?".
 *
 * These keep the offline guide useful even when the medicine has no active
 * ingredient saved locally and no live AI key is connected. They are deliberately
 * **not** a personal prescription explanation: they name the medicine and its
 * active ingredient, explain what that ingredient is for in general, and point
 * back to the prescription / leaflet / pharmacist for the real "why me".
 */
const OFFLINE_MEDICINE_ANSWERS: Readonly<Record<string, string>> = {
  explain:
    "In plain language: '${medicineName}' is ${dosageFormLabel} that contains the active ingredient ${activeIngredientLabel}. That ingredient is what makes the medicine work in the body. The exact reason it was chosen for you — and whether it's the right one — is in your prescription and patient leaflet; check that, or ask your pharmacist or prescriber.",
  why:
    "I can't tell you why this exact medicine was chosen for a specific person — that decision comes from your doctor, your symptoms, and your prescription. In general terms: '${medicineName}' is ${dosageFormLabel} with the active ingredient ${activeIngredientLabel}. Doctors prescribe medicines like this for particular conditions and doses, and only the prescription label and your prescriber can say why it's right for you. If you're unsure what it's for, ask your pharmacist or prescriber.",
};

export default function AIAssistantScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { query } = useLocalSearchParams<{ query?: string }>();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [keyModalVisible, setKeyModalVisible] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const scrollViewRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const lastAutoQueryRef = useRef<string | null>(null);

  const checkConnectivityAndKey = useCallback(async () => {
    const [online, key] = await Promise.all([
      networkService.checkInternet().catch(() => false),
      aiAssistantService.getApiKey().catch(() => null),
    ]);
    setIsOnline(online);
    setHasApiKey(Boolean(key));
  }, []);

  // Load the saved conversation once. Re-check the key and network on every focus
  // so reconnecting or a rejected key cannot leave the header in a stale state.
  useEffect(() => {
    const latest = aiRepository.getLatestConversation();
    if (latest && latest.messages.length > 0) {
      setConversationId(latest.id);
      setMessages(latest.messages);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void checkConnectivityAndKey();
    }, [checkConnectivityAndKey]),
  );

  // Keep the newest message visible when keyboard opens (WhatsApp style)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setIsKeyboardVisible(true);
      requestAnimationFrame(() => scrollViewRef.current?.scrollToEnd({ animated: true }));
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  /** Offline fallback: fixed terminology guide plus a generic explainer for the
   *  app's short deep links ("Explain X simply" / "Why is X prescribed?"). Those
   *  deep links are intentionally plain-language and personal-advice-free even
   *  offline. */
  const generateOfflineReply = useCallback((text: string): string => {
    const lower = text.toLowerCase();
    const asksForPersonalMedicalAdvice =
      /\b(dose|dosage|take|taking|safe for me|side effects?|interaction\w*|pregnan\w*|symptom\w*|diagnos\w*|overdose|missed dose|stop taking)\b/.test(
        lower,
      );
    if (asksForPersonalMedicalAdvice) {
      return 'I can’t assess your personal treatment, symptoms, dose, or medicine interactions. Do not start, stop, or change a medicine based on this offline guide. Check the leaflet for your exact product and contact your pharmacist or prescriber. If you may have taken too much medicine or have severe symptoms, seek urgent local medical help.';
    }
    if (lower.includes('mg') || lower.includes('ml')) return KNOWLEDGE_RESPONSES.mg;
    if (lower.includes('ingredient')) return KNOWLEDGE_RESPONSES.ingredient;
    if (lower.includes('batch') || lower.includes('lot')) return KNOWLEDGE_RESPONSES.batch;
    if (lower.includes('store') || lower.includes('storage')) return KNOWLEDGE_RESPONSES.store;
    if (
      lower.startsWith('explain') ||
      lower.startsWith('why is') ||
      /\bwhy prescribed\b/.test(lower)
    ) {
      const medicineNameMatch =
        text.match(/^why is (.+?) prescribed/i) ??
        text.match(/^explain (.+?) simply/i);
      const medicineName = medicineNameMatch?.[1] ?? '';
      if (medicineName.trim()) {
        const filledAnswers: string[] = Object.values(OFFLINE_MEDICINE_ANSWERS).map(
          (answer: string) => {
            const filled = answer
              .replace(/\$\{medicineName\}/g, medicineName.trim())
              .replace(/\$\{activeIngredientLabel\}/g, 'the active ingredient')
              .replace(/\$\{dosageFormLabel\}/g, 'a medicine');
            return filled;
          },
        );
        if (/\bwhy prescribed\b/.test(lower) || lower.startsWith('why is')) {
          return filledAnswers[1];
        }
        return filledAnswers[0];
      }
    }
    return 'This offline guide covers a few general medication terms only; it is not a verified drug reference. For diagnosis, doses, symptoms, or treatment decisions, contact your pharmacist or prescriber.';
  }, []);

  /** Maps a failed Gemini call to a short, honest prefix for the offline reply. */
  const offlinePrefixForError = useCallback((error: unknown): string => {
    const code = (error as { code?: string })?.code;
    switch (code) {
      case 'BAD_KEY':
        return 'Google rejected the saved Gemini API key. HealthMate disconnected it, and the offline guide answered below. Connect a new key to use live AI again.\n\n';
      case 'ACCESS_DENIED':
        return 'Google denied this project access to Gemini, so the offline guide answered below. Check the project status, API access, and key restrictions in Google AI Studio.\n\n';
      case 'MODEL_UNAVAILABLE':
        return 'The configured Gemini models are unavailable for this key, so the offline guide answered below. Check the available models and project access in Google AI Studio.\n\n';
      case 'SECURE_STORE_READ':
        return 'HealthMate could not read the saved Gemini key from secure storage, so the offline guide answered below. Open AI setup and retry before reconnecting a key.\n\n';
      case 'RATE_LIMIT':
        return 'Gemini’s free-tier limit was just reached, so the offline guide answered below.\n\n';
      case 'TIMEOUT':
        return 'The AI request timed out, so the offline guide answered below.\n\n';
      default:
        return 'No network connection for live AI right now, so the offline guide answered below.\n\n';
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      let activeConvId = conversationId;
      if (!activeConvId) {
        const title = text.trim().slice(0, 36) + (text.length > 36 ? '...' : '');
        const created = aiRepository.createConversation(title);
        activeConvId = created.id;
        setConversationId(created.id);
      }

      const userMsg: AIMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date().toISOString(),
      };

      // Persist user message to SQLite
      aiRepository.addMessage(activeConvId, userMsg);
      setMessages((prev) => [...prev, userMsg]);
      setInputText('');
      setIsTyping(true);

      let reply: string;
      let usedNetwork = false;

      if (hasApiKey) {
        try {
          const answer = await aiAssistantService.askGemini(
            text.trim(),
            messages.map((m) => ({
              // Map persisted message roles to the wires format: user|assistant
              role: m.role === 'assistant' ? 'assistant' : 'user',
              content: m.content,
            })),
          );
          reply = answer.text;
          usedNetwork = true;
        } catch (error) {
          console.warn('Gemini request failed, falling back to offline guide:', error);
          if ((error as { code?: string })?.code === 'BAD_KEY') {
            setHasApiKey(false);
            setKeyModalVisible(true);
          }
          reply = `${offlinePrefixForError(error)}${generateOfflineReply(text)}`;
        }
      } else {
        reply = generateOfflineReply(text);
      }

      const assistantMsg: AIMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      };

      // Persist assistant message to SQLite
      if (activeConvId) {
        aiRepository.addMessage(activeConvId, assistantMsg);
      }
      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    },
    [conversationId, messages, hasApiKey, generateOfflineReply, offlinePrefixForError],
  );

  useEffect(() => {
    if (!query) {
      lastAutoQueryRef.current = null;
      return;
    }
    // sendMessage depends on chat state. Track the query to avoid re-sending the
    // same deep-link prompt whenever the message list or key status changes.
    if (lastAutoQueryRef.current === query) return;
    lastAutoQueryRef.current = query;
    void sendMessage(query);
  }, [query, sendMessage]);

  const handleNewChat = () => {
    const newConv = aiRepository.createConversation('Medication Q&A');
    setConversationId(newConv.id);
    setMessages([]);
  };

  return (
    <AppScreen safeAreaEdges={['top']} contentContainerStyle={styles.container}>
      <ConnectGeminiModal
        visible={keyModalVisible}
        onClose={() => setKeyModalVisible(false)}
        onKeySaved={() => {
          setHasApiKey(true);
        }}
        onSuccess={() => {
          setHasApiKey(true);
        }}
        onDisconnected={() => {
          setHasApiKey(false);
        }}
      />

      <AppHeader
        title="Medication Guide"
        subtitle={
          hasApiKey && isOnline ? 'Online medication guide' : 'Offline medication terminology guide'
        }
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
        rightAction={
          <View style={styles.headerActionsRow}>
            {hasApiKey && isOnline ? (
              <TouchableOpacity
                style={styles.onlineBadgePill}
                onPress={() => setKeyModalVisible(true)}
                activeOpacity={0.8}
              >
                <View style={styles.onlineDot} />
                <Text style={styles.onlineBadgeText}>Online</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.offlineBadgePill}
                onPress={() => setKeyModalVisible(true)}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.statusDot,
                    hasApiKey ? styles.statusDotOffline : styles.statusDotDisconnected,
                  ]}
                />
                <Text style={styles.offlineBadgeText}>{hasApiKey ? 'Offline' : 'Connect AI'}</Text>
              </TouchableOpacity>
            )}

            {messages.length > 0 ? (
              <TouchableOpacity style={styles.newChatButton} onPress={handleNewChat}>
                <Text style={styles.newChatText}>New Chat</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />

      {/* Safety Notice Banner */}
      <View style={styles.disclaimerBanner}>
        <Ionicons name="information-circle" size={18} color="#0788F5" />
        <Text style={styles.disclaimerText}>
          {hasApiKey
            ? 'Live AI answers when the key accepts messages and the device is online; offline guide otherwise. General education only; never replace advice from your doctor or pharmacist.'
            : 'Fixed offline responses, not a live AI or verified drug database. General education only; never replace advice from your doctor or pharmacist.'}
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 60 : 36}
        style={styles.keyboardContainer}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          {messages.length === 0 ? (
            // Landing state matching section 7.I
            <View style={styles.landingContainer}>
              <View style={styles.aiIllustrationCircle}>
                <Ionicons name="sparkles" size={38} color={Colors.primary} />
              </View>
              <Text style={styles.landingHeading}>
                A little clarity,{'\n'}one question at a time.
              </Text>
              <Text style={styles.landingSubtext}>
                Ask about medication label terms, active ingredients, dosage forms, or packaging
                symbols.
              </Text>

              {/* Suggestions */}
              <View style={styles.suggestionsContainer}>
                {INITIAL_SUGGESTIONS.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={styles.suggestionChip}
                    onPress={() => sendMessage(s)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            // Messages thread
            <View style={styles.messagesList}>
              {messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.messageBubble,
                      isUser ? styles.userBubble : styles.assistantBubble,
                    ]}
                  >
                    {isUser ? (
                      <Text style={[styles.messageText, styles.userText]}>{m.content}</Text>
                    ) : (
                      <FormattedAIMessage content={m.content} />
                    )}
                  </View>
                );
              })}

              {isTyping ? (
                <View style={[styles.messageBubble, styles.assistantBubble]}>
                  <Text style={styles.assistantText}>Thinking...</Text>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>

        {/* Input Bar */}
        <View
          style={[
            styles.inputBar,
            { paddingBottom: isKeyboardVisible ? 14 : Math.max(12, insets.bottom) },
          ]}
        >
          <TextInput
            style={styles.chatInput}
            placeholder="Ask about a medication label..."
            placeholderTextColor="#64748B"
            value={inputText}
            onChangeText={setInputText}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => sendMessage(inputText)}
          />
          <TouchableOpacity
            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim()}
          >
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  newChatButton: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  newChatText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  onlineBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: Colors.successLight,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#C6F6D5',
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.success,
  },
  onlineBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.successDark,
  },
  offlineBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusDotOffline: {
    backgroundColor: Colors.warning,
  },
  statusDotDisconnected: {
    backgroundColor: Colors.textTertiary,
  },
  offlineBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  disclaimerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F4FF',
    marginHorizontal: Spacing.screenPaddingHorizontal,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    marginBottom: 8,
  },
  disclaimerText: {
    fontSize: 12,
    color: '#0369A1',
    marginLeft: 6,
    flex: 1,
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
    paddingBottom: 20,
  },
  landingContainer: {
    alignItems: 'center',
    paddingTop: 30,
  },
  aiIllustrationCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  landingHeading: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 10,
  },
  landingSubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  suggestionsContainer: {
    width: '100%',
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestionText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  messagesList: {
    paddingVertical: 10,
    gap: 12,
  },
  messageBubble: {
    maxWidth: '82%',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  userText: {
    color: '#FFFFFF',
  },
  assistantText: {
    color: Colors.textPrimary,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.screenPaddingHorizontal,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#F0EFEF',
    borderRadius: Radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.textPrimary,
    marginRight: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});
