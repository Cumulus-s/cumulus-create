// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createHandler } from './http.js';
import { PostgresCumulusDbEngine } from './postgres-engine.js';
import { CumulusDbEngine } from './storage.js';

const config = loadConfig();
const engine =
  config.engine === 'postgres'
    ? new PostgresCumulusDbEngine({
        connectionString: config.postgres.url ?? '',
        ssl: config.postgres.ssl,
        autoMigrate: config.postgres.autoMigrate,
        masterKey: config.masterKey,
        dataDir: config.dataDir,
      })
    : new CumulusDbEngine(config.dataDir, config.masterKey);
await engine.ensureRoot();

const server = createServer(createHandler(engine, config));
server.listen(config.port, () => {
  console.log(`Cumulus Database listening on ${config.publicUrl}`);
});
