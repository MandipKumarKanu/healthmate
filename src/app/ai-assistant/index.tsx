import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { aiRepository } from '../../database/repositories/aiRepository';
import { aiAssistantService } from '../../services/aiAssistantService';
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

export default function AIAssistantScreen() {
  const router = useRouter();
  const { query } = useLocalSearchParams<{ query?: string }>();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [keyModalVisible, setKeyModalVisible] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);

  // Load latest conversation from SQLite on mount
  useEffect(() => {
    const latest = aiRepository.getLatestConversation();
    if (latest && latest.messages.length > 0) {
      setConversationId(latest.id);
      setMessages(latest.messages);
    }
    aiAssistantService.getApiKey().then((key) => setHasApiKey(Boolean(key)));
  }, []);

  /** Offline fallback: fixed terminology guide, unchanged behavior. */
  const generateOfflineReply = useCallback((text: string): string => {
    const lower = text.toLowerCase();
    const asksForPersonalMedicalAdvice = /\b(dose|dosage|take|taking|safe for me|side effects?|interaction\w*|pregnan\w*|symptom\w*|diagnos\w*|overdose|missed dose|stop taking)\b/.test(lower);
    if (asksForPersonalMedicalAdvice) {
      return 'I can’t assess your personal treatment, symptoms, dose, or medicine interactions. Do not start, stop, or change a medicine based on this offline guide. Check the leaflet for your exact product and contact your pharmacist or prescriber. If you may have taken too much medicine or have severe symptoms, seek urgent local medical help.';
    }
    if (lower.includes('mg') || lower.includes('ml')) return KNOWLEDGE_RESPONSES.mg;
    if (lower.includes('ingredient')) return KNOWLEDGE_RESPONSES.ingredient;
    if (lower.includes('batch') || lower.includes('lot')) return KNOWLEDGE_RESPONSES.batch;
    if (lower.includes('store') || lower.includes('storage')) return KNOWLEDGE_RESPONSES.store;
    return 'This offline guide covers a few general medication terms only; it is not a verified drug reference. For diagnosis, doses, symptoms, or treatment decisions, contact your pharmacist or prescriber.';
  }, []);

  /** Maps a failed Gemini call to a short, honest prefix for the offline reply. */
  const offlinePrefixForError = useCallback((error: unknown): string => {
    const code = (error as { code?: string })?.code;
    switch (code) {
      case 'BAD_KEY':
        return 'Your Gemini API key was rejected, so the offline guide answered below. Reconnect a valid key from the AI key screen.\n\n';
      case 'RATE_LIMIT':
        return 'Gemini’s free-tier limit was just reached, so the offline guide answered below.\n\n';
      case 'TIMEOUT':
        return 'The AI request timed out, so the offline guide answered below.\n\n';
      default:
        return 'No network connection for live AI right now, so the offline guide answered below.\n\n';
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
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
  }, [conversationId, messages, hasApiKey, generateOfflineReply, offlinePrefixForError]);

  useEffect(() => {
    if (query) {
      sendMessage(query);
    }
  }, [query, sendMessage]);

  const handleNewChat = () => {
    const newConv = aiRepository.createConversation('Medication Q&A');
    setConversationId(newConv.id);
    setMessages([]);
  };

  return (
    <AppScreen contentContainerStyle={styles.container}>
      <Modal
        visible={keyModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setKeyModalVisible(false)}
      >
        <View style={styles.keyModalBackdrop}>
          <View style={styles.keyModalCard}>
            <Text style={styles.keyModalTitle}>Connect Gemini</Text>
            <Text style={styles.keyModalCopy}>
              Paste a Gemini API key from aistudio.google.com to enable live AI
              answers. Stored only on this device. Leave blank to cancel.
            </Text>
            <TextInput
              style={styles.keyModalInput}
              placeholder="Gemini API key"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              value={keyDraft}
              onChangeText={setKeyDraft}
            />
            {keyError ? (
              <Text style={styles.keyModalError}>{keyError}</Text>
            ) : null}
            <View style={styles.keyModalActions}>
              <TouchableOpacity
                style={styles.keyModalSecondary}
                onPress={() => {
                  setKeyModalVisible(false);
                  setKeyError(null);
                }}
              >
                <Text style={styles.keyModalSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keyModalPrimary}
                onPress={async () => {
                  setKeyError(null);
                  try {
                    await aiAssistantService.saveApiKey(keyDraft.trim());
                    setHasApiKey(true);
                    setKeyModalVisible(false);
                    setKeyDraft('');
                  } catch (error) {
                    setKeyError('Could not save the key. Try again.');
                  }
                }}
              >
                <Text style={styles.keyModalPrimaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <AppHeader
        title="Medication Guide"
        subtitle={hasApiKey ? 'Online medication guide' : 'Offline medication terminology guide'}
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
        rightAction={
          <View style={styles.headerActionsRow}>
            <TouchableOpacity
              style={styles.newChatButton}
              onPress={() => {
                setKeyDraft('');
                setKeyError(null);
                setKeyModalVisible(true);
              }}
            >
              <Text style={styles.newChatText}>
                {hasApiKey ? 'AI Key ✓' : 'Connect AI'}
              </Text>
            </TouchableOpacity>
            {messages.length > 0 ? (
              <TouchableOpacity
                style={styles.newChatButton}
                onPress={handleNewChat}
              >
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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
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
                Ask about medication label terms, active ingredients, dosage forms,
                or packaging symbols.
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
                    <Text
                      style={[
                        styles.messageText,
                        isUser ? styles.userText : styles.assistantText,
                      ]}
                    >
                      {m.content}
                    </Text>
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
        <View style={styles.inputBar}>
          <TextInput
            style={styles.chatInput}
            placeholder="Ask about a medication label..."
            placeholderTextColor={Colors.textTertiary}
            value={inputText}
            onChangeText={setInputText}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(inputText)}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !inputText.trim() && styles.sendButtonDisabled,
            ]}
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
  keyModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.screenPaddingHorizontal,
  },
  keyModalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.card,
    padding: 20,
  },
  keyModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  keyModalCopy: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 14,
  },
  keyModalInput: {
    backgroundColor: '#F0EFEF',
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  keyModalError: {
    fontSize: 12,
    color: Colors.error,
    marginBottom: 6,
  },
  keyModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  keyModalSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  keyModalSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  keyModalPrimary: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  keyModalPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
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
