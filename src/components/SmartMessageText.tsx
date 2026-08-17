import React from 'react';
import { Linking, StyleSheet, Text, type TextStyle } from 'react-native';

type SmartPart = {
  text: string;
  kind: 'url' | 'email' | 'phone' | 'coordinates' | 'plain';
};

const TOKEN_PATTERN = /https?:\/\/[^\s<]+|www\.[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}\b|\+?\d[\d\s().-]{6,}\d/gi;
const TRAILING_PUNCTUATION = /[),.!?:;]+$/;

function splitSmartText(value: string): SmartPart[] {
  const parts: SmartPart[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(value)) !== null) {
    const raw = match[0];
    const punctuation = raw.match(TRAILING_PUNCTUATION)?.[0] ?? '';
    const token = punctuation ? raw.slice(0, -punctuation.length) : raw;

    if (match.index > cursor) {
      parts.push({ text: value.slice(cursor, match.index), kind: 'plain' });
    }
    if (token) {
      const kind: SmartPart['kind'] = token.includes('@')
        ? 'email'
        : /^https?:\/\//i.test(token) || /^www\./i.test(token)
        ? 'url'
        : /^-?\d/.test(token) && token.includes(',')
        ? 'coordinates'
        : 'phone';
      parts.push({ text: token, kind });
    }
    if (punctuation) parts.push({ text: punctuation, kind: 'plain' });
    cursor = match.index + raw.length;
  }

  if (cursor < value.length) {
    parts.push({ text: value.slice(cursor), kind: 'plain' });
  }
  return parts.length ? parts : [{ text: value, kind: 'plain' }];
}

function targetFor(part: SmartPart): string | null {
  if (part.kind === 'url') return /^https?:\/\//i.test(part.text) ? part.text : `https://${part.text}`;
  if (part.kind === 'email') return `mailto:${part.text}`;
  if (part.kind === 'phone') return `tel:${part.text.replace(/[^+\d]/g, '')}`;
  if (part.kind === 'coordinates') return `geo:${part.text.replace(/\s+/g, '')}`;
  return null;
}

export default function SmartMessageText({
  children,
  style,
  linkColor,
}: {
  children: string;
  style?: TextStyle | TextStyle[];
  linkColor: string;
}) {
  const parts = splitSmartText(children);

  return (
    <Text style={style} selectable>
      {parts.map((part, index) => {
        const target = targetFor(part);
        if (!target) return <React.Fragment key={`${part.text}-${index}`}>{part.text}</React.Fragment>;
        return (
          <Text
            key={`${part.kind}-${part.text}-${index}`}
            style={[styles.detected, { color: linkColor }]}
            onPress={() => Linking.openURL(target).catch(() => {})}
            accessibilityRole="link"
            accessibilityLabel={`Open ${part.kind}`}
          >
            {part.text}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  detected: {
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
});
