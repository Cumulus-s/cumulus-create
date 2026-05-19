// SPDX-License-Identifier: AGPL-3.0-only
const SECRET_KEY_RE = /(secret|token|api[_-]?key|access[_-]?key|private[_-]?key|password|passwd|pwd|credential|auth|bearer|webhook|signing|client[_-]?secret)/i;
const VALUE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /^sk-[A-Za-z0-9_-]{20,}$/, reason: 'looks like an API key' },
  { re: /^[A-Za-z0-9_-]{32,}$/, reason: 'long high-entropy token' },
  { re: /^-----BEGIN [A-Z ]+PRIVATE KEY-----/, reason: 'private key block' },
  { re: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, reason: 'JWT-like token' },
];

export function detectSecret(key: string | null | undefined, value: unknown): {
  isLikelySecret: boolean;
  reason: string | null;
} {
  const stringValue = String(value ?? '').trim();
  if (key && SECRET_KEY_RE.test(key)) {
    return { isLikelySecret: true, reason: `key "${key}" looks secret` };
  }
  for (const pattern of VALUE_PATTERNS) {
    if (pattern.re.test(stringValue)) {
      return { isLikelySecret: true, reason: pattern.reason };
    }
  }
  return { isLikelySecret: false, reason: null };
}

export function detectSecretKeys(values: Record<string, unknown>): {
  likelySecretKeys: string[];
  warnings: string[];
} {
  const likelySecretKeys: string[] = [];
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const result = detectSecret(key, value);
    if (result.isLikelySecret) {
      likelySecretKeys.push(key);
      warnings.push(result.reason ?? `key "${key}" might contain a secret`);
    }
  }
  return { likelySecretKeys, warnings };
}
