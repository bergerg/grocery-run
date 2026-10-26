// Pantry Run agent endpoint: MCP (Streamable HTTP, stateless JSON) + a small REST API.
// Auth: a personal agent token (pr_...) created in the app. Send it as
//   Authorization: Bearer pr_...   (preferred)   or   X-Api-Key: pr_...   or   ?key=pr_... (only if your agent can't set headers)
// The token is checked in Postgres on every call (agent_* RPCs); this function holds no secrets.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "sb_publishable_lJIRbBa9ShGZxvB3bt5xeg_VINkg0_C";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type, accept, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

function tokenFrom(req: Request, url: URL): string {
  // Accept "Bearer pr_...", a bare "pr_..." in Authorization, X-Api-Key, or ?key=
  const raw = req.headers.get("authorization") || req.headers.get("x-api-key") || url.searchParams.get("key") || "";
  const t = raw.trim().replace(/^bearer\s+/i, "").replace(/^["']|["']$/g, "").trim();
  if (!/^pr_[0-9a-f]{48}$/.test(t)) {
    const src = req.headers.get("authorization") ? "authorization" : req.headers.get("x-api-key") ? "x-api-key" : url.searchParams.get("key") ? "query" : "none";
    console.log(JSON.stringify({ auth: "malformed", src, len: t.length, prefix: t.slice(0, 3), tail: t.slice(-4) }));
    throw new ApiError(401, "Missing or malformed agent token. Create one in the app: Household → Agent access.");
  }
  return t;
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (body?.code === "28000") { console.log(JSON.stringify({ auth: "rejected", tail: String(args.p_token ?? "").slice(-4) })); throw new ApiError(401, "Invalid or revoked token."); }
    if (body?.code === "PGRST202") throw new ApiError(501, "This action isn't enabled on the server yet.");
    throw new ApiError(r.status >= 500 ? 502 : 400, body?.message ?? "Request failed.");
  }
  return body;
}

// ---- operations shared by MCP and REST ----
type Item = string | { name: string; quantity?: string | number | null };
const normItems = (items: unknown): Item[] => {
  if (!Array.isArray(items) || !items.length) throw new ApiError(400, "`items` must be a non-empty array.");
  return items.map((i) => typeof i === "string" ? i : { name: String((i as any)?.name ?? ""), quantity: (i as any)?.quantity == null ? null : String((i as any).quantity) });
};
const normRefs = (items: unknown): string[] => {
  if (!Array.isArray(items) || !items.length) throw new ApiError(400, "`items` must be a non-empty array of item names or ids.");
  return items.map((i) => typeof i === "string" ? i : String((i as any)?.id ?? (i as any)?.name ?? ""));
};
const ops = {
  list: (tok: string) => rpc("agent_list", { p_token: tok }),
  add: (tok: string, a: any) => rpc("agent_add", { p_token: tok, p_items: normItems(a?.items) }),
  check: (tok: string, a: any) => rpc("agent_check", { p_token: tok, p_items: normRefs(a?.items), p_checked: a?.checked ?? true }),
  remove: (tok: string, a: any) => rpc("agent_remove", { p_token: tok, p_items: normRefs(a?.items) }),
  clear: (tok: string) => rpc("agent_clear_cart", { p_token: tok }),
};

// ---- MCP ----
const TOOLS = [
  { name: "list_groceries", op: "list", description: "Show the household grocery list: items still to buy and items already in the cart.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "add_groceries", op: "add",
    description: "Add items to the household grocery list. Split the user's request into separate items, e.g. 'milk, 2 dozen eggs and bread' → milk; eggs (2 dozen); bread. Items already on the list are not duplicated (a new quantity updates them); items in the cart are moved back to the list.",
    inputSchema: { type: "object", required: ["items"], additionalProperties: false, properties: {
      items: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", required: ["name"], additionalProperties: false, properties: {
        name: { type: "string", description: "Item name, short and singular-ish, e.g. 'oat milk'" },
        quantity: { type: "string", description: "Optional amount with unit, e.g. '2', '1 kg', '6 pack'" } } } } } } },
  { name: "check_off_groceries", op: "check",
    description: "Mark items as bought (in the cart), or set checked=false to put them back on the list. Refer to items by name (partial names work when unambiguous) or id from list_groceries.",
    inputSchema: { type: "object", required: ["items"], additionalProperties: false, properties: {
      items: { type: "array", minItems: 1, maxItems: 50, items: { type: "string" } },
      checked: { type: "boolean", default: true } } } },
  { name: "remove_groceries", op: "remove", description: "Delete items from the list entirely (by name or id).",
    inputSchema: { type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "array", minItems: 1, maxItems: 50, items: { type: "string" } } } },
    annotations: { destructiveHint: true } },
  { name: "clear_cart", op: "clear", description: "Delete all items that have been checked off (already bought).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { destructiveHint: true } },
] as const;

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

async function handleRpc(msg: any, tok: string): Promise<any | null> {
  const { id, method, params } = msg ?? {};
  const isNote = id === undefined || id === null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  try {
    switch (method) {
      case "initialize":
        return ok({
          protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "pantry-run", version: "1.0.0" },
          instructions: "Manages one household's shared grocery list. Use add_groceries when the user mentions things to buy or that they ran out of; list_groceries to answer what's on the list; check_off_groceries when they bought something.",
        });
      case "ping": return ok({});
      case "tools/list": return ok({ tools: TOOLS.map(({ op: _op, ...t }) => t) });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) return err(-32602, `Unknown tool: ${params?.name}`);
        try {
          const data = await (ops as any)[tool.op](tok, params?.arguments ?? {});
          return ok({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data });
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) throw e;
          return ok({ isError: true, content: [{ type: "text", text: (e as Error).message }] });
        }
      }
      default:
        if (isNote) return null; // notifications/initialized etc.
        return err(-32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e;
    return err(-32603, (e as Error).message);
  }
}

async function handleMcp(req: Request, tok: string) {
  if (req.method !== "POST") return new Response("Use POST for MCP (stateless JSON mode).", { status: 405, headers: { ...CORS, Allow: "POST" } });
  let body: any;
  try { body = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const batch = Array.isArray(body);
  const out = (await Promise.all((batch ? body : [body]).map((m: any) => handleRpc(m, tok)))).filter((x) => x !== null);
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? out : out[0]);
}

// ---- REST ----
async function handleRest(req: Request, route: string, tok: string) {
  const body = req.method === "POST" ? await req.json().catch(() => { throw new ApiError(400, "Body must be JSON."); }) : {};
  if (route === "items" && req.method === "GET") return json(await ops.list(tok));
  if (route === "items" && req.method === "POST") return json(await ops.add(tok, body));
  if (route === "check" && req.method === "POST") return json(await ops.check(tok, body));
  if (route === "remove" && req.method === "POST") return json(await ops.remove(tok, body));
  if (route === "clear" && req.method === "POST") return json(await ops.clear(tok));
  throw new ApiError(404, "Unknown route. Use GET/POST /items, POST /check, POST /remove, POST /clear, or POST /mcp.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*?pantry-agent\/?/, "").replace(/\/+$/, "");
  try {
    const tok = tokenFrom(req, url);
    if (route === "" || route === "mcp") return await handleMcp(req, tok);
    return await handleRest(req, route, tok);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    const message = e instanceof ApiError ? e.message : "Internal error";
    if (status === 500) console.error(e);
    return json({ error: message }, status);
  }
});
