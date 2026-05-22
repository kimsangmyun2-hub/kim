const $ = (id) => document.getElementById(id);

const codeMaps = {
  bidArea: {
    "11": "서울", "26": "부산", "27": "대구", "28": "인천", "29": "광주",
    "30": "대전", "31": "울산", "36": "세종", "41": "경기", "43": "충북",
    "44": "충남", "46": "전남", "47": "경북", "48": "경남", "50": "제주",
    "51": "강원", "52": "전북"
  },
  codeWay: { "00": "직접입찰", "01": "전자입찰" },
  codeKind: { "01": "일반경쟁", "02": "제한경쟁", "03": "지명경쟁" },
  bidState: { "1": "신규공고", "2": "수정공고", "3": "재공고" }
};

const modeConfig = {
  keyword: { label: "검색어", param: "bidTitle", placeholder: "예: 승강기, CCTV, 방수" },
  apartment: { label: "아파트명", param: "bidKaptName", placeholder: "예: 동신2단지" },
  method: { label: "입찰방법 코드", param: "codeWay", placeholder: "00 직접입찰, 01 전자입찰" },
  kind: { label: "입찰종류 코드", param: "codeKind", placeholder: "01 일반, 02 제한, 03 지명" },
  status: { label: "입찰상태 코드", param: "bidState", placeholder: "1 신규, 2 수정, 3 재공고" },
  aptCode: { label: "단지코드", param: "aptCode", placeholder: "K-apt 단지코드" }
};

let allRows = [];
let currentRows = [];
let currentPage = 1;
const pageSize = 10;

function normalizeItem(item) {
  return {
    title: item.bidTitle || item.bidPblancNm || item.pblancNm || "",
    apartment: item.bidKaptname || item.bidKaptName || item.hsmpNm || item.kaptName || "",
    households: item.households || item.kaptdaCnt || item.kaptDaCnt || item.hshldCo || item.householdCount || item.hshldCnt || item.hoCnt || "",
    area: String(item.bidArea || item.legaldongSidoCd || ""),
    kind: item.codeKind || item.bidKnd || "",
    method: item.codeWay || item.bidMethod || "",
    state: item.bidState || item.bidSttus || "",
    noticeDate: item.bidRegDate || item.bidRegdate || item.pblancDe || item.bidPblancDe || "",
    closeDate: item.bidDeadline || item.bidClosDe || "",
    amount: parseAmount(item.amount || item.bidAmount || item.sucBidAmount || item.resultAmount || item.bidResultAmount),
    fileSeq: item.bidFileSeq || "",
    content: item.bidContent || "",
    raw: item
  };
}

function label(mapName, value) {
  if (!value) return "-";
  return codeMaps[mapName][String(value)] || value;
}

function updateMode() {
  const config = modeConfig[$("mode").value];
  $("valueLabel").textContent = config.label;
  $("searchValue").placeholder = config.placeholder;
}

function setStatus(message) {
  $("statusText").textContent = message;
}

function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] || "미분류";
    counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function parseAmount(value) {
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function formatWon(value) {
  if (!value) return "-";
  if (value >= 100000000) {
    const eok = value / 100000000;
    return `${eok.toLocaleString(undefined, { maximumFractionDigits: 1 })}억원`;
  }
  if (value >= 10000) {
    const man = value / 10000;
    return `${Math.round(man).toLocaleString()}만원`;
  }
  return `${Math.round(value).toLocaleString()}원`;
}

function renderBars(id, entries, mapName) {
  const max = entries[0]?.[1] || 1;
  $(id).innerHTML =
    entries.slice(0, 8).map(([name, count]) => {
      const width = Math.max(4, Math.round((count / max) * 100));
      return `
        <div class="bar-row">
          <span title="${escapeHtml(label(mapName, name))}">${escapeHtml(label(mapName, name))}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <strong>${count.toLocaleString()}</strong>
        </div>
      `;
    }).join("") || `<p class="empty compact">표시할 데이터가 없습니다.</p>`;
}

function renderMixedBars(id, entries) {
  const max = entries[0]?.count || 1;
  $(id).innerHTML =
    entries.slice(0, 8).map((entry) => {
      const width = Math.max(4, Math.round((entry.count / max) * 100));
      return `
        <div class="bar-row">
          <span title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <strong>${entry.count.toLocaleString()}</strong>
        </div>
      `;
    }).join("") || `<p class="empty compact">표시할 데이터가 없습니다.</p>`;
}

function renderTrendBars(id, entries) {
  const max = Math.max(...entries.map((entry) => entry.average), 1);
  $(id).innerHTML =
    entries.map((entry) => {
      const width = Math.max(4, Math.round((entry.average / max) * 100));
      return `
        <div class="bar-row trend-row">
          <span title="${escapeHtml(entry.month)}">${escapeHtml(entry.month)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <strong>${escapeHtml(formatWon(entry.average))}</strong>
        </div>
      `;
    }).join("") || `<p class="empty compact">낙찰금액 데이터가 없습니다.</p>`;
}

function renderStats(rows) {
  const regionEntries = countBy(rows, "area");
  const methodEntries = [
    ...countBy(rows, "kind").map(([name, count]) => ({ label: `종류: ${label("codeKind", name)}`, count })),
    ...countBy(rows, "method").map(([name, count]) => ({ label: `방법: ${label("codeWay", name)}`, count }))
  ].sort((a, b) => b.count - a.count);
  renderBars("regionChart", regionEntries, "bidArea");
  renderMixedBars("methodChart", methodEntries);
  $("regionSummary").textContent = rows.length ? `${regionEntries.length.toLocaleString()}개 지역` : "-";
  $("methodSummary").textContent = rows.length ? `${methodEntries.length.toLocaleString()}개 항목` : "-";
  renderAmountStats(rows);
}

function renderAmountStats(rows) {
  const amounts = rows.map((row) => row.amount).filter(Boolean);
  const count = amounts.length;
  const sum = amounts.reduce((total, value) => total + value, 0);
  const average = count ? sum / count : 0;
  const min = count ? Math.min(...amounts) : 0;
  const max = count ? Math.max(...amounts) : 0;

  $("avgAmount").textContent = formatWon(average);
  $("minAmount").textContent = formatWon(min);
  $("maxAmount").textContent = formatWon(max);
  $("amountCount").textContent = count ? `${count.toLocaleString()}건` : "-";
  $("amountSummary").textContent = count
    ? `낙찰금액 ${count.toLocaleString()}건 기준`
    : "입찰결과에서 표시됩니다.";

  const months = new Map();
  for (const row of rows) {
    if (!row.amount) continue;
    const month = String(row.noticeDate || row.closeDate || "").slice(0, 7) || "미분류";
    const current = months.get(month) || { sum: 0, count: 0 };
    current.sum += row.amount;
    current.count += 1;
    months.set(month, current);
  }
  const entries = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({
      month,
      average: value.sum / value.count
    }));
  renderTrendBars("amountTrend", entries);
}

function applyRegionFilter() {
  const region = $("regionFilter").value;
  currentRows = region ? allRows.filter((row) => String(row.area) === region) : [...allRows];
  currentPage = 1;
  renderStats(currentRows);
  renderRows();
  renderPagination();
}

function renderRows() {
  const start = (currentPage - 1) * pageSize;
  const rows = currentRows.slice(start, start + pageSize);
  $("resultRows").innerHTML =
    rows.map((row) => {
      const fileUrl = row.fileSeq
        ? `https://www.k-apt.go.kr/bid/bidFileDownload.do?file_type=bid&file_num=${encodeURIComponent(row.fileSeq)}`
        : row.content && row.content.startsWith("http")
          ? row.content
          : "";
      return `
        <tr>
          <td>${escapeHtml(row.title || "-")}</td>
          <td>${escapeHtml(row.apartment || "-")}</td>
          <td>${escapeHtml(row.households || "-")}</td>
          <td>${escapeHtml(label("bidArea", row.area))}</td>
          <td>${escapeHtml(label("codeKind", row.kind))}</td>
          <td>${escapeHtml(label("codeWay", row.method))}</td>
          <td>${escapeHtml(formatWon(row.amount))}</td>
          <td>${escapeHtml(row.noticeDate || "-")}</td>
          <td>${escapeHtml(row.closeDate || "-")}</td>
          <td>${fileUrl ? `<a href="${fileUrl}" target="_blank" rel="noreferrer">열기</a>` : "-"}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="10" class="empty">검색 결과가 없습니다.</td></tr>`;
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(currentRows.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  $("pageInfo").textContent = `${currentPage.toLocaleString()} / ${totalPages.toLocaleString()}`;
  $("prevPageBtn").disabled = currentPage <= 1;
  $("nextPageBtn").disabled = currentPage >= totalPages;
}

function movePage(direction) {
  const totalPages = Math.max(1, Math.ceil(currentRows.length / pageSize));
  currentPage = Math.min(totalPages, Math.max(1, currentPage + direction));
  renderRows();
  renderPagination();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function search() {
  const mode = $("mode").value;
  const config = modeConfig[mode];
  const params = new URLSearchParams({
    dataset: $("dataset").value,
    mode,
    searchYear: $("searchYear").value,
    numOfRows: $("numOfRows").value,
    pageNo: "1"
  });
  params.set(config.param, $("searchValue").value.trim());

  const householdMin = $("householdMin")?.value?.trim();
  const householdMax = $("householdMax")?.value?.trim();
  
  if (householdMin && householdMax && Number(householdMin) > Number(householdMax)) {
    setStatus("세대수 최소값이 최대값보다 큽니다.");
    return;
  }
  
  if (householdMin) params.set("householdMin", householdMin);
  if (householdMax) params.set("householdMax", householdMax);

  setStatus("K-apt API를 조회하고 있습니다.");
  $("searchBtn").disabled = true;

  try {
    const response = await fetch(`/api/kapt?${params}`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "조회 중 오류가 발생했습니다.");
    allRows = (data.items || []).map(normalizeItem);
    applyRegionFilter();
    const cacheText = data.cached ? "저장된 검색 결과를 사용했습니다." : "K-apt API에서 새로 조회했습니다.";
    const apiStatus = data.status && data.status !== 200 ? ` · API 상태: ${data.status}` : "";
    const apiMessage = data.rawSnippet ? ` · 원문 오류: ${data.rawSnippet.trim()}` : "";
    const householdNote = currentRows.some((row) => row.households)
      ? ""
      : " · 세대수 정보를 찾지 못한 단지가 있습니다.";
    const filterText = $("regionFilter").value ? ` · 지역 필터: ${label("bidArea", $("regionFilter").value)} ${currentRows.length.toLocaleString()}건` : "";
    setStatus(`${data.endpoint} 기준 ${allRows.length.toLocaleString()}건을 불러왔습니다. 전체 건수: ${(data.totalCount || 0).toLocaleString()}${filterText} · ${cacheText}${apiStatus}${apiMessage}${householdNote}`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    $("searchBtn").disabled = false;
  }
}

function clearAll() {
  allRows = [];
  currentRows = [];
  currentPage = 1;
  renderStats(currentRows);
  renderRows();
  renderPagination();
  setStatus("초기화했습니다.");
}

function exportCsv() {
  if (!currentRows.length) {
    setStatus("내보낼 검색 결과가 없습니다.");
    return;
  }
  const header = ["공고명", "단지명", "세대수", "지역", "입찰종류", "입찰방법", "낙찰금액", "공고일", "마감일"];
  const lines = currentRows.map((row) =>
    [row.title, row.apartment, row.households, label("bidArea", row.area), label("codeKind", row.kind), label("codeWay", row.method), row.amount || "", row.noticeDate, row.closeDate]
      .map((value) => `"${String(value || "").replace(/"/g, '""')}"`)
      .join(",")
  );
  const blob = new Blob(["\ufeff" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kapt-search-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

$("mode").addEventListener("change", updateMode);
$("regionFilter").addEventListener("change", () => {
  applyRegionFilter();
  setStatus($("regionFilter").value ? `${label("bidArea", $("regionFilter").value)} 지역 필터를 적용했습니다.` : "지역 필터를 해제했습니다.");
});
$("searchBtn").addEventListener("click", search);
$("clearBtn").addEventListener("click", clearAll);
$("exportBtn").addEventListener("click", exportCsv);
$("prevPageBtn").addEventListener("click", () => movePage(-1));
$("nextPageBtn").addEventListener("click", () => movePage(1));

updateMode();
clearAll();

fetch("/api/config")
  .then((response) => response.json())
  .then((config) => {
    if (!config.hasServiceKey) {
      setStatus("서버에 API 인증키가 아직 설정되지 않았습니다.");
    } else {
      setStatus(`검색 준비 완료. 같은 검색은 약 ${config.cacheMinutes}분간 재사용됩니다.`);
    }
  })
  .catch(() => setStatus("서버 상태를 확인하지 못했습니다."));
