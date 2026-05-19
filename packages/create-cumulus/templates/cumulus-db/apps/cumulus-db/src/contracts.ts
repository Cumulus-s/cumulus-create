// SPDX-License-Identifier: AGPL-3.0-only
import { nimbusIrJsonSchema } from './nimbus-schema.js';
import { SYSTEM_SCOPE_REGISTRY } from './system.js';

export const nimbusIrJsonSchemaContract = nimbusIrJsonSchema;

const systemScopeContract = SYSTEM_SCOPE_REGISTRY.map(({ scope, label, dangerous, approvalRequired }) => ({
  scope,
  label,
  dangerous,
  approvalRequired,
}));

const systemScopeEnum = systemScopeContract.map((item) => item.scope);

const errorResponse = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string' },
  },
  additionalProperties: false,
} as const;

const bearerSecurity = [{ bearerToken: [] }];

export const systemOpenApiContract = {
  openapi: '3.1.0',
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  info: {
    title: 'Cumulus DB System API',
    version: 'system-v1',
    description: 'Provider-owned system operations for Nimbus schema planning, approvals, snapshots, audit, and grants.',
  },
  servers: [
    {
      url: '{providerUrl}',
      variables: {
        providerUrl: {
          default: 'https://your-cumulus-db-provider.example.com',
        },
      },
    },
  ],
  tags: [
    { name: 'auth', description: 'OIDC and OAuth-compatible local/dev auth operations' },
    { name: 'system', description: 'System state and audit operations' },
    { name: 'principals', description: 'Org claim, grants, passkey step-up, and agent lifecycle operations' },
    { name: 'schema', description: 'Nimbus schema planning and apply operations' },
    { name: 'snapshots', description: 'Provider-managed system snapshots' },
  ],
  paths: {
    '/.well-known/openid-configuration': {
      get: {
        tags: ['auth'],
        operationId: 'getOidcDiscovery',
        security: [],
        responses: {
          '200': {
            description: 'OIDC discovery metadata',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
    },
    '/oauth/authorize': {
      post: {
        tags: ['auth'],
        operationId: 'authorizeWithPkce',
        security: [],
        requestBody: { $ref: '#/components/requestBodies/OAuthAuthorize' },
        responses: {
          '200': { $ref: '#/components/responses/OAuthJson' },
          '202': { $ref: '#/components/responses/OAuthJson' },
          '400': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/oauth/device_authorization': {
      post: {
        tags: ['auth'],
        operationId: 'startDeviceAuthorization',
        security: [],
        requestBody: { $ref: '#/components/requestBodies/OAuthDeviceAuthorization' },
        responses: {
          '200': { $ref: '#/components/responses/OAuthJson' },
          '400': { $ref: '#/components/responses/Error' },
          '429': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/oauth/device_authorization/verify': {
      post: {
        tags: ['auth'],
        operationId: 'verifyDeviceAuthorization',
        security: [],
        requestBody: { $ref: '#/components/requestBodies/OAuthDeviceVerify' },
        responses: {
          '200': { $ref: '#/components/responses/OAuthJson' },
          '202': { $ref: '#/components/responses/OAuthJson' },
          '400': { $ref: '#/components/responses/Error' },
          '429': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/oauth/token': {
      post: {
        tags: ['auth'],
        operationId: 'mintOAuthToken',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: { type: 'object', additionalProperties: { type: 'string' } },
            },
            'application/json': {
              schema: { type: 'object', additionalProperties: true },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/OAuthJson' },
          '400': { $ref: '#/components/responses/Error' },
          '429': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/oidc/userinfo': {
      get: {
        tags: ['auth'],
        operationId: 'getUserInfo',
        security: bearerSecurity,
        responses: {
          '200': { $ref: '#/components/responses/OAuthJson' },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
      post: {
        tags: ['auth'],
        operationId: 'postUserInfo',
        security: bearerSecurity,
        responses: {
          '200': { $ref: '#/components/responses/OAuthJson' },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/scopes': {
      get: {
        tags: ['system'],
        operationId: 'listSystemScopes',
        security: [],
        responses: {
          '200': {
            description: 'Known system scopes',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['scopes'],
                  properties: {
                    scopes: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/SystemScopeInfo' },
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
        },
      },
    },
    '/v1/system/agents/bootstrap': {
      post: {
        tags: ['system'],
        operationId: 'bootstrapAgent',
        security: [{ adminKey: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  displayName: { type: 'string' },
                  humanOwnerEmail: { type: ['string', 'null'], format: 'email' },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Bootstrap database and limited agent token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentBootstrapResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/orgs/claim': {
      post: {
        tags: ['principals'],
        operationId: 'claimOrg',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dbId', 'email'],
                properties: {
                  dbId: { type: 'string', minLength: 1 },
                  email: { type: 'string', format: 'email' },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Claimed org and owner principal',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['org', 'principal'],
                  properties: {
                    org: { type: 'object', additionalProperties: true },
                    principal: { type: 'object', additionalProperties: true },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
          '429': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/grants': {
      get: {
        tags: ['principals'],
        operationId: 'listPrincipalGrants',
        security: bearerSecurity,
        parameters: [
          { $ref: '#/components/parameters/DbId' },
          {
            name: 'principalId',
            in: 'query',
            required: false,
            schema: { type: 'string', minLength: 1 },
          },
        ],
        responses: {
          '200': {
            description: 'Principal grants visible to the current system reader',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['principals'],
                  properties: {
                    principals: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/PrincipalGrants' },
                    },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
      post: {
        tags: ['principals'],
        operationId: 'updatePrincipalGrants',
        security: bearerSecurity,
        requestBody: { $ref: '#/components/requestBodies/GrantUpdate' },
        responses: {
          '200': {
            description: 'Updated principal grants',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['principal'],
                  properties: {
                    principal: { type: 'object', additionalProperties: true },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
          '429': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/passkeys/step-up': {
      post: {
        tags: ['principals'],
        operationId: 'createPasskeyStepUp',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dbId'],
                properties: {
                  dbId: { type: 'string', minLength: 1 },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Local/dev passkey step-up token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['stepUp'],
                  properties: {
                    stepUp: { type: 'object', additionalProperties: true },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
          '429': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/agents/{agentId}/disable': {
      post: {
        tags: ['principals'],
        operationId: 'disableAgent',
        security: bearerSecurity,
        parameters: [{ $ref: '#/components/parameters/AgentId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dbId'],
                properties: {
                  dbId: { type: 'string', minLength: 1 },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Disabled agent principal and revoked live tokens',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['principal', 'disabledTokenIds'],
                  properties: {
                    principal: { type: 'object', additionalProperties: true },
                    disabledTokenIds: { type: 'array', items: { type: 'string' } },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
          '429': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/agents/{agentId}/rotate': {
      post: {
        tags: ['principals'],
        operationId: 'rotateAgentToken',
        security: bearerSecurity,
        parameters: [{ $ref: '#/components/parameters/AgentId' }],
        requestBody: { $ref: '#/components/requestBodies/AgentAction' },
        responses: {
          '200': {
            description: 'Rotated active agent token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token'],
                  properties: {
                    token: { type: 'object', additionalProperties: true },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
          '429': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/agents/{agentId}/revoke': {
      post: {
        tags: ['principals'],
        operationId: 'revokeAgentTokens',
        security: bearerSecurity,
        parameters: [{ $ref: '#/components/parameters/AgentId' }],
        requestBody: { $ref: '#/components/requestBodies/AgentAction' },
        responses: {
          '200': {
            description: 'Revoked active agent tokens',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['revokedTokenIds'],
                  properties: {
                    revokedTokenIds: { type: 'array', items: { type: 'string' } },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
          '429': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/state': {
      get: {
        tags: ['system'],
        operationId: 'readSystemState',
        security: bearerSecurity,
        parameters: [{ $ref: '#/components/parameters/DbId' }],
        responses: {
          '200': {
            description: 'Public-safe system state',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['system'],
                  properties: {
                    system: { $ref: '#/components/schemas/SystemState' },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/audit': {
      get: {
        tags: ['system'],
        operationId: 'listAudit',
        security: bearerSecurity,
        parameters: [
          { $ref: '#/components/parameters/DbId' },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          },
        ],
        responses: {
          '200': {
            description: 'Audit events',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['audit'],
                  properties: {
                    audit: { type: 'array', items: { type: 'object', additionalProperties: true } },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/schema/plan': {
      post: {
        tags: ['schema'],
        operationId: 'planSchema',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dbId'],
                properties: {
                  dbId: { type: 'string', minLength: 1 },
                  source: { type: 'string' },
                  desired: { $ref: '#/components/schemas/NimbusIr' },
                  fileName: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Schema plan',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['plan'],
                  properties: {
                    plan: { $ref: '#/components/schemas/SchemaPlan' },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/Error' },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/schema/approvals': {
      post: {
        tags: ['schema'],
        operationId: 'createSchemaApproval',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dbId'],
                properties: {
                  dbId: { type: 'string', minLength: 1 },
                  planId: { type: 'string' },
                  kind: { enum: ['revert'] },
                  versionId: { type: 'string' },
                  snapshotId: { type: 'string' },
                  actorId: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Short-lived approval token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['approval'],
                  properties: {
                    approval: { $ref: '#/components/schemas/ApprovalIssue' },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/schema/apply': {
      post: {
        tags: ['schema'],
        operationId: 'applySchemaPlan',
        security: bearerSecurity,
        requestBody: { $ref: '#/components/requestBodies/PlanAction' },
        responses: {
          '200': {
            description: 'Schema apply result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['apply'],
                  properties: {
                    apply: { $ref: '#/components/schemas/SchemaApplyResult' },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/Error' },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/schema/revert': {
      post: {
        tags: ['schema'],
        operationId: 'revertSchema',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dbId', 'approvalToken'],
                properties: {
                  dbId: { type: 'string', minLength: 1 },
                  versionId: { type: 'string' },
                  snapshotId: { type: 'string' },
                  approvalToken: { type: 'string', minLength: 1 },
                  actorId: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Schema revert result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['revert'],
                  properties: {
                    revert: { $ref: '#/components/schemas/SchemaApplyResult' },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/Error' },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
    },
    '/v1/system/snapshots': {
      get: {
        tags: ['snapshots'],
        operationId: 'listSnapshots',
        security: bearerSecurity,
        parameters: [{ $ref: '#/components/parameters/DbId' }],
        responses: {
          '200': {
            description: 'Provider-managed snapshots',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['snapshots'],
                  properties: {
                    snapshots: { type: 'array', items: { $ref: '#/components/schemas/SystemSnapshot' } },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
      post: {
        tags: ['snapshots'],
        operationId: 'createSnapshot',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dbId'],
                properties: {
                  dbId: { type: 'string', minLength: 1 },
                  kind: { enum: ['pre_apply', 'manual', 'revert_point'] },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created snapshot',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['snapshot'],
                  properties: {
                    snapshot: { $ref: '#/components/schemas/SystemSnapshot' },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Error' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerToken: { type: 'http', scheme: 'bearer' },
      adminKey: { type: 'apiKey', in: 'header', name: 'x-cumulus-admin-key' },
    },
    parameters: {
      DbId: {
        name: 'dbId',
        in: 'query',
        required: true,
        schema: { type: 'string', minLength: 1 },
      },
      AgentId: {
        name: 'agentId',
        in: 'path',
        required: true,
        schema: { type: 'string', minLength: 1 },
      },
    },
    requestBodies: {
      OAuthAuthorize: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['response_type', 'client_id', 'redirect_uri', 'db_id', 'scope', 'email', 'code_challenge', 'code_challenge_method'],
              properties: {
                response_type: { const: 'code' },
                client_id: { type: 'string' },
                redirect_uri: { type: 'string' },
                db_id: { type: 'string' },
                scope: { type: 'string' },
                email: { type: 'string', format: 'email' },
                code_challenge: { type: 'string' },
                code_challenge_method: { const: 'S256' },
                state: { type: 'string' },
                email_code_id: { type: 'string' },
                email_code: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
      },
      OAuthDeviceAuthorization: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['client_id', 'db_id', 'scope'],
              properties: {
                client_id: { type: 'string' },
                db_id: { type: 'string' },
                scope: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
      },
      OAuthDeviceVerify: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['user_code', 'email'],
              properties: {
                user_code: { type: 'string' },
                email: { type: 'string', format: 'email' },
                email_code_id: { type: 'string' },
                email_code: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
      },
      GrantUpdate: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['dbId', 'principalId', 'grants'],
              properties: {
                dbId: { type: 'string', minLength: 1 },
                principalId: { type: 'string', minLength: 1 },
                grants: { type: 'array', items: { $ref: '#/components/schemas/SystemScope' } },
                actorId: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
      },
      AgentAction: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['dbId'],
              properties: {
                dbId: { type: 'string', minLength: 1 },
              },
              additionalProperties: false,
            },
          },
        },
      },
      PlanAction: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['dbId', 'planId'],
              properties: {
                dbId: { type: 'string', minLength: 1 },
                planId: { type: 'string', minLength: 1 },
                approvalToken: { type: 'string' },
                actorId: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
        },
      },
    },
    responses: {
      OAuthJson: {
        description: 'OAuth JSON response',
        content: {
          'application/json': {
            schema: { type: 'object', additionalProperties: true },
          },
        },
      },
      Error: {
        description: 'Error response',
        content: {
          'application/json': {
            schema: errorResponse,
          },
        },
      },
    },
    schemas: {
      ErrorResponse: errorResponse,
      NimbusIr: nimbusIrJsonSchema,
      SystemScope: {
        type: 'string',
        enum: systemScopeEnum,
      },
      SystemScopeInfo: {
        type: 'object',
        required: ['scope', 'label', 'dangerous', 'approvalRequired'],
        properties: {
          scope: { $ref: '#/components/schemas/SystemScope' },
          label: { type: 'string' },
          dangerous: { type: 'boolean' },
          approvalRequired: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      PrincipalGrants: {
        type: 'object',
        required: ['id', 'type', 'displayName', 'status', 'grants'],
        properties: {
          id: { type: 'string' },
          type: { enum: ['human', 'agent', 'app', 'system'] },
          displayName: { type: 'string' },
          status: { enum: ['active', 'disabled', 'pending_claim'] },
          grants: { type: 'array', items: { $ref: '#/components/schemas/SystemScope' } },
        },
        additionalProperties: false,
      },
      AgentBootstrapResponse: {
        type: 'object',
        required: ['databaseId', 'token', 'scopes'],
        properties: {
          databaseId: { type: 'string' },
          token: {
            type: 'object',
            required: ['id', 'token', 'scopes'],
            properties: {
              id: { type: 'string' },
              token: { type: 'string' },
              scopes: { type: 'array', items: { $ref: '#/components/schemas/SystemScope' } },
            },
            additionalProperties: true,
          },
          scopes: { type: 'array', items: { $ref: '#/components/schemas/SystemScope' } },
        },
        additionalProperties: true,
      },
      SystemState: {
        type: 'object',
        required: ['version', 'org', 'principals', 'approvals', 'schema'],
        properties: {
          version: { const: 1 },
          org: { type: 'object', additionalProperties: true },
          principals: { type: 'array', items: { type: 'object', additionalProperties: true } },
          approvals: { type: 'array', items: { type: 'object', additionalProperties: true } },
          schema: {
            type: 'object',
            required: ['live', 'liveHash', 'lastApplied', 'lastAppliedHash', 'plans', 'versions', 'snapshots'],
            properties: {
              live: { anyOf: [{ $ref: '#/components/schemas/NimbusIr' }, { type: 'null' }] },
              liveHash: { type: ['string', 'null'] },
              lastApplied: { anyOf: [{ $ref: '#/components/schemas/NimbusIr' }, { type: 'null' }] },
              lastAppliedHash: { type: ['string', 'null'] },
              plans: { type: 'array', items: { $ref: '#/components/schemas/SchemaPlan' } },
              versions: { type: 'array', items: { type: 'object', additionalProperties: true } },
              snapshots: { type: 'array', items: { $ref: '#/components/schemas/SystemSnapshot' } },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: true,
      },
      SchemaPlan: {
        type: 'object',
        required: ['id', 'planHash', 'desiredHash', 'desired', 'operations', 'riskLevel', 'status', 'createdAt'],
        properties: {
          id: { type: 'string' },
          planHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          desiredHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          desired: { $ref: '#/components/schemas/NimbusIr' },
          operations: { type: 'array', items: { $ref: '#/components/schemas/SchemaOperation' } },
          riskLevel: { enum: ['none', 'low', 'medium', 'high', 'destructive'] },
          status: { enum: ['planned', 'applied', 'rejected'] },
          createdAt: { type: 'string', format: 'date-time' },
          appliedAt: { type: ['string', 'null'], format: 'date-time' },
          approvalRequired: { type: 'boolean' },
          snapshotRequired: { type: 'boolean' },
          baseLiveHash: { type: ['string', 'null'] },
          baseLastAppliedHash: { type: ['string', 'null'] },
        },
        additionalProperties: true,
      },
      SchemaOperation: {
        type: 'object',
        required: ['kind', 'target', 'risk', 'summary'],
        properties: {
          kind: {
            enum: [
              'create_collection',
              'drop_collection',
              'add_field',
              'drop_field',
              'alter_field',
              'add_secret',
              'remove_secret',
              'add_index',
              'alter_index',
              'remove_index',
              'add_app',
              'alter_app',
              'remove_app',
              'add_policy',
              'alter_policy',
              'remove_policy',
              'add_backup',
              'alter_backup',
              'remove_backup',
              'add_approval',
              'alter_approval',
              'remove_approval',
              'noop',
            ],
          },
          target: { type: 'string' },
          risk: { enum: ['none', 'low', 'medium', 'high', 'destructive'] },
          summary: { type: 'string' },
        },
        additionalProperties: false,
      },
      ApprovalIssue: {
        type: 'object',
        required: ['approvalId', 'approvalToken', 'expiresAt'],
        properties: {
          approvalId: { type: 'string' },
          approvalToken: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: false,
      },
      SystemSnapshot: {
        type: 'object',
        required: ['id', 'kind', 'createdAt', 'createdByType', 'createdById', 'metadata', 'storage'],
        properties: {
          id: { type: 'string' },
          kind: { enum: ['pre_apply', 'manual', 'revert_point'] },
          createdAt: { type: 'string', format: 'date-time' },
          createdByType: { enum: ['human', 'agent', 'app', 'system'] },
          createdById: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
          storage: { const: 'provider-managed' },
        },
        additionalProperties: false,
      },
      SchemaApplyResult: {
        type: 'object',
        required: ['snapshot'],
        properties: {
          versionId: { type: 'string' },
          revertedVersionId: { type: 'string' },
          snapshot: {
            anyOf: [{ $ref: '#/components/schemas/SystemSnapshot' }, { type: 'null' }],
          },
          schema: {
            type: 'object',
            additionalProperties: true,
          },
        },
        additionalProperties: true,
      },
    },
  },
  'x-cumulus-system-scopes': systemScopeContract,
} as const;
