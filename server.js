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
  String(
    process.env.KAPT_SERVICE_KEY ||
      process.env.DATA_GO_KR_SERVICE_KEY ||
      readLocalServiceKey()
  ).trim();

const NOTICE_SERVICE = "https://apis.data.go.kr/1613000/ApHusBidPblAncInfoOfferServiceV2";
const RESULT_SERVICE = "https://apis.data.go.kr/1613000/ApHusBidResultNoticeInfoOfferServiceV2";
const BASIC_INFO_SERVICE = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4";

const noticeEndpoints = {
  keyword: { path: "getBidPblAncNmSearchV2", params: ["bidTitle", "searchYear"] },
  apartment: { path: "getHsmpNmSearchV2", params: ["bidKaptName", "searchYear"] },
  region: { path: "getBidAreaSearchV2", params: ["bidArea", "searchYear"] },
  method: { path: "getBidMethodSearchV2", params: ["codeWay", "searchYear"] },
  kind: { path: "getBidKndSearchV2", params: ["codeKind", "searchYear"] },
  status: { path: "getBidSttusSearchV2", params: ["bidState", "searchYear"] },
  noticeDate: { path: "getPblAncDeSearchV2", params: ["bidRegdate", "searchYear"] },
  closeDate: { path: "getBidClosDeSearchV2", params: ["bidDeadline", "searchYear"] },
  aptCode: { path: "getHsmpCdSearchV2", params: ["aptCode", "searchYear"] }
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
const aptInfoCache = new Map();
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

function parseApiResponse(raw) {
  try {
    const json = JSON.parse(raw);
    const response = json.response || json.Response || json;
    const header = response.header || {};
    const body = response.body || {};
    const rawItems = body.items?.item || body.items || response.items?.item || response.items || [];
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    return {
      resultCode: header.resultCode || response.resultCode || "",
      resultMsg: header.resultMsg || response.resultMsg || "",
      totalCount: Number(body.totalCount || response.totalCount || items.length || 0),
      pageNo: Number(body.pageNo || response.pageNo || 1),
      numOfRows: Number(body.numOfRows || response.numOfRows || items.length || 0),
      items
    };
  } catch {
    return parseXml(raw);
  }
}

function buildApiUrl(service, endpoint, query) {
  const url = new URL(`${service}/${endpoint.path}`);
  for (const [key, value] of Object.entries(query)) {
    if (key === "serviceKey") continue;
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value).trim());
    }
  }
  url.searchParams.set("pageNo", query.pageNo || "1");
  url.searchParams.set("numOfRows", query.numOfRows || "50");
  const serviceKey = String(query.serviceKey || "").trim();
  if (serviceKey) {
    const encodedKey = serviceKey.includes("%") ? serviceKey : encodeURIComponent(serviceKey);
    url.search = `?serviceKey=${encodedKey}&${url.searchParams.toString()}`;
  }
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

function findHouseholds(item) {
  const candidates = [
    "kaptdaCnt",
    "kaptDaCnt",
    "kaptDongCnt",
    "hshldCo",
    "hshldCnt",
    "householdCount",
    "households"
  ];
  for (const key of candidates) {
    if (item && item[key] !== undefined && item[key] !== null && String(item[key]).trim() !== "") {
      return String(item[key]).trim();
    }
  }
  return "";
}

async function fetchAptInfo(aptCode, serviceKey) {
  if (!aptCode) return null;
  const cached = getCached(`apt:${aptCode}`);
  if (cached) return cached;

  const url = buildApiUrl(BASIC_INFO_SERVICE, { path: "getAphusDtlInfoV4" }, {
    serviceKey,
    kaptCode: aptCode,
    aptCode,
    pageNo: 1,
    numOfRows: 1
  });
  const apiResponse = await requestUrl(url);
  const parsed = parseApiResponse(apiResponse.raw);
  const info = {
    status: apiResponse.status,
    resultCode: parsed.resultCode,
    resultMsg: parsed.resultMsg,
    households: findHouseholds(parsed.items?.[0]),
    raw: parsed.items?.[0] || null
  };
  if (apiResponse.status === 200) {
    setCached(`apt:${aptCode}`, info);
  }
  return info;
}

async function enrichItemsWithAptInfo(items, serviceKey) {
  const uniqueCodes = [...new Set(items.map((item) => item.aptCode).filter(Boolean))].slice(0, 50);
  await Promise.all(
    uniqueCodes.map(async (aptCode) => {
      try {
        const info = await fetchAptInfo(aptCode, serviceKey);
        if (info) aptInfoCache.set(aptCode, info);
      } catch {
        aptInfoCache.set(aptCode, { households: "" });
      }
    })
  );

  return items.map((item) => {
    const info = aptInfoCache.get(item.aptCode);
    if (!info) return item;
    return {
      ...item,
      households: findHouseholds(item) || info.households || "",
      aptBasicInfo: info.raw || undefined
    };
  });
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
  const parsed = parseApiResponse(apiResponse.raw);
  const enrichedItems = await enrichItemsWithAptInfo(parsed.items, serviceKey);
  const payload = {
    dataset,
    mode,
    endpoint: endpoint.path,
    requestedUrl: apiUrl.toString().replace(encodeURIComponent(serviceKey), "SERVICE_KEY").replace(serviceKey, "SERVICE_KEY"),
    status: apiResponse.status,
    cached: false,
    rawSnippet: apiResponse.status === 200 ? undefined : apiResponse.raw.slice(0, 500),
    ...parsed,
    items: enrichedItems
  };

  if (apiResponse.status === 200) {
    setCached(key, payload);
  }
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

async function handleAptDebug(res, parsedUrl) {
  const aptCode = parsedUrl.searchParams.get("aptCode");
  if (!aptCode) {
    send(res, 400, JSON.stringify({ error: "aptCode is required." }));
    return;
  }
  const info = await fetchAptInfo(aptCode, SERVICE_KEY);
  send(res, 200, JSON.stringify(info));
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
    if (parsedUrl.pathname === "/api/apt-debug") {
      await handleAptDebug(res, parsedUrl);
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
