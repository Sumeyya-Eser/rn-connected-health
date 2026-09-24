---
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
tags: [compliance]
---

Review this code from our React Native blood pressure app before we launch in Türkiye and the EU next month. Just list the problems and fixes.

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import analytics from '@react-native-firebase/analytics';

export async function onReading(r: { sys: number; dia: number; pulse: number }, user: { email: string }) {
  Sentry.addBreadcrumb({ category: 'bp', message: `reading ${r.sys}/${r.dia} for ${user.email}` });
  await analytics().logEvent('bp_measured', { sys: r.sys, dia: r.dia, hypertensive: r.sys >= 140 });
  const history = JSON.parse((await AsyncStorage.getItem('bp_history')) ?? '[]');
  history.push({ ...r, at: Date.now() });
  await AsyncStorage.setItem('bp_history', JSON.stringify(history));
  if (r.sys >= 140) showAlert('You have hypertension. Please see a doctor.');
}
```
