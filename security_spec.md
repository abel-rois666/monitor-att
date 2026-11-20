# Security Specification — AT&T Price Monitor (Firestore)

## 1. Data Invariants

1. **Strict Owner Isolation (No PII Leakage)**: All mutable workspace collections live under `/users/{userId}` and require `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`. No user can read, list, create, update, or delete another user's profile, favorites, alert rules, or Telegram destination settings.
2. **Master Gate Parent Integrity**: Every subcollection write (`favorites`, `alertRules`, `telegramSettings`) requires that the parent workspace document `/users/{userId}` exists (`exists(...)`), preventing orphaned subcollection records.
3. **Zero Secret Storage**: Telegram Bot Tokens are never permitted as fields in `telegramSettings`. Only non-secret destination identifiers (`chatId`, `topicId`, `channelLabel`, quiet hours, and `dispatchMode`) are accepted by `hasOnly(...)`.
4. **Immutable Ownership & Temporal Integrity**: `uid`, `ownerId`, `variantId` (on favorites), and `createdAt` are strictly immutable after creation. All `createdAt` (on create) and `updatedAt` (on create/update) values must equal `request.time`.
5. **Path & Payload Hardening**: Document IDs on single-document operations must match `^[a-zA-Z0-9_\-]+$` with length `<= 128`. Every string enforces explicit `.size()` boundaries matching `firebase-blueprint.json`.
6. **Secure List Queries**: Every `allow list` explicitly checks `resource.data.ownerId == request.auth.uid` without invoking `get()` or `exists()` inside `list`. Root `/users` forbids `list` completely.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return `PERMISSION_DENIED`)

1. **Shadow Field Injection on Profile**: Creating `/users/u1` with an extra `role: "admin"` or `isVerified: true` field.
2. **Identity Spoofing on Favorite**: Creating `/users/u1/favorites/var-1` with `ownerId: "u2"` while signed in as `u1`.
3. **Unverified Email Bypass**: Creating `/users/u1/alertRules/rule-1` with `request.auth.token.email_verified == false`.
4. **Orphaned Subcollection Write**: Creating `/users/u1/favorites/var-1` before `/users/u1` exists.
5. **ID Poisoning**: Creating `/users/u1/favorites/../../../admin` or a 1,500-character document ID.
6. **Client Timestamp Tampering**: Creating `/users/u1/alertRules/rule-1` with a forged `createdAt` not equal to `request.time`.
7. **Immutable Field Mutation**: Updating `/users/u1/favorites/var-1` to change `ownerId` or `createdAt`.
8. **Value Poisoning on Allowed Update Field**: Updating `targetPriceMxn` on a favorite to a string `"free"` or negative number `-500`.
9. **Secret Exfiltration / Ghost Field on Telegram Settings**: Writing `botToken: "123:abc"` into `/users/u1/telegramSettings/default`.
10. **Invalid Singleton Setting ID**: Writing to `/users/u1/telegramSettings/malicious_doc` instead of `default`.
11. **Cross-Tenant Read/List**: Signed-in user `u2` attempting `get` or `list` on `/users/u1/alertRules`.
12. **Oversized String DoW Attack**: Writing a 50KB `notes` string into `/users/u1/favorites/var-1` exceeding `maxLength: 240`.
