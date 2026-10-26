import { getDatabase } from '../client';
import { AIConversation, AIMessage } from '../../types';

interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  timestamp: string;
}

export const aiRepository = {
  getConversations(): AIConversation[] {
    const db = getDatabase();
    const rows = db.getAllSync<ConversationRow>(
      'SELECT * FROM ai_conversations ORDER BY created_at DESC;'
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      messages: this.getMessages(r.id),
    }));
  },

  getConversationById(id: string): AIConversation | null {
    const db = getDatabase();
    const row = db.getFirstSync<ConversationRow>(
      'SELECT * FROM ai_conversations WHERE id = ?;',
      [id]
    );
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      messages: this.getMessages(row.id),
    };
  },

  getLatestConversation(): AIConversation | null {
    const db = getDatabase();
    const row = db.getFirstSync<ConversationRow>(
      'SELECT * FROM ai_conversations ORDER BY created_at DESC;'
    );
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      messages: this.getMessages(row.id),
    };
  },

  createConversation(title: string = 'Medication Q&A'): AIConversation {
    const db = getDatabase();
    const id = `conv_${Date.now()}`;
    const now = new Date().toISOString();

    db.runSync(
      'INSERT INTO ai_conversations (id, title, created_at) VALUES (?, ?, ?);',
      [id, title, now]
    );

    return {
      id,
      title,
      createdAt: now,
      messages: [],
    };
  },

  addMessage(
    conversationId: string,
    message: { id?: string; role: 'user' | 'assistant' | 'system'; content: string; timestamp?: string }
  ): AIMessage {
    const db = getDatabase();
    const id = message.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = message.timestamp || new Date().toISOString();

    db.runSync(
      'INSERT INTO ai_messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?);',
      [id, conversationId, message.role, message.content, timestamp]
    );

    return {
      id,
      role: message.role,
      content: message.content,
      timestamp,
    };
  },

  getMessages(conversationId: string): AIMessage[] {
    const db = getDatabase();
    const rows = db.getAllSync<MessageRow>(
      'SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY timestamp ASC;',
      [conversationId]
    );
    return rows.map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
      timestamp: r.timestamp,
    }));
  },

  deleteConversation(id: string): boolean {
    const db = getDatabase();
    db.runSync('DELETE FROM ai_messages WHERE conversation_id = ?;', [id]);
    const res = db.runSync('DELETE FROM ai_conversations WHERE id = ?;', [id]);
    return res.changes > 0;
  },

  clearAll(): void {
    const db = getDatabase();
    db.runSync('DELETE FROM ai_messages;');
    db.runSync('DELETE FROM ai_conversations;');
  },
};
