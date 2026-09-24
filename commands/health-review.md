---
description: Audit this health/BLE React Native app for App Store / Google Play readiness, privacy (KVKK, GDPR), security of health data and medical-device-software risk
argument-hint: "[focus: store | privacy | security | regulatory | all]"
---

Run a health-app readiness review. Focus: $ARGUMENTS (default: all).

Delegate to the `health-compliance-reviewer` agent with this focus. When it returns:

1. Present the findings grouped by severity (**Blocker**: likely rejection or legal exposure; **High**; **Medium**; **Info**). Each finding needs evidence (file:line or "not found"), the risk, and a concrete fix.
2. Keep **code fixes** separate from **decisions for legal, DPO or regulatory staff**, and never present the second kind as solved by code.
3. Offer to apply the code fixes. Don't apply them without confirmation.

End with the reminder that this is an engineering review and not legal or regulatory advice.
