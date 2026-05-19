// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { CumulusDbEngine } from './storage.js';
import { ALL_TOKEN_SCOPES } from './system.js';
import { issueToken } from './tokens.js';
import type { TokenIssue, TokenRecord, TokenScope } from './types.js';

type OAuthGrantType =
  | 'authorization_code'
  | 'urn:ietf:params:oauth:grant-type:device_code'
  | 'urn:ietf:params:oauth:grant-type:token-exchange';

interface PasswordlessEmailCodeRecord {
  id: string;
  email: string;
  codeHash: string;
  dbId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  state: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

interface AuthCodeRecord {
  codeHash: string;
  email: string;
  dbId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  tokenScopes: TokenScope[];
  codeChallenge: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

interface DeviceAuthorizationRecord {
  deviceCodeHash: string;
  userCode: string;
  dbId: string;
  clientId: string;
  scope: string;
  tokenScopes: TokenScope[];
  status: 'pending' | 'approved' | 'consumed';
  intervalSeconds: number;
  lastPollAtMs: number | null;
  email: string | null;
  createdAt: string;
  expiresAt: string;
}

interface AccessTokenClaims {
  tokenHash: string;
  dbId: string;
  orgId: string;
  clientId: string;
  subject: string;
  email: string | null;
  scopes: TokenScope[];
  createdAt: string;
  expiresAt: string;
}

interface TokenWriter {
  writeTokens(dbId: string, tokens: TokenRecord[]): Promise<void>;
}

export interface OAuthHttpResult {
  status: number;
  body: Record<string, unknown>;
}

export interface LocalOAuthOptions {
  issuer: string;
  publicUrl: string;
  masterKey: Buffer;
  engine: CumulusDbEngine;
}

const OIDC_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);
const LOCAL_OAUTH_ALLOWED_SCOPES = new Set<TokenScope>([
  'system:read',
  'audit:read',
  'org:read',
  'org:claim',
  'member:approve',
  'agent:create',
  'agent:disable',
  'app:create',
  'app:update',
  'token:create',
  'token:rotate_self',
  'schema:read',
  'schema:plan',
  'schema:apply_safe',
  'schema:apply_destructive',
  'schema:revert_local',
  'data:read',
  'data:write',
  'backup:create',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeEmail(value: unknown): string {
  const email = stringValue(value).trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new OAuthRequestError('invalid_request', 'valid email is required');
  return email;
}

function randomCode(): string {
  return randomInt(100000, 1000000).toString();
}

function userCode(): string {
  return randomBytes(5).toString('base64url').replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase().padEnd(8, '7');
}

function oauthNow(): string {
  return new Date().toISOString();
}

function oauthExpires(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function parseScope(
  raw: string,
  allowed: Set<TokenScope>,
): { normalizedScope: string; tokenScopes: TokenScope[]; wantsOpenId: boolean } {
  const knownScopes = new Set<TokenScope>(ALL_TOKEN_SCOPES);
  const requested = [...new Set(raw.split(/\s+/).map((scope) => scope.trim()).filter(Boolean))];
  const invalid = requested.filter((scope) => !OIDC_SCOPES.has(scope) && !knownScopes.has(scope as TokenScope));
  if (invalid.length) throw new OAuthRequestError('invalid_scope', `unknown scope: ${invalid.join(' ')}`);
  const tokenScopes = requested.filter((scope): scope is TokenScope => knownScopes.has(scope as TokenScope));
  const disallowed = tokenScopes.filter((scope) => !allowed.has(scope));
  if (disallowed.length) throw new OAuthRequestError('invalid_scope', `scope is not allowed for this grant: ${disallowed.join(' ')}`);
  return {
    normalizedScope: requested.join(' '),
    tokenScopes,
    wantsOpenId: requested.includes('openid'),
  };
}

function humanPrincipalId(email: string): string {
  return `usr_${sha256(email).slice(0, 24)}`;
}

function tokenResponse(input: {
  issue: TokenIssue;
  scopes: TokenScope[];
  claims: AccessTokenClaims;
  wantsOpenId: boolean;
  issuer: string;
  clientId: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    access_token: input.issue.token,
    token_type: 'Bearer',
    expires_in: Math.max(1, Math.floor((Date.parse(input.claims.expiresAt) - Date.now()) / 1000)),
    scope: input.scopes.join(' '),
  };
  if (input.wantsOpenId) {
    body.id_token = [
      base64urlJson({ alg: 'none', typ: 'JWT' }),
      base64urlJson({
        iss: input.issuer,
        aud: input.clientId,
        sub: input.claims.subject,
        email: input.claims.email,
        email_verified: Boolean(input.claims.email),
        org_id: input.claims.orgId,
        db_id: input.claims.dbId,
        iat: Math.floor(Date.parse(input.claims.createdAt) / 1000),
        exp: Math.floor(Date.parse(input.claims.expiresAt) / 1000),
      }),
      '',
    ].join('.');
  }
  return body;
}

class OAuthRequestError extends Error {
  constructor(
    readonly error: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class LocalOAuthProvider {
  private readonly emailCodes = new Map<string, PasswordlessEmailCodeRecord>();
  private readonly authCodes = new Map<string, AuthCodeRecord>();
  private readonly deviceCodes = new Map<string, DeviceAuthorizationRecord>();
  private readonly deviceUserCodes = new Map<string, string>();
  private readonly accessTokens = new Map<string, AccessTokenClaims>();

  constructor(private readonly options: LocalOAuthOptions) {}

  discovery(): Record<string, unknown> {
    const issuer = this.options.issuer;
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
      userinfo_endpoint: `${issuer}/oidc/userinfo`,
      response_types_supported: ['code'],
      grant_types_supported: [
        'authorization_code',
        'urn:ietf:params:oauth:grant-type:device_code',
        'urn:ietf:params:oauth:grant-type:token-exchange',
      ],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email', ...LOCAL_OAUTH_ALLOWED_SCOPES],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['none'],
    };
  }

  async authorize(input: Record<string, unknown>): Promise<OAuthHttpResult> {
    try {
      const clientId = stringValue(input.client_id);
      const redirectUri = stringValue(input.redirect_uri);
      const dbId = stringValue(input.db_id ?? input.database_id);
      const responseType = stringValue(input.response_type, 'code');
      const scope = stringValue(input.scope, 'openid email system:read org:read');
      const codeChallenge = stringValue(input.code_challenge);
      const method = stringValue(input.code_challenge_method, 'S256');
      if (!clientId) throw new OAuthRequestError('invalid_request', 'client_id is required');
      if (responseType !== 'code') throw new OAuthRequestError('unsupported_response_type', 'only response_type=code is supported');
      this.assertRedirectUri(redirectUri);
      if (!dbId) throw new OAuthRequestError('invalid_request', 'db_id is required');
      await this.options.engine.getManifest(dbId);
      if (method !== 'S256' || !codeChallenge) throw new OAuthRequestError('invalid_request', 'S256 PKCE code_challenge is required');
      const parsedScope = parseScope(scope, LOCAL_OAUTH_ALLOWED_SCOPES);
      const email = normalizeEmail(input.email ?? input.login_hint);

      if (!input.email_code || !input.email_code_id) {
        const emailCode = randomCode();
        const record: PasswordlessEmailCodeRecord = {
          id: `emc_${randomUUID().replace(/-/g, '')}`,
          email,
          codeHash: sha256(emailCode),
          dbId,
          clientId,
          redirectUri,
          scope: parsedScope.normalizedScope,
          codeChallenge,
          state: typeof input.state === 'string' ? input.state : null,
          createdAt: oauthNow(),
          expiresAt: oauthExpires(10 * 60),
          usedAt: null,
        };
        this.emailCodes.set(record.id, record);
        return {
          status: 202,
          body: {
            status: 'email_code_required',
            emailCodeId: record.id,
            emailCode,
            expiresAt: record.expiresAt,
          },
        };
      }

      const record = this.emailCodes.get(stringValue(input.email_code_id));
      if (
        !record ||
        record.usedAt ||
        Date.parse(record.expiresAt) <= Date.now() ||
        record.email !== email ||
        record.dbId !== dbId ||
        record.clientId !== clientId ||
        record.redirectUri !== redirectUri ||
        record.codeChallenge !== codeChallenge ||
        record.codeHash !== sha256(stringValue(input.email_code))
      ) {
        throw new OAuthRequestError('access_denied', 'valid email code is required');
      }
      record.usedAt = oauthNow();
      const authorizationCode = randomBytes(32).toString('base64url');
      const authRecord: AuthCodeRecord = {
        codeHash: sha256(authorizationCode),
        email,
        dbId,
        clientId,
        redirectUri,
        scope: record.scope,
        tokenScopes: parsedScope.tokenScopes,
        codeChallenge,
        createdAt: oauthNow(),
        expiresAt: oauthExpires(5 * 60),
        usedAt: null,
      };
      this.authCodes.set(authRecord.codeHash, authRecord);
      const redirectTo = new URL(redirectUri);
      redirectTo.searchParams.set('code', authorizationCode);
      if (record.state) redirectTo.searchParams.set('state', record.state);
      return {
        status: 200,
        body: {
          code: authorizationCode,
          state: record.state,
          redirectTo: redirectTo.toString(),
        },
      };
    } catch (err) {
      return this.errorResult(err);
    }
  }

  async deviceAuthorization(input: Record<string, unknown>): Promise<OAuthHttpResult> {
    try {
      const clientId = stringValue(input.client_id);
      const dbId = stringValue(input.db_id ?? input.database_id);
      const scope = stringValue(input.scope, 'openid email system:read org:read');
      if (!clientId) throw new OAuthRequestError('invalid_request', 'client_id is required');
      if (!dbId) throw new OAuthRequestError('invalid_request', 'db_id is required');
      await this.options.engine.getManifest(dbId);
      const parsedScope = parseScope(scope, LOCAL_OAUTH_ALLOWED_SCOPES);
      const deviceCode = randomBytes(32).toString('base64url');
      const code = userCode();
      const record: DeviceAuthorizationRecord = {
        deviceCodeHash: sha256(deviceCode),
        userCode: code,
        dbId,
        clientId,
        scope: parsedScope.normalizedScope,
        tokenScopes: parsedScope.tokenScopes,
        status: 'pending',
        intervalSeconds: 1,
        lastPollAtMs: null,
        email: null,
        createdAt: oauthNow(),
        expiresAt: oauthExpires(10 * 60),
      };
      this.deviceCodes.set(record.deviceCodeHash, record);
      this.deviceUserCodes.set(code, record.deviceCodeHash);
      return {
        status: 200,
        body: {
          device_code: deviceCode,
          user_code: code,
          verification_uri: `${this.options.issuer}/oauth/device`,
          verification_uri_complete: `${this.options.issuer}/oauth/device?user_code=${encodeURIComponent(code)}`,
          expires_in: 600,
          interval: record.intervalSeconds,
        },
      };
    } catch (err) {
      return this.errorResult(err);
    }
  }

  verifyDevice(input: Record<string, unknown>): OAuthHttpResult {
    try {
      const code = stringValue(input.user_code).replace(/[\s-]/g, '').toUpperCase();
      const hash = this.deviceUserCodes.get(code);
      const record = hash ? this.deviceCodes.get(hash) : null;
      if (!record || record.status !== 'pending' || Date.parse(record.expiresAt) <= Date.now()) {
        throw new OAuthRequestError('expired_token', 'device code is not pending');
      }
      const email = normalizeEmail(input.email);
      if (!input.email_code || !input.email_code_id) {
        const emailCode = randomCode();
        const emailRecord: PasswordlessEmailCodeRecord = {
          id: `emc_${randomUUID().replace(/-/g, '')}`,
          email,
          codeHash: sha256(emailCode),
          dbId: record.dbId,
          clientId: record.clientId,
          redirectUri: 'urn:ietf:wg:oauth:2.0:oob',
          scope: record.scope,
          codeChallenge: record.deviceCodeHash,
          state: null,
          createdAt: oauthNow(),
          expiresAt: oauthExpires(10 * 60),
          usedAt: null,
        };
        this.emailCodes.set(emailRecord.id, emailRecord);
        return {
          status: 202,
          body: {
            status: 'email_code_required',
            emailCodeId: emailRecord.id,
            emailCode,
            expiresAt: emailRecord.expiresAt,
          },
        };
      }
      const emailRecord = this.emailCodes.get(stringValue(input.email_code_id));
      if (
        !emailRecord ||
        emailRecord.usedAt ||
        Date.parse(emailRecord.expiresAt) <= Date.now() ||
        emailRecord.email !== email ||
        emailRecord.dbId !== record.dbId ||
        emailRecord.clientId !== record.clientId ||
        emailRecord.codeChallenge !== record.deviceCodeHash ||
        emailRecord.codeHash !== sha256(stringValue(input.email_code))
      ) {
        throw new OAuthRequestError('access_denied', 'valid email code is required');
      }
      emailRecord.usedAt = oauthNow();
      record.status = 'approved';
      record.email = email;
      record.lastPollAtMs = null;
      return {
        status: 200,
        body: {
          status: 'approved',
          dbId: record.dbId,
          email,
        },
      };
    } catch (err) {
      return this.errorResult(err);
    }
  }

  async token(input: Record<string, unknown>): Promise<OAuthHttpResult> {
    const grantType = stringValue(input.grant_type) as OAuthGrantType;
    if (grantType === 'authorization_code') return this.authorizationCodeToken(input);
    if (grantType === 'urn:ietf:params:oauth:grant-type:device_code') return this.deviceCodeToken(input);
    if (grantType === 'urn:ietf:params:oauth:grant-type:token-exchange') return this.tokenExchange(input);
    return {
      status: 400,
      body: { error: 'unsupported_grant_type', error_description: 'grant_type is not supported' },
    };
  }

  async userinfo(accessToken: string | null): Promise<OAuthHttpResult> {
    if (!accessToken) return { status: 401, body: { error: 'invalid_token' } };
    const claims = this.accessTokens.get(sha256(accessToken));
    if (!claims || Date.parse(claims.expiresAt) <= Date.now()) {
      return { status: 401, body: { error: 'invalid_token' } };
    }
    const state = await this.options.engine.getSystemState(claims.dbId);
    return {
      status: 200,
      body: {
        sub: claims.subject,
        email: claims.email,
        email_verified: Boolean(claims.email),
        org_id: state.org.id,
        org_slug: state.org.slug,
        org_status: state.org.status,
        db_id: claims.dbId,
        scope: claims.scopes.join(' '),
      },
    };
  }

  private async authorizationCodeToken(input: Record<string, unknown>): Promise<OAuthHttpResult> {
    try {
      const code = stringValue(input.code);
      const verifier = stringValue(input.code_verifier);
      const record = this.authCodes.get(sha256(code));
      if (
        !record ||
        record.usedAt ||
        Date.parse(record.expiresAt) <= Date.now() ||
        record.clientId !== stringValue(input.client_id) ||
        record.redirectUri !== stringValue(input.redirect_uri) ||
        record.codeChallenge !== s256Challenge(verifier)
      ) {
        throw new OAuthRequestError('invalid_grant', 'valid authorization code and PKCE verifier are required');
      }
      record.usedAt = oauthNow();
      const issue = await this.issueAccessToken({
        dbId: record.dbId,
        clientId: record.clientId,
        email: record.email,
        scopes: record.tokenScopes,
        kind: 'session',
      });
      const parsedScope = parseScope(record.scope, LOCAL_OAUTH_ALLOWED_SCOPES);
      return {
        status: 200,
        body: tokenResponse({
          issue,
          scopes: record.tokenScopes,
          claims: this.requiredClaims(issue.token),
          wantsOpenId: parsedScope.wantsOpenId,
          issuer: this.options.issuer,
          clientId: record.clientId,
        }),
      };
    } catch (err) {
      return this.errorResult(err);
    }
  }

  private async deviceCodeToken(input: Record<string, unknown>): Promise<OAuthHttpResult> {
    try {
      const deviceCode = stringValue(input.device_code);
      const record = this.deviceCodes.get(sha256(deviceCode));
      if (!record || record.clientId !== stringValue(input.client_id)) {
        throw new OAuthRequestError('invalid_grant', 'device code is invalid');
      }
      if (Date.parse(record.expiresAt) <= Date.now()) throw new OAuthRequestError('expired_token', 'device code expired');
      if (record.status === 'consumed') throw new OAuthRequestError('invalid_grant', 'device code already consumed');
      if (record.status === 'pending') {
        const nowMs = Date.now();
        if (record.lastPollAtMs !== null && nowMs - record.lastPollAtMs < record.intervalSeconds * 1000) {
          record.intervalSeconds += 1;
          throw new OAuthRequestError('slow_down', 'polling faster than the device interval');
        }
        record.lastPollAtMs = nowMs;
        throw new OAuthRequestError('authorization_pending', 'device authorization is still pending');
      }
      const issue = await this.issueAccessToken({
        dbId: record.dbId,
        clientId: record.clientId,
        email: record.email,
        scopes: record.tokenScopes,
        kind: 'session',
      });
      record.status = 'consumed';
      const parsedScope = parseScope(record.scope, LOCAL_OAUTH_ALLOWED_SCOPES);
      return {
        status: 200,
        body: tokenResponse({
          issue,
          scopes: record.tokenScopes,
          claims: this.requiredClaims(issue.token),
          wantsOpenId: parsedScope.wantsOpenId,
          issuer: this.options.issuer,
          clientId: record.clientId,
        }),
      };
    } catch (err) {
      return this.errorResult(err);
    }
  }

  private async tokenExchange(input: Record<string, unknown>): Promise<OAuthHttpResult> {
    try {
      const dbId = stringValue(input.db_id ?? input.database_id ?? input.resource ?? input.audience);
      const clientId = stringValue(input.client_id, 'local-token-exchange');
      const subjectToken = stringValue(input.subject_token);
      if (!dbId || !subjectToken) throw new OAuthRequestError('invalid_request', 'db_id and subject_token are required');
      const subject = await this.options.engine.authenticate(dbId, subjectToken, []);
      const requested = parseScope(stringValue(input.scope, subject.scopes.join(' ')), new Set<TokenScope>(ALL_TOKEN_SCOPES)).tokenScopes;
      const missing = requested.filter((scope) => !subject.scopes.includes(scope));
      if (missing.length) throw new OAuthRequestError('invalid_scope', `token exchange cannot add scopes: ${missing.join(' ')}`);
      const issue = await this.issueAccessToken({
        dbId,
        clientId,
        email: null,
        scopes: requested,
        kind: 'exchange',
        principalId: subject.principalId,
        principalType: subject.principalType,
      });
      return {
        status: 200,
        body: {
          ...tokenResponse({
            issue,
            scopes: requested,
            claims: this.requiredClaims(issue.token),
            wantsOpenId: false,
            issuer: this.options.issuer,
            clientId,
          }),
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        },
      };
    } catch (err) {
      return this.errorResult(err);
    }
  }

  private async issueAccessToken(input: {
    dbId: string;
    clientId: string;
    email: string | null;
    scopes: TokenScope[];
    kind: 'session' | 'exchange';
    principalId?: string;
    principalType?: TokenRecord['principalType'];
  }): Promise<TokenIssue> {
    const state = await this.options.engine.getSystemState(input.dbId);
    const principalId = input.principalId ?? (input.email ? humanPrincipalId(input.email) : `tok_${randomUUID().replace(/-/g, '')}`);
    const principalType = input.principalType ?? (input.email ? 'human' : 'system');
    const expiresAt = oauthExpires(60 * 60);
    const issued = issueToken(`oauth ${input.kind}`, input.scopes, input.kind === 'session' ? 'cu_ses' : 'cu_xchg', this.options.masterKey, {
      kind: input.kind,
      principalType,
      principalId,
      expiresAt,
    });
    const tokens = await this.options.engine.readTokens(input.dbId);
    tokens.push(issued.record);
    await (this.options.engine as unknown as TokenWriter).writeTokens(input.dbId, tokens);
    const claims: AccessTokenClaims = {
      tokenHash: sha256(issued.issue.token),
      dbId: input.dbId,
      orgId: state.org.id,
      clientId: input.clientId,
      subject: principalId,
      email: input.email,
      scopes: input.scopes,
      createdAt: oauthNow(),
      expiresAt,
    };
    this.accessTokens.set(claims.tokenHash, claims);
    return issued.issue;
  }

  private requiredClaims(accessToken: string): AccessTokenClaims {
    const claims = this.accessTokens.get(sha256(accessToken));
    if (!claims) throw new OAuthRequestError('server_error', 'access token claims were not recorded', 500);
    return claims;
  }

  private assertRedirectUri(redirectUri: string): void {
    if (!redirectUri) throw new OAuthRequestError('invalid_request', 'redirect_uri is required');
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new OAuthRequestError('invalid_request', 'redirect_uri must be https or localhost in local/dev mode');
    }
  }

  private errorResult(err: unknown): OAuthHttpResult {
    if (err instanceof OAuthRequestError) {
      return {
        status: err.status,
        body: { error: err.error, error_description: err.message },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 400,
      body: { error: 'invalid_request', error_description: message },
    };
  }
}
