const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");

const PORT = Number(process.env.PORT || 3100);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.KAPT_DATA_DIR || path.join(__dirname, "data");
const APARTMENT_DATA_FILE = process.env.KAPT_APARTMENT_DATA_FILE || "";
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
const BASIC_INFO_SERVICE = "http://apis.data.go.kr/1613000/AptBasisInfoServiceV4";

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
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const responseCache = new Map();
const aptInfoCache = new Map();
const rateLimit = new Map();
const apartmentData = loadApartmentData();

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
    const rawItems = body.items?.item || body.item || body.items || response.items?.item || response.item || response.items || [];
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

function readTextFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("euc-kr").decode(buffer);
  } catch {
    return utf8;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = cells[index] || "";
    });
    return item;
  });
}

function firstValue(item, keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null && String(item[key]).trim() !== "") {
      return String(item[key]).trim();
    }
  }
  return "";
}

function normalizeApartmentName(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function normalizeApartmentRecord(item) {
  const aptCode = firstValue(item, ["aptCode", "kaptCode", "단지코드", "K-apt단지코드", "KAPT코드", "공동주택코드"]);
  const name = firstValue(item, ["aptName", "kaptName", "apartment", "단지명", "공동주택명", "아파트명"]);
  const households = firstValue(item, ["households", "kaptdaCnt", "kaptDaCnt", "hshldCo", "hshldCnt", "세대수", "총세대수"]);
  const area = firstValue(item, ["bidArea", "sidoCode", "시도코드", "지역코드", "법정동시도코드"]);
  const address = firstValue(item, ["address", "도로명주소", "주소", "법정동주소"]);
  return {
    aptCode,
    name,
    households: households.replace(/[^0-9]/g, ""),
    area,
    address,
    raw: item
  };
}

function loadApartmentData() {
  const result = {
    loaded: false,
    source: "",
    count: 0,
    byCode: new Map(),
    byName: new Map()
  };
  const candidates = [
    APARTMENT_DATA_FILE,
    path.join(DATA_DIR, "apartments.json"),
    path.join(DATA_DIR, "apartments.csv")
  ].filter(Boolean);
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) return result;

  try {
    const text = readTextFile(filePath);
    const rows = filePath.endsWith(".json") ? JSON.parse(text) : parseCsv(text);
    const items = Array.isArray(rows) ? rows : rows.items || rows.apartments || [];
    for (const item of items) {
      const record = normalizeApartmentRecord(item);
      if (!record.aptCode && !record.name) continue;
      if (record.aptCode) result.byCode.set(record.aptCode, record);
      const nameKey = normalizeApartmentName(record.name);
      if (nameKey) result.byName.set(nameKey, record);
      result.count += 1;
    }
    result.loaded = result.count > 0;
    result.source = path.basename(filePath);
  } catch (error) {
    result.error = error.message;
  }
  return result;
}

function findApartmentRecord(item) {
  const code = String(item?.aptCode || item?.kaptCode || "").trim();
  if (code && apartmentData.byCode.has(code)) return apartmentData.byCode.get(code);

  const nameKey = normalizeApartmentName(item?.bidKaptname || item?.bidKaptName || item?.hsmpNm || item?.kaptName);
  if (nameKey && apartmentData.byName.has(nameKey)) return apartmentData.byName.get(nameKey);
  return null;
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

function extractHouseholdsFromText(text) {
  const source = String(text || "");
  const match = source.match(/([0-9,]{2,6})\s*세대/);
  return match ? match[1].replace(/,/g, "") : "";
}

async function fetchAptInfo(aptCode, serviceKey) {
  if (!aptCode) return null;
  const cached = getCached(`apt:${aptCode}`);
  if (cached) return cached;

  const baseQuery = {
    serviceKey,
    kaptCode: aptCode,
    aptCode,
    pageNo: 1,
    numOfRows: 1
  };
  const basicUrl = buildApiUrl(BASIC_INFO_SERVICE, { path: "getAphusBassInfoV4" }, baseQuery);
  const detailUrl = buildApiUrl(BASIC_INFO_SERVICE, { path: "getAphusDtlInfoV4" }, baseQuery);
  const [basicResponse, detailResponse] = await Promise.all([
    requestUrl(basicUrl),
    requestUrl(detailUrl)
  ]);
  const basicParsed = parseApiResponse(basicResponse.raw);
  const detailParsed = parseApiResponse(detailResponse.raw);
  const basicItem = basicParsed.items?.[0] || null;
  const detailItem = detailParsed.items?.[0] || null;
  const mergedItem = {
    ...(detailItem || {}),
    ...(basicItem || {})
  };
  const info = {
    status: basicResponse.status === 200 ? basicResponse.status : detailResponse.status,
    resultCode: basicParsed.resultCode || detailParsed.resultCode,
    resultMsg: basicParsed.resultMsg || detailParsed.resultMsg,
    households: findHouseholds(mergedItem),
    raw: Object.keys(mergedItem).length ? mergedItem : null
  };
  if (basicResponse.status === 200 || detailResponse.status === 200) {
    setCached(`apt:${aptCode}`, info);
  }
  return info;
}

async function enrichItemsWithAptInfo(items, serviceKey) {
  const uniqueCodes = [
    ...new Set(
      items
        .filter((item) => !findApartmentRecord(item)?.households)
        .map((item) => item.aptCode)
        .filter(Boolean)
    )
  ].slice(0, 50);
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
    const apartmentRecord = findApartmentRecord(item);
    const info = aptInfoCache.get(item.aptCode);
    const textHouseholds = extractHouseholdsFromText(item.bidContent);
    const dataHouseholds = apartmentRecord?.households || "";
    if (!info) {
      return {
        ...item,
        households: findHouseholds(item) || dataHouseholds || textHouseholds || "",
        apartmentData: apartmentRecord || undefined
      };
    }
    return {
      ...item,
      households: findHouseholds(item) || dataHouseholds || info.households || textHouseholds || "",
      apartmentData: apartmentRecord || undefined,
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
  let finalRows = pickFinalNoticeRows(enrichedItems);

finalRows = finalRows.map((r) => {
  const bidAmountText = r.낙찰금액 || r.sucsfbidPrc || '';
  const bidAmountWon = parseBidAmountToWon(bidAmountText);

  return {
    ...r,
    낙찰금액: bidAmountText || '-',
    bidAmountWon
  };
});

const amountRows = finalRows.filter((r) => typeof r.bidAmountWon === 'number');
const totalCount = finalRows.length;
const amountCount = amountRows.length;
const avgWon = amountCount
  ? Math.round(amountRows.reduce((a, c) => a + c.bidAmountWon, 0) / amountCount)
  : null;
const minWon = amountCount ? Math.min(...amountRows.map((r) => r.bidAmountWon)) : null;
const maxWon = amountCount ? Math.max(...amountRows.map((r) => r.bidAmountWon)) : null;
  const payload = {
    dataset,
    mode,
    endpoint: endpoint.path,
    requestedUrl: apiUrl.toString().replace(encodeURIComponent(serviceKey), "SERVICE_KEY").replace(serviceKey, "SERVICE_KEY"),
    status: apiResponse.status,
    cached: false,
    rawSnippet: apiResponse.status === 200 ? undefined : apiResponse.raw.slice(0, 500),
    ...parsed,
    items: finalRows
  };

payload.summary = {
  totalCount,
  amountCount,
  avgWon,
  minWon,
  maxWon
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
      rateLimitPerMinute: RATE_LIMIT_MAX,
      apartmentData: {
        loaded: apartmentData.loaded,
        source: apartmentData.source,
        count: apartmentData.count,
        error: apartmentData.error || ""
      }
    })
  );
}

function serveStatic(req, res, parsedUrl) {
  const routes = {
    "/": "/share.html",
    "/kapt": "/kapt.html",
    "/share": "/share.html",
    "/kapt-share": "/kapt-share.html"
  };
  const safePath = routes[parsedUrl.pathname] || parsedUrl.pathname;
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
     if (parsedUrl.pathname === "/api/status") {
      handleAppStatus(res);
      return;
    }

    if (parsedUrl.pathname === "/api/admin/maintenance" && req.method === "POST") {
      await handleMaintenanceToggle(req, res);
      return;
    }

    if (parsedUrl.pathname === "/api/search/local" && req.method === "GET") {
      handleLocalSearch(req, res, parsedUrl);
      return;
    }
    serveStatic(req, res, parsedUrl);
  } catch (error) {
    send(res, 500, JSON.stringify({ error: error.message }));
  }
});

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/* =========================
   통합검색 추가 기능 API
   - 유지보수(전체 접근 차단) on/off
   - 장기수선/DOCS 검색
========================= */

let MAINTENANCE_MODE = false;
const ADMIN_KEY = process.env.ADMIN_KEY || "change-this-key";

// 앱 상태 조회
function handleAppStatus(res) {
  sendJson(res, 200, { ok: true, maintenance: MAINTENANCE_MODE });
}

// 관리자: 유지보수 모드 on/off
async function handleMaintenanceToggle(req, res) {
  const body = await readJsonBody(req);
  const enabled = !!body?.enabled;
  const key = String(body?.key || "");

  if (key !== ADMIN_KEY) {
    return sendJson(res, 403, { ok: false, message: "unauthorized" });
  }

  MAINTENANCE_MODE = enabled;
  return sendJson(res, 200, { ok: true, maintenance: MAINTENANCE_MODE });
}

// 장기수선/DOCS 로컬 인덱스 (필요 시 파일명/경로 수정)
const LOCAL_INDEX = {
  longterm: [
    {
      title: "장기수선계획 수립 가이드",
      content: "수선주기 및 공종별 산정 예시",
      path: "F:/장기수선/장기수선계획_수립가이드.pdf"
    },
    {
      title: "충당금 적립률 점검표",
      content: "적립률/집행계획 점검",
      path: "F:/장기수선/충당금_적립률_점검표.xlsx"
    }
  ],
  docs: [
    {
      title: "관리규약 표준안",
      content: "규약 개정 샘플",
      path: "F:/DOCS/관리규약_표준안.docx"
    },
    {
      title: "입주자대표회의 운영 매뉴얼",
      content: "회의 운영 절차",
      path: "F:/DOCS/입주자대표회의_운영매뉴얼.pdf"
    }
  ]
};

// /api/search/local?target=longterm|docs&q=검색어
function handleLocalSearch(req, res, parsedUrl) {
  const target = String(parsedUrl.searchParams.get("target") || "").toLowerCase();
  const q = String(parsedUrl.searchParams.get("q") || "").trim().toLowerCase();

  if (!["longterm", "docs"].includes(target)) {
    return sendJson(res, 400, { ok: false, message: "invalid target" });
  }

  if (!q) {
    return sendJson(res, 200, { ok: true, items: [] });
  }

  const items = (LOCAL_INDEX[target] || []).filter((item) => {
    return (
      item.title.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q) ||
      item.path.toLowerCase().includes(q)
    );
  });

  return sendJson(res, 200, { ok: true, items });
}

function parseBidAmountToWon(value) {
  if (!value) return null;
  const raw = String(value).replace(/\s/g, '');

  if (!raw || raw === '-' || raw === '미정' || raw === '해당없음') return null;

  let text = raw.replace(/,/g, '');
  let total = 0;

  const eokMatch = text.match(/(\d+(?:\.\d+)?)억/);
  if (eokMatch) {
    total += Math.round(parseFloat(eokMatch[1]) * 100000000);
    text = text.replace(eokMatch[0], '');
  }

  const manMatch = text.match(/(\d+(?:\.\d+)?)만/);
  if (manMatch) {
    total += Math.round(parseFloat(manMatch[1]) * 10000);
    text = text.replace(manMatch[0], '');
  }

  const plain = text.replace(/[^\d]/g, '');
  if (plain) total += Number(plain);

  return total > 0 ? total : null;
}

function pickFinalNoticeRows(rows) {
  const map = new Map();

  for (const row of rows) {
    const title = String(row.공고명 || row.bidNtceNm || '').trim();
    const apt = String(row.단지명 || row.aptNm || '').trim();
    const method = String(row.입찰방법 || row.bidMthdNm || '').trim();
    const date = String(row.공고일 || row.bidDt || row.ntceDate || '').trim();

    const ts = Date.parse(date.replace(/\./g, '-')) || 0;
    const noticeNo = String(row.공고번호 || row.bidNtceNo || '').trim();
    const key = noticeNo
      ? `${noticeNo}__${method}`
      : `${title}__${apt}__${method}__${date}`;
    const current = map.get(key);

    if (!current) {
      map.set(key, { row, ts });
      continue;
    }

    if (ts > current.ts) {
      map.set(key, { row, ts });
      continue;
    }

    const currAmt = parseBidAmountToWon(current.row.낙찰금액 || current.row.sucsfbidPrc || '');
    const nextAmt = parseBidAmountToWon(row.낙찰금액 || row.sucsfbidPrc || '');
    if (ts === current.ts && nextAmt && !currAmt) {
      map.set(key, { row, ts });
    }
  }

  return Array.from(map.values()).map(v => v.row);
}

server.listen(PORT, () => {
  console.log(`K-apt search app is running at http://localhost:${PORT}`);
});
