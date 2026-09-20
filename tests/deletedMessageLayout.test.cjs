const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/components/chat/MessageBubble.tsx'), 'utf8');

test('deleted messages retain the complete placeholder without a line limit', () => {
  assert.match(source, /<Text style=\{\[styles.deletedText,[^\n]+>🚫 This message was deleted\.<\/Text>/);
  const style = source.match(/deletedText: \{([^}]+)\}/)[1];
  assert.doesNotMatch(style, /height|lineHeight/);
});

test('bubble width is constrained at the row child, not inside the shrink-wrapped target', () => {
  assert.match(source, /<TouchableOpacity\s+style=\{styles.bubbleTouchTarget\}/);
  assert.match(source, /bubbleTouchTarget: \{ maxWidth: '80%' \}/);
  assert.doesNotMatch(source.match(/bubbleWrap: \{([^}]+)\}/)[1], /maxWidth/);
});
