# @cls/cloud

Read-only Cumulus Cloud client for local tools and dashboards.

V1 intentionally performs inventory reads only. It can prepare a safe sync
payload from local events, but it does not upload those events yet.

```ts
import { CumulusCloudClient } from "@cls/cloud";

const cloud = new CumulusCloudClient({
  baseUrl: "https://relay.cumulush.com",
  token: process.env.CUMULUS_AGENT_TOKEN,
});

const whoami = await cloud.whoami();
```

Every request in this package is `GET`. Mutation flows such as key minting,
rotation, checkout, and product creation are action cards for a future plan.
