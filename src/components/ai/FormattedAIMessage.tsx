import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Colors } from '../../theme/colors';

interface FormattedAIMessageProps {
  content: string;
}

export function FormattedAIMessage({ content }: FormattedAIMessageProps) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <View style={styles.container}>
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          return (
            <Text key={idx} style={[styles.heading, block.level === 3 && styles.heading3]}>
              {renderInlineSpans(block.text)}
            </Text>
          );
        }

        if (block.type === 'list-item') {
          return (
            <View key={idx} style={styles.listItemRow}>
              <Text style={styles.bullet}>{block.bullet || '•'}</Text>
              <Text style={styles.listItemText}>
                {renderInlineSpans(block.text)}
              </Text>
            </View>
          );
        }

        return (
          <Text key={idx} style={styles.paragraph}>
            {renderInlineSpans(block.text)}
          </Text>
        );
      })}
    </View>
  );
}

interface Block {
  type: 'paragraph' | 'heading' | 'list-item';
  level?: number;
  bullet?: string;
  text: string;
}

function parseMarkdownBlocks(raw: string): Block[] {
  const lines = raw.split(/\r?\n/);
  const blocks: Block[] = [];
  let currentParagraph = '';

  const flushParagraph = () => {
    if (currentParagraph.trim()) {
      blocks.push({ type: 'paragraph', text: currentParagraph.trim() });
      currentParagraph = '';
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    // Heading: ### Heading or ## Heading or # Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      continue;
    }

    // Bullet List item: - item, * item, or 1. item
    const listMatch = line.match(/^([-*•]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      blocks.push({
        type: 'list-item',
        bullet: listMatch[1].includes('.') ? listMatch[1] : '•',
        text: listMatch[2],
      });
      continue;
    }

    if (currentParagraph) {
      currentParagraph += ' ' + line;
    } else {
      currentParagraph = line;
    }
  }

  flushParagraph();
  return blocks;
}

function renderInlineSpans(text: string): React.ReactNode[] {
  // Regex to match **bold** or *italic* or `code`
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <Text key={index} style={styles.bold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <Text key={index} style={styles.italic}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <Text key={index} style={styles.inlineCode}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    return <Text key={index}>{part}</Text>;
  });
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textPrimary,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 6,
    marginBottom: 2,
  },
  heading3: {
    fontSize: 15,
    fontWeight: '700',
  },
  listItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingLeft: 4,
    marginVertical: 1,
  },
  bullet: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.primary,
    fontWeight: '700',
  },
  listItemText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textPrimary,
  },
  bold: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  italic: {
    fontStyle: 'italic',
  },
  inlineCode: {
    fontFamily: 'monospace',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 4,
    borderRadius: 4,
    fontSize: 13,
    color: Colors.primaryDark,
  },
});
