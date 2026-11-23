import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesSource = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

test('firestore.rules enforces default-deny catch-all and rules_version 2', () => {
  assert.match(rulesSource, /rules_version\s*=\s*'2'/);
  assert.match(rulesSource, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
});

test('firestore.rules protects PII and locks loyalty card mutations to admins', () => {
  assert.match(rulesSource, /match \/customers\/\{customerId\}[\s\S]*?isVerifiedUser\(\)/);
  assert.match(rulesSource, /match \/loyalty_cards\/\{cardId\}[\s\S]*?allow create, update: if isAdmin\(\)/);
  assert.match(rulesSource, /incoming\(\)\.status == 'New'/);
  assert.match(rulesSource, /email_verified == true/);
});
