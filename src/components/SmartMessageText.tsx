import React from 'react';
import { Alert, Linking, StyleSheet, Text, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';

type SmartPart = {
  text: string;
  kind: 'url' | 'email' | 'phone' | 'coordinates' | 'plain';
};

// A bare domain needs at least one dot and an alphabetic TLD. That catches
// `qbared.com` and `docs.example.co.uk/path` without mistaking ordinary words,
// version numbers, or IP-style numeric values for links.
const TOKEN_PATTERN = /https?:\/\/[^\s<]+|www\.[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}(?::\d{2,5})?(?:[/?#][^\s<]*)?|\b-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}\b|\+?\d[\d\s().-]{6,}\d/gi;
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
        : /^https?:\/\//i.test(token) || /^www\./i.test(token) || isBareDomain(token)
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

function isBareDomain(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{2,5})?(?:[/?#].*)?$/i.test(value);
}

export function targetForSmartPart(part: Pick<SmartPart, 'kind' | 'text'>): string | null {
  if (part.kind === 'url') return /^https?:\/\//i.test(part.text) ? part.text : `https://${part.text}`;
  if (part.kind === 'email') return `mailto:${part.text}`;
  if (part.kind === 'phone') return `tel:${part.text.replace(/[^+\d]/g, '')}`;
  if (part.kind === 'coordinates') return `geo:${part.text.replace(/\s+/g, '')}`;
  return null;
}

function formattedPhoneLabel(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return value.trim();
}

/** First web link in a message, normalized so it can be opened directly. */
export function getFirstMessageUrl(value: string): string | null {
  const part = splitSmartText(value).find((candidate) => candidate.kind === 'url');
  return part ? targetForSmartPart(part) : null;
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
        const target = targetForSmartPart(part);
        if (!target) return <React.Fragment key={`${part.text}-${index}`}>{part.text}</React.Fragment>;
        return (
          <Text
            key={`${part.kind}-${part.text}-${index}`}
            style={[styles.detected, { color: linkColor }]}
            onPress={() => Linking.openURL(target).catch(() => {})}
            onLongPress={() => {
              if (part.kind !== 'phone') return;
              const phone = part.text.replace(/[^+\d]/g, '');
              Alert.alert('Phone number', formattedPhoneLabel(part.text), [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Copy', onPress: () => { Clipboard.setStringAsync(phone).catch(() => {}); } },
                { text: 'Call', onPress: () => { Linking.openURL(`tel:${phone}`).catch(() => {}); } },
              ]);
            }}
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
