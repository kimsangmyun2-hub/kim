const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3100);
const PUBLIC_DIR = path.join(__dirname, "public");
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 15 * 60 * 1000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
const SERVICE_KEY =
  process.env.KAPT_SERVICE_KEY ||
  process.env.DATA_GO_KR_SERVICE_KEY ||
  readLocalServiceKey();

const NOTICE_SERVICE = "http://apis.data.go.kr/1613000/ApHusBidPblAncInfoOfferService1";
const RESULT_SERVICE = "http://apis.data.go.kr/1613000/ApHusBidResultNoticeInfoOfferServiceV2";

const noticeEndpoints = {
  keyword: { path: "getBidPblAncNmSearch", params: ["bidTitle", "searchYear"] },
  apartment: { path: "getHsmpNmSearch", params: ["bidKaptName", "searchYear"] },
  region: { path: "getBidAreaSearch", params: ["bidArea", "searchYear"] },
  method: { path: "getBidMethodSearch", params: ["codeWay", "searchYear"] },
  kind: { path: "getBidKndSearch", params: ["codeKind", "searchYear"] },
  status: { path: "getBidSttusSearch", params: ["bidState", "searchYear"] },
  noticeDate: { path: "getPblAncDeSearch", params: ["bidRegdate", "searchYear"] },
  closeDate: { path: "getBidClosDeSearch", params: ["bidDeadline", "searchYear"] },
  aptCode: { path: "getHsmpCdSearch", params: ["aptCode", "searchYear"] }
};

const resultEndpoints = {
  keyword: { path: "getBidPblAncNmSearchV2", params: ["bidTitle", "searchYear"] },
  apartment: { path: "getHsmpNmSearchV2", params: ["bidKaptName", "searchYear"] },
  method: { path: "getBidMethodSearchV2", params: ["codeWay", "searchYear"] },
  kind: { path: "getBidKndSearchV2", params: ["codeKind", "searchYear"] },
  status: { path: "getBidSttusSearchV2", params: ["bidState", "searchYear"] },
  noticeDate: { path: "getPblAncDeSearchV2", params: ["bidRegdate", "searchYear"] },
  closeDate: { path: "getBidClosDeSearchV2", params: ["bidDeadline", "searchYear"] },
  aptCode: { path: "getHsmpCdSearchV2", params: ["aptCode", "searchYear"] }
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const responseCache = new Map();
const rateLimit = new Map();

function readLocalServiceKey() {
  const configPath = path.join(__dirname, "config.local.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config.serviceKey || "";
  } catch {
    return "";
  }
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  res.end(body);
}

function textOf(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseXml(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml))) {
    const item = {};
    const fieldRegex = /<([^/?][^>\s]*?)>([\s\S]*?)<\/\1>/g;
    let field;
    while ((field = fieldRegex.exec(match[1]))) {
      item[field[1]] = decodeXml(field[2].trim());
    }
    items.push(item);
  }

  return {
    resultCode: textOf(xml, "resultCode"),
    resultMsg: textOf(xml, "resultMsg"),
    totalCount: Number(textOf(xml, "totalCount") || items.length || 0),
    pageNo: Number(textOf(xml, "pageNo") || 1),
    numOfRows: Number(textOf(xml, "numOfRows") || items.length || 0),
    items
  };
}

function buildApiUrl(service, endpoint, query) {
  const url = new URL(`${service}/${endpoint.path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value).trim());
    }
  }
  url.searchParams.set("pageNo", query.pageNo || "1");
  url.searchParams.set("numOfRows", query.numOfRows || "50");
  return url;
}

function requestUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "http:" ? http : https;
    client
      .get(url, (apiRes) => {
        let raw = "";
        apiRes.setEncoding("utf8");
        apiRes.on("data", (chunk) => (raw += chunk));
        apiRes.on("end", () => resolve({ status: apiRes.statusCode, raw }));
      })
      .on("error", reject);
  });
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function isRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const current = rateLimit.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > current.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  rateLimit.set(ip, current);
  return current.count > RATE_LIMIT_MAX;
}

function cacheKey(dataset, mode, query) {
  const safeQuery = { ...query };
  delete safeQuery.serviceKey;
  return JSON.stringify({ dataset, mode, query: safeQuery });
}

function getCached(key) {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCached(key, value) {
  responseCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (responseCache.size > 300) {
    const oldest = responseCache.keys().next().value;
    responseCache.delete(oldest);
  }
}

async function handleApi(req, res, parsedUrl) {
  if (isRateLimited(req)) {
    send(res, 429, JSON.stringify({ error: "Too many search requests. Please try again in one minute." }));
    return;
  }

  const params = Object.fromEntries(parsedUrl.searchParams.entries());
  const dataset = params.dataset || "notice";
  const mode = params.mode || "keyword";
  const serviceKey = SERVICE_KEY;

  if (!serviceKey) {
    send(res, 500, JSON.stringify({ error: "The server API key is not configured." }));
    return;
  }

  const endpoints = dataset === "result" ? resultEndpoints : noticeEndpoints;
  const endpoint = endpoints[mode];
  if (!endpoint) {
    send(res, 400, JSON.stringify({ error: "Unsupported search mode." }));
    return;
  }

  const query = {
    serviceKey,
    pageNo: params.pageNo || "1",
    numOfRows: params.numOfRows || "50"
  };
  for (const key of endpoint.params) {
    if (params[key]) query[key] = params[key];
  }

  const key = cacheKey(dataset, mode, query);
  const cached = getCached(key);
  if (cached) {
    send(res, 200, JSON.stringify({ ...cached, cached: true }));
    return;
  }

  const service = dataset === "result" ? RESULT_SERVICE : NOTICE_SERVICE;
  const apiUrl = buildApiUrl(service, endpoint, query);
  const apiResponse = await requestUrl(apiUrl);
  const parsed = parseXml(apiResponse.raw);
  const payload = {
    dataset,
    mode,
    endpoint: endpoint.path,
    requestedUrl: apiUrl.toString().replace(encodeURIComponent(serviceKey), "SERVICE_KEY").replace(serviceKey, "SERVICE_KEY"),
    status: apiResponse.status,
    cached: false,
    ...parsed
  };

  setCached(key, payload);
  send(res, 200, JSON.stringify(payload));
}

function handleConfig(res) {
  send(
    res,
    200,
    JSON.stringify({
      hasServiceKey: Boolean(SERVICE_KEY),
      cacheMinutes: Math.round(CACHE_TTL_MS / 60000),
      rateLimitPerMinute: RATE_LIMIT_MAX
    })
  );
}

function serveStatic(req, res, parsedUrl) {
  const safePath = parsedUrl.pathname === "/" ? "/index.html" : parsedUrl.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, data, contentTypes[path.extname(filePath)] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    if (parsedUrl.pathname === "/api/kapt") {
      await handleApi(req, res, parsedUrl);
      return;
    }
    if (parsedUrl.pathname === "/api/config") {
      handleConfig(res);
      return;
    }
    serveStatic(req, res, parsedUrl);
  } catch (error) {
    send(res, 500, JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`K-apt search app is running at http://localhost:${PORT}`);
});
