import crypto from "node:crypto";
import fs from "node:fs";

const X_POST_URL = "https://api.x.com/2/tweets";
const MAX_POST_CHARS = 280;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function loadGitHubEvent() {
  if (process.env.RELEASE_REPO && process.env.RELEASE_VERSION && process.env.RELEASE_URL) {
    return {
      action: "published",
      release: {
        draft: false,
        prerelease: parseBoolean(process.env.RELEASE_PRERELEASE, false),
        name: process.env.RELEASE_NAME || process.env.RELEASE_VERSION,
        tag_name: process.env.RELEASE_VERSION,
        html_url: process.env.RELEASE_URL,
      },
      repository: {
        name: process.env.RELEASE_REPO.split("/").at(-1),
        full_name: process.env.RELEASE_REPO,
      },
    };
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set. In GitHub Actions this is set automatically for release events.");
  }

  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

function normalizeRelease(event) {
  const release = event.release;
  const repository = event.repository;

  if (!release || !repository) {
    throw new Error("GitHub event does not contain release and repository data.");
  }

  return {
    action: event.action,
    draft: Boolean(release.draft),
    prerelease: Boolean(release.prerelease),
    name: release.name || release.tag_name,
    version: release.tag_name || release.name,
    url: release.html_url,
    repo: repository.full_name || repository.name,
  };
}

function renderTemplate(template, release) {
  return template
    .replaceAll("{repo}", release.repo)
    .replaceAll("{version}", release.version)
    .replaceAll("{name}", release.name)
    .replaceAll("{url}", release.url)
    .replaceAll("\\n", "\n");
}

function compactWhitespace(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function fitPost(text) {
  if (text.length <= MAX_POST_CHARS) return text;

  const urlMatch = text.match(/https?:\/\/\S+$/);
  const url = urlMatch?.[0] || "";
  const suffix = url ? `\n${url}` : "";
  const allowed = MAX_POST_CHARS - suffix.length - 1;

  if (allowed < 20) {
    return text.slice(0, MAX_POST_CHARS - 1) + "…";
  }

  return `${text.slice(0, allowed).trimEnd()}…${suffix}`;
}

function percentEncode(value) {
  return encodeURIComponent(value)
    .replaceAll("!", "%21")
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");
}

function oauthHeader({ method, url, apiKey, apiSecret, accessToken, accessTokenSecret }) {
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const normalizedParams = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join("&");

  const signatureBase = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(normalizedParams),
  ].join("&");

  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(signatureBase).digest("base64");

  return `OAuth ${Object.entries({ ...oauthParams, oauth_signature: signature })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ")}`;
}

async function postToX(text) {
  const apiKey = requireEnv("X_API_KEY");
  const apiSecret = requireEnv("X_API_KEY_SECRET");
  const accessToken = requireEnv("X_ACCESS_TOKEN");
  const accessTokenSecret = requireEnv("X_ACCESS_TOKEN_SECRET");

  const response = await fetch(X_POST_URL, {
    method: "POST",
    headers: {
      Authorization: oauthHeader({
        method: "POST",
        url: X_POST_URL,
        apiKey,
        apiSecret,
        accessToken,
        accessTokenSecret,
      }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`X API request failed with ${response.status}: ${body}`);
  }

  return JSON.parse(body);
}

async function main() {
  const dryRun = parseBoolean(process.env.X_POST_DRY_RUN, false);
  const includePrereleases = parseBoolean(process.env.X_INCLUDE_PRERELEASES, true);
  const template = process.env.X_POST_TEMPLATE || "{repo} released {version}: {name}\\n{url}";
  const hashtags = process.env.X_POST_HASHTAGS || "";

  const event = loadGitHubEvent();
  const release = normalizeRelease(event);

  if (release.action && release.action !== "published") {
    console.log(`Skipping release action "${release.action}".`);
    return;
  }

  if (release.draft) {
    console.log("Skipping draft release.");
    return;
  }

  if (release.prerelease && !includePrereleases) {
    console.log("Skipping prerelease because X_INCLUDE_PRERELEASES=false.");
    return;
  }

  const text = fitPost(compactWhitespace(`${renderTemplate(template, release)}\n${hashtags}`));

  if (dryRun) {
    console.log("Dry run. This would be posted to X:");
    console.log("---");
    console.log(text);
    console.log("---");
    console.log(`Character count: ${text.length}`);
    return;
  }

  const result = await postToX(text);
  console.log(`Posted to X: https://x.com/i/web/status/${result.data.id}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
