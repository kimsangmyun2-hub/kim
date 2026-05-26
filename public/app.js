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
    rows.map((row, index) => {
      const globalIndex = start + index;
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
          <td><button type="button" class="ai-btn" data-row-index="${globalIndex}">AI분석</button></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="11" class="empty">검색 결과가 없습니다.</td></tr>`;

  document.querySelectorAll(".ai-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const row = currentRows[Number(button.dataset.rowIndex)];
      if (row) openAiAnalysis(row);
    });
  });
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

function daysUntil(dateText) {
  if (!dateText) return null;
  const parsed = new Date(String(dateText).replace(/\./g, "-").replace(/\//g, "-"));
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  return Math.ceil((parsed - today) / 86400000);
}

function containsAny(text, words) {
  return words.some((word) => text.includes(word));
}

function analyzeBid(row) {
  const title = String(row.title || "");
  const content = String(row.content || row.raw?.bidContent || "");
  const combined = `${title} ${content}`;
  const kind = label("codeKind", row.kind);
  const method = label("codeWay", row.method);
  const householdCount = Number(String(row.households || "").replace(/[^0-9]/g, "")) || 0;
  const closeDays = daysUntil(row.closeDate);
  const risks = [];
  const checks = [];
  const notes = [];

  if (kind.includes("제한")) {
    risks.push("제한경쟁 공고입니다. 실적·면허·기술자·세대수 제한이 과도하지 않은지 확인이 필요합니다.");
    checks.push("제한경쟁 제한요건이 공사 규모·난이도와 관련성이 있는지 검토");
  }
  if (kind.includes("지명")) {
    risks.push("지명경쟁 공고입니다. 지명 사유와 대상 업체 선정 근거 확인이 필요합니다.");
    checks.push("지명경쟁 사유와 입주자대표회의 의결 근거 확인");
  }
  if (method.includes("직접")) notes.push("직접입찰 방식입니다. 제출서류 접수, 봉인, 개찰 절차 관리가 중요합니다.");
  if (method.includes("전자")) notes.push("전자입찰 방식입니다. K-APT 전자입찰 마감시간과 첨부파일 누락 여부를 확인하세요.");
  if (row.state === "3" || title.includes("재공고")) {
    risks.push("재공고로 보입니다. 기존 유찰 사유와 조건 변경 여부를 확인해야 합니다.");
    checks.push("동일 조건 재공고인지, 참가자격·예정가격·시방서 변경 여부 확인");
  }
  if (closeDays !== null && closeDays <= 3 && closeDays >= 0) risks.push(`마감까지 ${closeDays}일 남았습니다. 현장설명회·서류 준비기간이 촉박할 수 있습니다.`);
  if (closeDays !== null && closeDays < 0) notes.push("마감일이 지난 공고입니다. 결과조회 또는 계약 진행 단계인지 확인하세요.");

  const longTermRepairWords = ["승강기", "로프", "쉬브", "인버터", "제어반", "CCTV", "방수", "옥상", "외벽", "주차차단기", "수배전", "변압기", "급수", "배관", "펌프", "소방", "도장"];
  if (containsAny(combined, longTermRepairWords)) checks.push("장기수선계획 반영 여부 및 장기수선충당금 사용 가능 여부 확인");

  const safetyWords = ["소방", "전기", "승강기", "안전", "정밀", "진단", "석면", "방수", "균열"];
  if (containsAny(combined, safetyWords)) checks.push("관련 법정점검·안전관리 기준 및 전문업 등록 요건 확인");

  const serviceWords = ["청소", "경비", "소독", "재활용", "위탁", "용역", "관리"];
  if (containsAny(combined, serviceWords)) checks.push("용역계약 기간, 인건비 산출, 최저임금, 보험료 정산 조건 확인");

  if (householdCount >= 1500) notes.push(`대단지(${householdCount.toLocaleString()}세대) 공고입니다. 실적 제한과 투입인력 기준의 적정성을 중점 확인하세요.`);
  else if (householdCount > 0 && householdCount < 300) notes.push(`소규모 단지(${householdCount.toLocaleString()}세대) 공고입니다. 과도한 실적 제한이 있는지 확인하세요.`);
  else if (!householdCount) notes.push("세대수 정보가 확인되지 않았습니다. 단지정보 또는 공고문에서 세대수를 별도로 확인하세요.");

  if (!row.fileSeq && !row.content) risks.push("공고문 링크 또는 본문이 없어 세부 조건 확인이 제한됩니다.");

  const riskScore = Math.min(100, (risks.length * 22) + (checks.length * 7) + (closeDays !== null && closeDays <= 3 && closeDays >= 0 ? 10 : 0));
  const riskLevel = riskScore >= 65 ? "높음" : riskScore >= 35 ? "보통" : "낮음";

  return {
    summary: [
      `공고명: ${row.title || "-"}`,
      `단지명: ${row.apartment || "-"}`,
      `지역: ${label("bidArea", row.area)}`,
      `입찰종류/방법: ${kind} / ${method}`,
      `마감일: ${row.closeDate || "-"}`
    ],
    riskLevel,
    riskScore,
    risks: risks.length ? risks : ["현재 검색정보 기준으로 즉시 확인되는 고위험 요소는 많지 않습니다."],
    checks: checks.length ? checks : ["공고문, 참가자격, 제출서류, 보증금, 계약기간, 낙찰방법을 기본 확인하세요."],
    notes: notes.length ? notes : ["입찰 참가 전 현장설명회 여부와 공고문 첨부파일을 확인하세요."]
  };
}

function renderList(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function openAiAnalysis(row) {
  const result = analyzeBid(row);
  const modal = $("aiModal");
  $("aiModalTitle").textContent = "무료 규칙기반 AI 입찰분석";
  $("aiModalBody").innerHTML = `
    <div class="ai-risk ai-risk-${result.riskLevel}">
      <strong>위험도: ${escapeHtml(result.riskLevel)}</strong>
      <span>점수 ${result.riskScore}/100</span>
    </div>
    <h3>1. 공고 요약</h3>
    ${renderList(result.summary)}
    <h3>2. 주의할 위험요소</h3>
    ${renderList(result.risks)}
    <h3>3. 실무 체크포인트</h3>
    ${renderList(result.checks)}
    <h3>4. 메모</h3>
    ${renderList(result.notes)}
    <p class="ai-disclaimer">※ 이 분석은 무료 규칙기반 자동분석입니다. 최종 판단은 공고문 원문, 관리규약, 입주자대표회의 의결자료를 함께 확인해야 합니다.</p>
  `;
  modal.hidden = false;
}

function closeAiModal() {
  $("aiModal").hidden = true;
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
  params.set("groupReNotice", $("groupReNotice")?.value || "off");
  
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
$("aiCloseBtn")?.addEventListener("click", closeAiModal);
$("aiModal")?.addEventListener("click", (event) => {
  if (event.target.id === "aiModal") closeAiModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("aiModal") && !$("aiModal").hidden) closeAiModal();
});

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
