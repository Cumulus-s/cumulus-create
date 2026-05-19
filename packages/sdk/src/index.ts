export * from "@cmls/auth";
export * from "@cmls/db";

export interface CumulusSystemClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export class CumulusSystemClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CumulusSystemClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  me() {
    return this.request("/v1/system/me");
  }

  scopes() {
    return this.request("/v1/system/scopes");
  }

  audit() {
    return this.request("/v1/system/audit");
  }

  private async request(path: string) {
    const headers = new Headers();
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
  }
}
