// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseEnvFile } from '../env-parser.js';

describe('parseEnvFile', () => {
  it('parses comments, quotes, duplicates, and likely secrets', () => {
    const parsed = parseEnvFile(`
# comment
PUBLIC_URL=https://cumulus.example
API_KEY="sk-test-123456789012345678901234"
PUBLIC_URL=https://override.example # duplicate
MULTILINE="first
second"
BAD LINE
`);

    expect(parsed.variables.map((item) => item.key)).toEqual([
      'PUBLIC_URL',
      'API_KEY',
      'PUBLIC_URL',
      'MULTILINE',
    ]);
    expect(parsed.variables.find((item) => item.key === 'API_KEY')?.isLikelySecret).toBe(true);
    expect(parsed.duplicateKeys).toEqual(['PUBLIC_URL']);
    expect(parsed.invalidLines[0]?.line).toBe(8);
    expect(parsed.variables.find((item) => item.key === 'MULTILINE')?.value).toBe('first\nsecond');
  });
});
