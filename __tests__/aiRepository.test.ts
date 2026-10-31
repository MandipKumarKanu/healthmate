import { describe, expect, it, beforeEach } from '@jest/globals';
import { aiRepository } from '../src/database/repositories/aiRepository';

describe('AI Repository Persistence', () => {
  beforeEach(() => {
    aiRepository.clearAll();
  });

  it('creates and retrieves a conversation', () => {
    const conv = aiRepository.createConversation('Blood Pressure Questions');
    expect(conv.id).toBeDefined();
    expect(conv.title).toBe('Blood Pressure Questions');
    expect(conv.messages).toEqual([]);

    const retrieved = aiRepository.getConversationById(conv.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(conv.id);
    expect(retrieved?.title).toBe('Blood Pressure Questions');
  });

  it('adds and retrieves messages within a conversation in chronological order', () => {
    const conv = aiRepository.createConversation('Dosage Guide');

    const msg1 = aiRepository.addMessage(conv.id, {
      role: 'user',
      content: 'What is the difference between mg and ml?',
      timestamp: '2026-10-26T10:00:00.000Z',
    });

    const msg2 = aiRepository.addMessage(conv.id, {
      role: 'assistant',
      content: 'Milligrams measure mass, milliliters measure volume.',
      timestamp: '2026-10-26T10:00:01.000Z',
    });

    const messages = aiRepository.getMessages(conv.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe(msg1.content);
    expect(messages[0].role).toBe('user');
    expect(messages[1].content).toBe(msg2.content);
    expect(messages[1].role).toBe('assistant');
  });

  it('retrieves the latest conversation', () => {
    const first = aiRepository.createConversation('First Conversation');
    // small delay or sequential timestamp
    const second = aiRepository.createConversation('Latest Conversation');

    const latest = aiRepository.getLatestConversation();
    expect(latest).not.toBeNull();
    expect(latest?.id).toBe(second.id);
    expect(latest?.title).toBe('Latest Conversation');
  });

  it('deletes conversation and associated messages', () => {
    const conv = aiRepository.createConversation('To Delete');
    aiRepository.addMessage(conv.id, {
      role: 'user',
      content: 'Hello',
    });

    const deleted = aiRepository.deleteConversation(conv.id);
    expect(deleted).toBe(true);
    expect(aiRepository.getConversationById(conv.id)).toBeNull();
    expect(aiRepository.getMessages(conv.id)).toHaveLength(0);
  });
});
