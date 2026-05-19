// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

const masterKey = Buffer.alloc(32, 8).toString('base64');

describe('loadConfig', () => {
  it('uses Render PORT when CUMULUS_DB_PORT is not set', () => {
    const config = loadConfig({
      CUMULUS_DB_MASTER_KEY: masterKey,
      PORT: '10000',
    });

    expect(config.port).toBe(10000);
  });

  it('lets CUMULUS_DB_PORT override PORT', () => {
    const config = loadConfig({
      CUMULUS_DB_MASTER_KEY: masterKey,
      CUMULUS_DB_PORT: '12000',
      PORT: '10000',
    });

    expect(config.port).toBe(12000);
  });

  it('keeps public agent bootstrap disabled unless explicitly enabled', () => {
    expect(loadConfig({ CUMULUS_DB_MASTER_KEY: masterKey }).publicAgentBootstrapEnabled).toBe(false);
    expect(
      loadConfig({
        CUMULUS_DB_MASTER_KEY: masterKey,
        CUMULUS_DB_PUBLIC_AGENT_BOOTSTRAP_ENABLED: 'true',
      }).publicAgentBootstrapEnabled,
    ).toBe(true);
  });

  it('treats empty env values as unset', () => {
    const config = loadConfig({
      CUMULUS_DB_MASTER_KEY: '',
      CUMULUS_DB_PORT: '',
      CUMULUS_DB_PUBLIC_URL: '',
      LOG_LEVEL: '',
      OPENAI_COMPAT_EMBEDDINGS_API_KEY: '',
      OPENAI_COMPAT_EMBEDDINGS_BASE_URL: '',
      OPENAI_COMPAT_EMBEDDINGS_MODEL: '',
      PORT: '10000',
    });

    expect(config.adminSecret).toBeNull();
    expect(config.publicUrl).toBe('http://localhost:4317');
    expect(config.port).toBe(10000);
    expect(config.embeddings).toEqual({
      baseUrl: null,
      apiKey: null,
      model: null,
    });
  });

  it('requires an explicit master key in production', () => {
    expect(() =>
      loadConfig({
        CUMULUS_DB_MASTER_KEY: '',
        NODE_ENV: 'production',
      }),
    ).toThrow('CUMULUS_DB_MASTER_KEY is required in production');
  });
});
