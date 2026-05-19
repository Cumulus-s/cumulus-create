// SPDX-License-Identifier: AGPL-3.0-only
import { detectSecret } from './secrets.js';
import type { EnvParseResult, EnvVariable } from './types.js';

const KEY_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function stripInlineComment(value: string): string {
  let single = false;
  let double = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    const prev = value[i - 1];
    if (ch === "'" && !double && prev !== '\\') single = !single;
    if (ch === '"' && !single && prev !== '\\') double = !double;
    if (ch === '#' && !single && !double && /\s/.test(prev ?? ' ')) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trimEnd();
}

function unescapeDoubleQuoted(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function parseValue(raw: string, lines: string[], startIndex: number): {
  value: string;
  quoted: EnvVariable['quoted'];
  endIndex: number;
  warning?: string;
} {
  const trimmed = stripInlineComment(raw.trim());
  if (!trimmed.startsWith('"') && !trimmed.startsWith("'")) {
    return { value: trimmed, quoted: 'none', endIndex: startIndex };
  }

  const quote = trimmed[0];
  let collected = trimmed.slice(1);
  let endIndex = startIndex;
  while (!collected.endsWith(quote) || collected.endsWith(`\\${quote}`)) {
    endIndex += 1;
    if (endIndex >= lines.length) {
      return {
        value: collected,
        quoted: quote === '"' ? 'double' : 'single',
        endIndex: endIndex - 1,
        warning: 'unterminated quoted value',
      };
    }
    collected += `\n${lines[endIndex]}`;
  }

  const withoutClose = collected.slice(0, -1);
  return {
    value: quote === '"' ? unescapeDoubleQuoted(withoutClose) : withoutClose,
    quoted: quote === '"' ? 'double' : 'single',
    endIndex,
  };
}

export function parseEnvFile(input: string): EnvParseResult {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const variables: EnvVariable[] = [];
  const warnings: string[] = [];
  const invalidLines: EnvParseResult['invalidLines'] = [];
  const seen = new Map<string, number>();
  const duplicates = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = text.match(KEY_RE);
    if (!match) {
      invalidLines.push({ line: i + 1, text, reason: 'expected KEY=value' });
      continue;
    }

    const key = match[1];
    const lineStart = i + 1;
    const parsed = parseValue(match[2], lines, i);
    i = parsed.endIndex;
    if (parsed.warning) warnings.push(`${key}: ${parsed.warning}`);
    if (seen.has(key)) duplicates.add(key);
    seen.set(key, i + 1);

    const secret = detectSecret(key, parsed.value);
    variables.push({
      key,
      value: parsed.value,
      quoted: parsed.quoted,
      lineStart,
      lineEnd: parsed.endIndex + 1,
      isLikelySecret: secret.isLikelySecret,
      reason: secret.reason,
    });
  }

  return {
    variables,
    warnings,
    invalidLines,
    duplicateKeys: [...duplicates].sort(),
    suggestedSecretKeys: variables
      .filter((item) => item.isLikelySecret)
      .map((item) => item.key),
  };
}
