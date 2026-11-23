# SEDO Flowers & Gifts — Security Specification (Phase 0)

## 1. Data Invariants
1. **Catalog Isolation**: Only verified store administrators may create, update, or delete products, custom bouquet options, pricing rules, or store settings.
2. **PII Privacy**: Customer phone numbers, dates of birth, and order histories must never be readable by other customers or unauthenticated visitors.
3. **Loyalty Tamper Resistance**: Customers can read only their own loyalty card and transactions. Customers can never create, increment, or modify stamp counts or reward statuses.
4. **Order Integrity**: Orders created by authenticated users must bind `userId == request.auth.uid`, start strictly with `status == "New"`, enforce server timestamp `createdAt == request.time`, and block client-side status escalation.
5. **Terminal State Locking**: Once an order reaches `Completed` or `Cancelled`, non-admin updates are strictly rejected.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated user attempts `create` on `/products/p_hack`.
2. Signed-in customer attempts `update` on `/store_settings/public` to change `roseUnitPriceIqd` to `1`.
3. Signed-in customer A attempts `get` on `/customers/customer_B`.
4. Signed-in customer A attempts `list` on `/orders` without `where('userId', '==', uid)`.
5. Signed-in customer attempts `create` on `/orders/o1` with `userId: 'other_uid'`.
6. Signed-in customer attempts `create` on `/orders/o2` with `status: 'Completed'` (state shortcutting).
7. Signed-in customer attempts `update` on `/loyalty_cards/card_1` to set `stampsCount: 10`.
8. Signed-in customer attempts `create` on `/loyalty_transactions/tx_fake` to claim a reward.
9. User with unverified email (`email_verified: false`) matching admin email attempts write to `/products/p1`.
10. Signed-in customer attempts `update` on `/orders/o1` injecting shadow field `isPaid: true`.
11. Signed-in customer attempts `create` on `/admins/my_uid` for privilege escalation.
12. Signed-in customer attempts `create` on `/orders` with oversized 50KB `notes` string or invalid ID `../hack`.
