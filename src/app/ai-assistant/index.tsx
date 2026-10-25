import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
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

  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const sendMessage = (text: string) => {
    if (!text.trim()) return;

    const userMsg: AIMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);

    setTimeout(() => {
      let reply =
        'HealthMate AI provides general package terminology and medication literacy. For diagnosis, dosages, or personal symptoms, please consult your prescribing physician or pharmacist.';

      const lower = text.toLowerCase();
      const asksForPersonalMedicalAdvice = /\b(dose|dosage|take|taking|safe for me|side effects?|interaction\w*|pregnan\w*|symptom\w*|diagnos\w*|overdose|missed dose|stop taking)\b/.test(lower);
      if (asksForPersonalMedicalAdvice) {
        reply = 'I can’t assess your personal treatment, symptoms, dose, or medicine interactions. Do not start, stop, or change a medicine based on this offline guide. Check the leaflet for your exact product and contact your pharmacist or prescriber. If you may have taken too much medicine or have severe symptoms, seek urgent local medical help.';
      } else if (lower.includes('mg') || lower.includes('ml')) {
        reply = KNOWLEDGE_RESPONSES.mg;
      } else if (lower.includes('ingredient')) {
        reply = KNOWLEDGE_RESPONSES.ingredient;
      } else if (lower.includes('batch') || lower.includes('lot')) {
        reply = KNOWLEDGE_RESPONSES.batch;
      } else if (lower.includes('store') || lower.includes('storage')) {
        reply = KNOWLEDGE_RESPONSES.store;
      } else if (lower.includes('metformin')) {
        reply = 'I can provide only general terminology here, not confirm a medicine’s use or how you should take it. Check the patient leaflet for your exact product or ask your pharmacist or prescriber.';
      }

      const assistantMsg: AIMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    }, 700);
  };

  useEffect(() => {
    if (query) {
      sendMessage(query);
    }
  }, [query]);

  const handleNewChat = () => {
    setMessages([]);
  };

  return (
    <AppScreen contentContainerStyle={styles.container}>
      <AppHeader
        title="Medication Guide"
        subtitle="Offline medication terminology guide"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
        rightAction={
          messages.length > 0 ? (
            <TouchableOpacity
              style={styles.newChatButton}
              onPress={handleNewChat}
            >
              <Text style={styles.newChatText}>New Chat</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      {/* Safety Notice Banner */}
      <View style={styles.disclaimerBanner}>
        <Ionicons name="information-circle" size={18} color="#0788F5" />
        <Text style={styles.disclaimerText}>
          Fixed offline responses, not a live AI or verified drug database. General education only; never replace advice from your doctor or pharmacist.
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
