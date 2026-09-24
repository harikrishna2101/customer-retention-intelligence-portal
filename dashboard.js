let customerData = [];

async function getCsrfToken() {
    try {
        const res = await fetch('/api/csrf-token', { credentials: 'include' });
        const data = await res.json();
        return data.csrfToken || '';
    } catch(e) { return ''; }
}
let currentFilteredData = null;
let currentPage = 1;
let totalPages = 1;
let totalRecords = 0;
const rowsPerPage = 50;

let riskPieChartInstance = null;
let revenueBarChartInstance = null;
let tenureLineChartInstance = null;
let cohortChartInstance = null;
let globalStats = null;
let selectedRows = new Set();
let currentUserRole = 'admin'; // default; updated after /api/data/me

document.addEventListener('DOMContentLoaded', () => {
    showSkeletonLoading();
    loadSocketIO();
    loadDashboardData();
    loadUserRole();
});

function showSkeletonLoading() {
    const statBox = document.getElementById('dashboard-stats');
    if (statBox) {
        statBox.innerHTML = Array(4).fill(`
            <div style="background:var(--card-bg); padding:1.5rem; border-radius:12px; border:1px solid var(--border-color); text-align:center;">
                <div class="skeleton skeleton-text" style="margin:0 auto 0.5rem;"></div>
                <div class="skeleton skeleton-stat" style="margin:0 auto;"></div>
            </div>
        `).join('');
    }
}

function loadSocketIO() {
    const script = document.createElement('script');
    script.src = "/socket.io/socket.io.js";
    script.onload = initRealtimeSockets;
    document.head.appendChild(script);
}

function initRealtimeSockets() {
    if (typeof io !== 'undefined') {
        const socket = io();
        socket.on('uploadProgress', (data) => {
            const btn = document.getElementById('upload-btn');
            if (btn) btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Processing ${data.totalProcessed} records...`;
        });
        socket.on('uploadComplete', (data) => {
            const btn = document.getElementById('upload-btn');
            if (btn) btn.innerHTML = `<i class='bx bx-check'></i> Upload Complete`;
            setTimeout(() => { if (btn) btn.innerHTML = `<i class='bx bx-cloud-upload'></i> Upload New Dataset`; }, 3000);
            loadDashboardData();
        });
    }
}

async function loadDashboardData() {
    const tbody = document.getElementById('crm-table-body'); // null on dashboard.html, present on reports.html
    const isReportsPage = !!tbody;

    try {
        // 1. Always fetch stats (used by both pages for charts/stats)
        const statsRes = await fetch(`${BASE_URL}/api/data/stats`, { credentials: 'include' });
        const stats = await statsRes.json();

        // 2. Fetch customers (always paginated, charts now use backend pre-aggregated stats)
        const limit = rowsPerPage;
        const custRes = await fetch(`${BASE_URL}/api/data/customers?page=${currentPage}&limit=${limit}`, { credentials: 'include' });
        const custData = await custRes.json();

        if (stats.success) {
            globalStats = stats;
            renderStats(stats);
        }

        if (custData.success) {
            customerData = custData.customers;
            totalPages = custData.totalPages || 1;
            totalRecords = custData.total || customerData.length;
            if (stats.success) renderIntelligenceCards(stats);

            // Render table only on reports page
            if (isReportsPage) {
                renderTable(customerData, true); // Server paginated data
            }

            // Render charts only on dashboard page
            if (!isReportsPage) {
                if (customerData.length > 0) {
                    renderCharts(customerData, stats);
                    loadCohortChart();
                    loadRenewalCalendar();
                } else {
                    const pieParent = document.getElementById('riskPieChart');
                    const barParent = document.getElementById('revenueBarChart');
                    const lineParent = document.getElementById('tenureLineChart');
                    if (pieParent) pieParent.parentElement.innerHTML =
                        `<div style="text-align:center; color:var(--secondary-text); padding:2rem;"><i class='bx bx-bar-chart-alt-2' style="font-size:3rem;"></i><p style="margin-top:0.5rem;">No data yet. Upload a CSV on the Home page.</p></div>`;
                    if (barParent) barParent.parentElement.innerHTML =
                        `<div style="text-align:center; color:var(--secondary-text); padding:2rem;"><i class='bx bx-trending-up' style="font-size:3rem;"></i><p style="margin-top:0.5rem;">Revenue chart will appear after upload.</p></div>`;
                    if (lineParent) lineParent.parentElement.innerHTML =
                        `<div style="text-align:center; color:var(--secondary-text); padding:2rem;"><i class='bx bx-line-chart' style="font-size:3rem;"></i><p style="margin-top:0.5rem;">Tenure distribution will appear after upload.</p></div>`;
                }
            }
        } else {
            if (isReportsPage) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--risk-red);">Failed to load data. Please try refreshing.</td></tr>`;
            }
        }
    } catch (err) {
        console.error("Dashboard failed to load", err);
        if (isReportsPage && tbody) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--risk-red);">Connection error. Is the server running?</td></tr>`;
        }
    }
}


function renderStats(stats) {
    const statBox = document.getElementById('dashboard-stats');
    if (!statBox) return;
    statBox.innerHTML = `
        <div style="background:var(--card-bg); padding:1.5rem; border-radius:12px; border:1px solid var(--border-color); text-align:center;">
            <i class='bx bx-group' style="font-size:2rem; color:var(--text-color); margin-bottom:0.5rem;"></i>
            <h4 style="color:var(--secondary-text); font-weight:500;">Total Users</h4>
            <h2 style="font-size:1.8rem;">${(stats.total || 0).toLocaleString()}</h2>
        </div>
        <div style="background:var(--card-bg); padding:1.5rem; border-radius:12px; border:1px solid var(--border-color); text-align:center;">
            <i class='bx bx-check-shield' style="font-size:2rem; color:var(--risk-green); margin-bottom:0.5rem;"></i>
            <h4 style="color:var(--secondary-text); font-weight:500;">Safe</h4>
            <h2 style="font-size:1.8rem; color:var(--risk-green);">${(stats.green || 0).toLocaleString()}</h2>
        </div>
        <div style="background:var(--card-bg); padding:1.5rem; border-radius:12px; border:1px solid var(--border-color); text-align:center;">
            <i class='bx bx-error' style="font-size:2rem; color:var(--risk-yellow); margin-bottom:0.5rem;"></i>
            <h4 style="color:var(--secondary-text); font-weight:500;">Warning</h4>
            <h2 style="font-size:1.8rem; color:var(--risk-yellow);">${(stats.yellow || 0).toLocaleString()}</h2>
        </div>
        <div style="background:var(--card-bg); padding:1.5rem; border-radius:12px; border:1px solid var(--border-color); text-align:center;">
            <i class='bx bx-radiation' style="font-size:2rem; color:var(--risk-red); margin-bottom:0.5rem;"></i>
            <h4 style="color:var(--secondary-text); font-weight:500;">High Risk</h4>
            <h2 style="font-size:1.8rem; color:var(--risk-red);">${(stats.red || 0).toLocaleString()}</h2>
        </div>
    `;
}

function renderIntelligenceCards(stats) {
    const clvEl = document.getElementById('stat-clv');
    const healthEl = document.getElementById('stat-health');
    const revRiskEl = document.getElementById('stat-revenue-risk');
    if (clvEl)     clvEl.textContent = stats.avgClv > 0 ? formatDatasetValue('clv', stats.avgClv) : '-';
    if (healthEl)  healthEl.textContent = stats.avgHealth > 0 ? `${stats.avgHealth}/100` : '-';
    if (revRiskEl) revRiskEl.textContent = formatDatasetValue('revenueAtRisk', stats.revenueAtRisk || 0);

    // ── Health Score Badge ──
    const healthScore = stats.avgHealth || 0;
    const scoreEl = document.getElementById('health-badge-score');
    const statusEl = document.getElementById('health-badge-status');
    const descEl = document.getElementById('health-badge-desc');
    const ringFill = document.getElementById('health-ring-fill');

    if (scoreEl && healthScore > 0) {
        scoreEl.textContent = healthScore;
        const circumference = 326.73;
        const offset = circumference - (healthScore / 100) * circumference;
        if (ringFill) {
            ringFill.style.strokeDashoffset = offset;
            if (healthScore >= 70) { ringFill.style.stroke = '#22c55e'; }
            else if (healthScore >= 45) { ringFill.style.stroke = '#f59e0b'; }
            else { ringFill.style.stroke = '#ef4444'; }
        }
        if (healthScore >= 70) {
            statusEl.innerHTML = '<span style="color:#22c55e;">● Healthy</span>';
            descEl.textContent = 'Your customer portfolio is in good health. Most customers are engaged and at low churn risk.';
        } else if (healthScore >= 45) {
            statusEl.innerHTML = '<span style="color:#f59e0b;">● At Risk</span>';
            descEl.textContent = 'Several customers show warning signs. Proactive retention campaigns are recommended.';
        } else {
            statusEl.innerHTML = '<span style="color:#ef4444;">● Critical</span>';
            descEl.textContent = 'Your portfolio health is critical. Immediate intervention needed for high-risk accounts.';
        }
    }

    // ── ML Model Metrics ──
    loadMLMetrics();

    // ── Top At-Risk Customers ──
    renderTopRiskCustomers();
}

async function loadMLMetrics() {
    try {
        const res = await fetch(`${BASE_URL}/api/data/ml-metrics`, { credentials: 'include' });
        const data = await res.json();
        if (data.success && data.metrics) {
            const m = data.metrics;
            const grid = document.getElementById('ml-metrics-content');
            if (grid) {
                grid.innerHTML = `
                    <div style="text-align:center; padding:0.6rem; background:rgba(255,255,255,0.03); border-radius:8px;">
                        <div style="font-size:0.7rem; color:var(--secondary-text);">Accuracy</div>
                        <div style="font-size:1.4rem; font-weight:700; color:#22c55e;">${m.accuracy}%</div>
                    </div>
                    <div style="text-align:center; padding:0.6rem; background:rgba(255,255,255,0.03); border-radius:8px;">
                        <div style="font-size:0.7rem; color:var(--secondary-text);">Precision</div>
                        <div style="font-size:1.4rem; font-weight:700; color:#4facfe;">${m.precision}%</div>
                    </div>
                    <div style="text-align:center; padding:0.6rem; background:rgba(255,255,255,0.03); border-radius:8px;">
                        <div style="font-size:0.7rem; color:var(--secondary-text);">Recall</div>
                        <div style="font-size:1.4rem; font-weight:700; color:#f59e0b;">${m.recall}%</div>
                    </div>
                    <div style="text-align:center; padding:0.6rem; background:rgba(255,255,255,0.03); border-radius:8px;">
                        <div style="font-size:0.7rem; color:var(--secondary-text);">F1 Score</div>
                        <div style="font-size:1.4rem; font-weight:700; color:#a855f7;">${m.f1_score}%</div>
                    </div>
                `;
            }
            const algoLabel = document.getElementById('ml-algo-label');
            if (algoLabel) algoLabel.textContent = `Algorithm: ${m.algorithm} · Dataset: ${m.dataset} · Samples: ${m.total_samples}`;

            // ── Confusion Matrix ──
            if (m.confusion_matrix) {
                const cm = m.confusion_matrix;
                const tn = document.getElementById('cm-tn');
                const fp = document.getElementById('cm-fp');
                const fn = document.getElementById('cm-fn');
                const tp = document.getElementById('cm-tp');
                if (tn) tn.textContent = cm.true_negatives;
                if (fp) fp.textContent = cm.false_positives;
                if (fn) fn.textContent = cm.false_negatives;
                if (tp) tp.textContent = cm.true_positives;
            }

            // ── Feature Importance ──
            if (m.feature_importance && m.feature_importance.length > 0) {
                const container = document.getElementById('feature-importance-container');
                if (container) {
                    const maxImp = m.feature_importance[0].importance;
                    container.innerHTML = m.feature_importance.map((f, i) => {
                        const pct = Math.round((f.importance / maxImp) * 100);
                        const colors = ['#a855f7', '#4facfe', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1'];
                        const color = colors[i % colors.length];
                        return `
                        <div style="display:flex; align-items:center; gap:0.75rem;">
                            <span style="font-size:0.75rem; width:110px; flex-shrink:0; text-align:right; color:var(--secondary-text);">${escapeHTML(f.feature)}</span>
                            <div style="flex:1; height:18px; background:rgba(255,255,255,0.05); border-radius:4px; overflow:hidden;">
                                <div style="width:${pct}%; height:100%; background:${color}; border-radius:4px; transition:width 0.8s ease;"></div>
                            </div>
                            <span style="font-size:0.72rem; color:${color}; font-weight:600; min-width:40px;">${(f.importance * 100).toFixed(1)}%</span>
                        </div>`;
                    }).join('');
                }
            }
        }
    } catch (e) { console.log('ML metrics not available:', e); }
}

function renderTopRiskCustomers() {
    const container = document.getElementById('top-risk-list');
    if (!container || !customerData || customerData.length === 0) return;

    const sorted = [...customerData].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)).slice(0, 5);
    if (sorted.length === 0) return;

    container.innerHTML = sorted.map(c => {
        const score = c.risk_score || 0;
        let levelLabel, levelColor, levelBg;
        if (score > 75) { levelLabel = 'HIGH'; levelColor = '#ef4444'; levelBg = 'rgba(239,68,68,0.12)'; }
        else if (score > 40) { levelLabel = 'MEDIUM'; levelColor = '#f59e0b'; levelBg = 'rgba(245,158,11,0.12)'; }
        else { levelLabel = 'LOW'; levelColor = '#22c55e'; levelBg = 'rgba(34,197,94,0.12)'; }

        const healthScore = c.health_score || 0;
        let healthLabel, healthColor;
        if (healthScore >= 70) { healthLabel = 'Healthy'; healthColor = '#22c55e'; }
        else if (healthScore >= 45) { healthLabel = 'At Risk'; healthColor = '#f59e0b'; }
        else { healthLabel = 'Critical'; healthColor = '#ef4444'; }

        return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 1rem; background:var(--hover-bg); border-radius:8px; border-left:3px solid ${levelColor};">
            <div style="display:flex; align-items:center; gap:1rem;">
                <span style="font-weight:600; min-width:100px;">${escapeHTML(c.customerID)}</span>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <div style="width:80px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                        <div style="width:${score}%; height:100%; background:${levelColor}; border-radius:3px;"></div>
                    </div>
                    <span style="font-size:0.85rem; font-weight:600; color:${levelColor};">${score}%</span>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.75rem;">
                <span style="font-size:0.7rem; padding:0.2rem 0.6rem; border-radius:50px; font-weight:700; background:${levelBg}; color:${levelColor}; letter-spacing:0.5px;">RISK: ${levelLabel}</span>
                <span style="font-size:0.7rem; padding:0.2rem 0.6rem; border-radius:50px; font-weight:600; background:rgba(255,255,255,0.04); color:${healthColor};">Health: ${healthScore}</span>
            </div>
        </div>`;
    }).join('');
}

async function loadCohortChart() {
    try {
        const res = await fetch(`${BASE_URL}/api/data/cohort`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) return;

        const canvas = document.getElementById('cohortChart');
        if (!canvas) return;

        const labels = Object.keys(data.cohort);
        const safeData   = labels.map(b => data.cohort[b].Safe || 0);
        const warnData   = labels.map(b => data.cohort[b].Warning || 0);
        const riskData   = labels.map(b => data.cohort[b]['High Risk'] || 0);

        if (cohortChartInstance) cohortChartInstance.destroy();
        cohortChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Safe',      data: safeData, backgroundColor: 'rgba(34,197,94,0.7)',  borderRadius: 4 },
                    { label: 'Warning',   data: warnData, backgroundColor: 'rgba(245,158,11,0.7)', borderRadius: 4 },
                    { label: 'High Risk', data: riskData, backgroundColor: 'rgba(239,68,68,0.7)',  borderRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#aaa' } } },
                scales: {
                    x: { stacked: true, ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { stacked: true, ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });
    } catch (e) { console.error('Cohort chart failed:', e); }
}

async function loadRenewalCalendar() {
    const container = document.getElementById('renewal-list');
    if (!container) return;
    try {
        const res = await fetch(`${BASE_URL}/api/data/renewals`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success || data.renewals.length === 0) {
            container.innerHTML = `<p style="color:var(--secondary-text);"><i class='bx bx-calendar-check'></i> No contracts renewing in the next 90 days.</p>`;
            return;
        }
        const bucketColors = { '30': '#ef4444', '60': '#f59e0b', '90': '#4facfe' };
        container.innerHTML = data.renewals.map(r => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 1rem; background:var(--hover-bg); border-radius:8px; margin-bottom:0.5rem; border-left:3px solid ${bucketColors[r.bucket] || '#aaa'}">
                <div>
                    <span style="font-weight:600;">${escapeHTML(r.customerID)}</span>
                    <span style="margin-left:1rem; font-size:0.8rem; color:var(--secondary-text);">Risk: <span style="color:${r.risk_level === 'High Risk' ? '#ef4444' : r.risk_level === 'Warning' ? '#f59e0b' : '#22c55e'}">${r.risk_level}</span></span>
                </div>
                <div style="font-size:0.85rem; color:${bucketColors[r.bucket]};">
                    <i class='bx bx-alarm'></i> ${r.daysLeft} day${r.daysLeft !== 1 ? 's' : ''} left
                </div>
            </div>`
        ).join('');
    } catch (e) {
        container.innerHTML = `<p style="color:var(--secondary-text);">Renewal data unavailable.</p>`;
    }
}

async function loadUserRole() {
    try {
        const res = await fetch(`${BASE_URL}/api/data/me`, { credentials: 'include' });
        const data = await res.json();
        if (data.success) {
            currentUserRole = data.user.role || 'admin';
            // Apply viewer restrictions on reports page
            if (currentUserRole === 'viewer') {
                document.querySelectorAll('.action-edit-btn, .action-delete-btn, #add-record-btn, #delete-all-btn, #bulk-bar').forEach(el => {
                    if (el) el.style.display = 'none';
                });
            }
        }
    } catch(e) {}
}

// ─────────────────────────────────────────────
// ANTI-XSS ESCAPE HELPER
// ─────────────────────────────────────────────
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

function escapeAttr(str) {
    return escapeHTML(str).replace(/`/g, '&#96;');
}

const internalCustomerKeys = new Set([
    '_id', 'uploadedBy', 'createdAt', 'updatedAt', '__v',
    'risk_level', 'risk_score', 'xai_reason1', 'xai_reason2',
    'clv', 'health_score', 'prev_risk_score', 'renewalDate',
    'crm_stage', 'ab_variant', 'campaign_sent_at', 'campaign_outcome',
    'actionHistory'
]);

const datasetFormBlockedKeys = new Set([...internalCustomerKeys, 'customerID', 'customer_id']);

function shouldShowDatasetField(key, value) {
    if (datasetFormBlockedKeys.has(key)) return false;
    if (value !== null && typeof value === 'object') return false;
    return true;
}

function toCsvCell(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return `"${value.toISOString()}"`;
    if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
    return `"${String(value).replace(/"/g, '""')}"`;
}

function isMoneyField(key) {
    return /(charge|price|cost|mrr|amount|revenue|payment|totalcharges|monthlycharges|clv|ltv|value)/i.test(key);
}

function detectCurrencySymbol(key, rows = customerData) {
    const symbols = ['₹', '$', '€', '£', '¥', '₩', '₽', '₺', '₫', '₱', '฿', '₪', '₦', 'R$'];
    for (const row of rows || []) {
        const val = row && row[key];
        if (val === null || val === undefined) continue;
        const text = String(val);
        const found = symbols.find(sym => text.includes(sym));
        if (found) return found;
        const code = text.match(/\b(USD|INR|EUR|GBP|JPY|AUD|CAD|SGD|AED)\b/i);
        if (code) return code[1].toUpperCase() + ' ';
    }
    return '';
}

function formatDatasetValue(key, val) {
    if (val === null || val === undefined || val === '') return val === 0 ? 0 : '-';
    if (!isMoneyField(key)) return val;
    const text = String(val).trim();
    if (/[₹$€£¥₩₽₺₫₱฿₪₦]/.test(text) || /\b(USD|INR|EUR|GBP|JPY|AUD|CAD|SGD|AED)\b/i.test(text)) {
        return text;
    }
    const numeric = typeof val === 'number' ? val : Number(text.replace(/,/g, ''));
    if (!Number.isFinite(numeric)) return val;
    const symbol = detectCurrencySymbol(key);
    return symbol ? symbol + numeric.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const crmStageLabels = {
    highrisk: 'High Risk Queue',
    contacted: 'Contacted',
    negotiating: 'Negotiating',
    saved: 'Saved',
    churned: 'Churned'
};

const crmStageColors = {
    highrisk: 'var(--risk-red)',
    contacted: 'var(--risk-yellow)',
    negotiating: 'var(--risk-blue)',
    saved: 'var(--risk-green)',
    churned: 'var(--secondary-text)'
};

function formatCrmStage(stage) {
    return crmStageLabels[String(stage || '').toLowerCase()] || 'Not started';
}

function crmStageColor(stage) {
    return crmStageColors[String(stage || '').toLowerCase()] || 'var(--secondary-text)';
}

function renderTable(customers, pageOrServerPaginated = 1) {
    const serverPaginated = pageOrServerPaginated === true;
    if (!serverPaginated) {
        currentPage = Number(pageOrServerPaginated) || 1;
    }
    currentFilteredData = customers;
    const tbody = document.getElementById('crm-table-body');
    const thead = document.getElementById('crm-table-header');
    
    if (customers.length === 0) {
        if (thead) thead.innerHTML = '';
        if (customerData.length > 0) {
            tbody.innerHTML = `<tr><td style="text-align:center; padding:2rem; color:var(--secondary-text);">No records match your filters.</td></tr>`;
        } else {
            tbody.innerHTML = `<tr><td style="text-align:center; padding:2rem; color:var(--secondary-text);">No data uploaded yet. Please upload a dataset to define your customer layout.</td></tr>`;
        }
        return;
    }

    // Find all dynamic keys
    let dynamicKeys = new Set();
    customers.forEach(c => {
        Object.keys(c).forEach(k => {
            if (!internalCustomerKeys.has(k)) dynamicKeys.add(k);
        });
    });
    const keysArray = Array.from(dynamicKeys);

    // Render Headers
    if (thead) {
        let thHtml = `<th style="padding:1rem; width:40px;"><input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll()"></th>`;
        keysArray.forEach(k => {
            thHtml += `<th style="padding:1rem; text-transform:capitalize;">${escapeHTML(k)}</th>`;
        });
        thHtml += `<th style="padding:1rem;">Risk Prediction</th>`;
        thHtml += `<th style="padding:1rem;">Retention Stage</th>`;
        thHtml += `<th style="padding:1rem; text-align:right; position:sticky; right:0; background:var(--card-bg); z-index:2; border-left:1px solid var(--border-color);">Actions</th>`;
        thead.innerHTML = thHtml;
    }

    let html = '';
    
    // Server-side pagination bypasses slicing
    let slicedCustomers = customers;
    if (!serverPaginated) {
        // Fallback for manual filter passing
        const startIdx = (currentPage - 1) * rowsPerPage;
        const endIdx = startIdx + rowsPerPage;
        slicedCustomers = customers.slice(startIdx, endIdx);
    }

    slicedCustomers.forEach(c => {
        let badgeColor = 'var(--text-color)';
        if (c.risk_level === 'High Risk') badgeColor = 'var(--risk-red)';
        if (c.risk_level === 'Warning') badgeColor = 'var(--risk-yellow)';
        if (c.risk_level === 'Safe') badgeColor = 'var(--risk-green)';
        if (c.risk_level === 'New') badgeColor = 'var(--risk-blue)';

        let checkedAttr = selectedRows.has(c._id) ? 'checked' : '';
        let xaiBtn = (c.risk_level === 'High Risk' || c.risk_level === 'Warning') ?
            `<button onclick="openXAI(this.dataset.reason1, this.dataset.reason2)" data-reason1="${escapeAttr(c.xai_reason1)}" data-reason2="${escapeAttr(c.xai_reason2)}" title="Explainable AI" style="background:transparent; border:none; cursor:pointer; color:#a855f7; margin-right:0.5rem;"><i class='bx bx-brain'></i></button>` : '';

        html += `<tr style="border-bottom:1px solid var(--hover-bg);">`;
        html += `<td style="padding:1rem;"><input type="checkbox" class="row-checkbox" value="${escapeAttr(c._id)}" ${checkedAttr} onchange="handleRowCheck(this)"></td>`;
        
        keysArray.forEach(k => {
            let val = c[k] !== undefined && c[k] !== null ? c[k] : '-';
            val = formatDatasetValue(k, val);
            html += `<td style="padding:1rem;">${escapeHTML(val)}</td>`;
        });

        html += `<td style="padding:1rem;"><span style="color:${badgeColor}; font-weight:600; padding:0.2rem 0.6rem; background:rgba(255,255,255,0.05); border-radius:50px; font-size:0.8rem;">${escapeHTML(c.risk_level || 'New')}</span></td>`;
        html += `<td style="padding:1rem;"><span style="color:${crmStageColor(c.crm_stage)}; font-weight:600; padding:0.2rem 0.6rem; background:rgba(255,255,255,0.05); border-radius:50px; font-size:0.8rem;">${escapeHTML(formatCrmStage(c.crm_stage))}</span></td>`;
        html += `
                <td style="padding:1rem; text-align:right; white-space:nowrap; position:sticky; right:0; background:var(--card-bg); border-left:1px solid var(--border-color);">
                    ${xaiBtn}
                    <button class="action-edit-btn" onclick="editRecord('${escapeAttr(c._id)}')" title="Edit Record" style="background:rgba(79,172,254,0.12); border:1px solid var(--risk-blue); border-radius:5px; cursor:pointer; color:var(--risk-blue); margin-right:0.4rem; padding:0.3rem 0.5rem;"><i class='bx bx-edit'></i></button>
                    <button class="action-delete-btn" onclick="deleteRecord('${escapeAttr(c._id)}')" title="Delete Record" style="background:rgba(204,51,51,0.12); border:1px solid #cc3333; border-radius:5px; cursor:pointer; color:var(--risk-red); padding:0.3rem 0.5rem;"><i class='bx bx-trash'></i></button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
    updateBulkActionBar();
    renderPaginationControls(serverPaginated ? totalRecords : customers.length, serverPaginated ? totalPages : Math.ceil(customers.length / rowsPerPage));
}

function renderPaginationControls(totalRecords, totalPages) {
    const pag = document.getElementById('pagination-controls');
    if(!pag) return;
    if(totalRecords <= rowsPerPage) {
        pag.style.display = 'none';
        return;
    }
    pag.style.display = 'flex';
    pag.innerHTML = `
        <button onclick="changePage(-1)" ${currentPage === 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} class="btn-primary" style="padding:0.4rem 0.8rem; background:var(--hover-bg); color:var(--text-color); border:1px solid var(--border-color);"><i class='bx bx-chevron-left'></i> Prev</button>
        <span style="color:var(--secondary-text); font-size:0.9rem;">Page ${currentPage} of ${totalPages} <span style="opacity:0.5; margin-left:0.5rem;">(${totalRecords} total views)</span></span>
        <button onclick="changePage(1)" ${currentPage >= totalPages ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} class="btn-primary" style="padding:0.4rem 0.8rem; background:var(--hover-bg); color:var(--text-color); border:1px solid var(--border-color);">Next <i class='bx bx-chevron-right'></i></button>
    `;
}

function changePage(dir) {
    if (currentPage + dir < 1 || currentPage + dir > totalPages) return;
    currentPage += dir;
    loadDashboardData(); // Server-side fetch triggers
}

function renderCharts(customers, stats) {
    const pieEl = document.getElementById('riskPieChart');
    const barEl = document.getElementById('revenueBarChart');
    if (!pieEl || !barEl) return; // Not on dashboard page — skip safely
    // Colors mapped as requested by user
    const brandColors = {
        Safe: '#00cc66',      // green
        Warning: '#f2ba00',   // yellow
        HighRisk: '#ff3333',  // red
        New: '#3399ff'        // blue
    };

    // 1. Plot Risk Pie Chart
    const ctxPie = document.getElementById('riskPieChart').getContext('2d');
    if (riskPieChartInstance) riskPieChartInstance.destroy();

    riskPieChartInstance = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: ['Safe', 'Warning', 'High Risk', 'New'],
            datasets: [{
                data: [stats.green, stats.yellow, stats.red, stats.blue],
                backgroundColor: [brandColors.Safe, brandColors.Warning, brandColors.HighRisk, brandColors.New],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#ccc' } }
            }
        }
    });

    const chartData = stats.chartData;
    if (!chartData) return;

    // 2. Plot Dynamic Bar Chart (Average Metric by Risk)
    const ctxBar = document.getElementById('revenueBarChart').getContext('2d');
    if (revenueBarChartInstance) revenueBarChartInstance.destroy();

    const barLabel = chartData.numericCol1 ? `Avg ${chartData.numericCol1}` : 'Avg Value';

    revenueBarChartInstance = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: ['Safe', 'Warning', 'High Risk', 'New'],
            datasets: [{
                label: barLabel,
                data: [chartData.revMap.Safe, chartData.revMap.Warning, chartData.revMap.HighRisk, chartData.revMap.New],
                backgroundColor: [brandColors.Safe, brandColors.Warning, brandColors.HighRisk, brandColors.New],
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#ccc' } },
                x: { grid: { display: false }, ticks: { color: '#ccc' } }
            }
        }
    });

    // 3. Dynamic Distribution Line Chart
    const lineEl = document.getElementById('tenureLineChart');
    if (lineEl) {
        document.getElementById('tenureLineChart').parentElement.previousElementSibling.previousElementSibling.innerText = chartData.numericCol2 ? `${chartData.numericCol2} Distribution` : "Metric Distribution";
        
        const min = chartData.distribution.min;
        const step = chartData.distribution.step;
        const counts = chartData.distribution.counts;

        const bands = [
            `${min.toFixed(0)}-${(min+step).toFixed(0)}`,
            `${(min+step).toFixed(0)}-${(min+step*2).toFixed(0)}`,
            `${(min+step*2).toFixed(0)}-${(min+step*3).toFixed(0)}`,
            `${(min+step*3).toFixed(0)}-${(min+step*4).toFixed(0)}`,
            `${(min+step*4).toFixed(0)}+`
        ];

        const ctxLine = lineEl.getContext('2d');
        if (tenureLineChartInstance) tenureLineChartInstance.destroy();

        tenureLineChartInstance = new Chart(ctxLine, {
            type: 'line',
            data: {
                labels: bands,
                datasets: [{
                    label: 'Customers',
                    data: counts,
                    borderColor: '#4facfe',
                    backgroundColor: 'rgba(79,172,254,0.1)',
                    borderWidth: 2.5,
                    pointBackgroundColor: '#4facfe',
                    pointRadius: 5,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#ccc' } },
                    x: { grid: { display: false }, ticks: { color: '#ccc' } }
                }
            }
        });
    }
}

// ─────────────────────────────────────────────
// EXPORT PIPELINES
// ─────────────────────────────────────────────
function openExportModal() {
    if (customerData.length === 0) return alert("No data to export.");
    const modal = document.getElementById('export-modal');
    const list = document.getElementById('export-columns-list');
    list.innerHTML = '';
    
    let allKeys = new Set();
    customerData.forEach(c => {
        const flat = { ...c, ...(c.metadata || {}) };
        Object.keys(flat).forEach(k => {
            if (shouldShowDatasetField(k, flat[k]) || k === 'customerID' || k === 'risk_level' || k === 'risk_score' || k === 'clv' || k === 'health_score' || k === 'renewalDate') {
                allKeys.add(k);
            }
        });
    });
    
    Array.from(allKeys).forEach(k => {
        list.innerHTML += `<label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-size:0.85rem;"><input type="checkbox" class="export-col-cb" value="${escapeAttr(k)}" checked> ${escapeHTML(k)}</label>`;
    });
    
    modal.style.display = 'flex';
}

function generateCustomExport(type) {
    const checked = Array.from(document.querySelectorAll('.export-col-cb:checked')).map(cb => cb.value);
    if(checked.length === 0) return alert("Select at least one column.");
    
    if(type === 'csv') {
        const lines = [checked.map(toCsvCell).join(",")];
        customerData.forEach(row => {
            const flat = { ...row, ...(row.metadata || {}) };
            lines.push(checked.map(k => toCsvCell(flat[k])).join(","));
        });
        const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `CRIP_Custom_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } else {
        const element = document.createElement("div");
        element.style.padding = "20px";
        element.style.background = "#fff";
        element.innerHTML = `<h2 style="margin-bottom:1rem; color:#000; font-family:sans-serif;">CRIP Custom Report</h2>`;
        const tbl = document.createElement("table");
        tbl.style.width = "100%"; tbl.setAttribute('border', '1'); tbl.style.color = "#000"; tbl.style.fontFamily='sans-serif'; tbl.style.borderCollapse='collapse';
        let thead = "<tr>";
        checked.forEach(c => thead += `<th style="padding:5px;">${c}</th>`);
        thead += "</tr>";
        tbl.innerHTML += thead;
        customerData.forEach(row => {
            const flat = { ...row, ...(row.metadata || {}) };
            let tr = "<tr>";
            checked.forEach(c => {
               tr += `<td style="padding:5px;">${flat[c] !== undefined && flat[c] !== null ? flat[c] : ''}</td>`;
            });
            tr += "</tr>";
            tbl.innerHTML += tr;
        });
        element.appendChild(tbl);
        let opt = { margin: 0.5, filename: `CRIP_Custom_${Date.now()}.pdf`, jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' } };
        html2pdf().set(opt).from(element).save();
    }
    document.getElementById('export-modal').style.display='none';
}

// ==========================================
// FEATURE 4: WHAT-IF ANALYTICS SANDBOX
// ==========================================
function openWhatIfSandbox() {
    document.getElementById('edit-modal').style.display = 'none';
    const record = customerData.find(c => c._id === document.getElementById('edit-id').value);
    if(!record) return;

    const modal = document.getElementById('whatif-modal');
    const inputsContainer = document.getElementById('whatif-inputs');
    inputsContainer.innerHTML = '';
    
    const sandboxDefaults = {
        'tenure': '12',
        'monthlycharges': '50',
        'totalcharges': '600',
        'contract': 'Month-to-month',
        'internetservice': 'Fiber optic',
        'techsupport': 'No',
        'paperlessbilling': 'Yes',
        'paymentmethod': 'Electronic check',
        'gender': 'Male',
        'partner': 'No',
        'dependents': 'No',
        'phoneservice': 'Yes',
        'multiplelines': 'No',
        'onlinesecurity': 'No',
        'onlinebackup': 'No',
        'deviceprotection': 'No',
        'streamingtv': 'No',
        'streamingmovies': 'No',
        'fullname': 'Vivek Krishna',
        'email': 'vivek@streetfusion.in',
        'phone': '6149963472',
        'city': 'Mumbai',
        'state': 'Tamil Nadu',
        'age': '21',
        'favorite': 'Graph'
    };

    const flat = { ...record, ...(record.metadata || {}) };
    Object.keys(flat).forEach(key => {
        if (!shouldShowDatasetField(key, flat[key])) return;
        
        const normKey = String(key).toLowerCase().replace(/[\s_-]+/g, '');
        let val = flat[key];
        if (val === undefined || val === null || String(val).trim() === '' || String(val).trim() === '-') {
            val = sandboxDefaults[normKey] || 'Yes';
        }

        const inputId = `whatif-${encodeURIComponent(key)}`;
        const wrapper = document.createElement('div');
        wrapper.className = 'input-group';
        wrapper.innerHTML = `
            <label for="${escapeAttr(inputId)}" style="display:block; margin-bottom:0.3rem; color:var(--secondary-text); font-size:0.8rem;">${escapeHTML(key)}</label>
            <input type="text" id="${escapeAttr(inputId)}" data-key="${escapeAttr(key)}" value="${escapeAttr(val)}" style="width:100%; padding:0.6rem; background:rgba(255,255,255,0.05); border:1px solid var(--border-color); border-radius:6px; color:var(--text-color);">
        `;
        inputsContainer.appendChild(wrapper);
    });
    
    document.getElementById('whatif-result').style.display = 'none';
    modal.style.display = 'flex';
}

async function executeWhatIf() {
    const btn = document.getElementById('whatif-run-btn');
    btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Simulating...';
    btn.disabled = true;

    try {
        const payload = {};
        const inputs = document.querySelectorAll('#whatif-inputs input');
        inputs.forEach(input => {
            const key = input.dataset.key;
            let val = input.value;
            // Attempt to keep numbers as numbers for realistic parsing
            if(!isNaN(val) && val !== '') val = Number(val);
            payload[key] = val;
        });

        const csrfToken = await getCsrfToken();
        const res = await fetch(`${BASE_URL}/api/grow/what-if`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        
        if(data.success) {
            const resBox = document.getElementById('whatif-result');
            resBox.style.display = 'block';
            let color = 'var(--risk-green)';
            if(data.result.risk_level === 'Warning') color = 'var(--risk-yellow)';
            if(data.result.risk_level === 'High Risk') color = 'var(--risk-red)';
            
            resBox.innerHTML = `
                <div style="font-size:0.85rem; color:var(--secondary-text);">Simulated Risk Profile</div>
                <div style="font-size:1.5rem; color:${color};">${escapeHTML(data.result.risk_level)} (${escapeHTML(data.result.risk_score)}%)</div>
                <div style="font-size:0.8rem; margin-top:0.4rem;">${escapeHTML(data.result.xai_reason1)}</div>
            `;
        } else {
            const resBox = document.getElementById('whatif-result');
            resBox.style.display = 'block';
            resBox.innerHTML = `<span style="color:var(--risk-red);"><i class='bx bx-error'></i> ${escapeHTML(data.message || 'Sandbox simulation failed.')}</span>`;
        }
    } catch(err) {
        console.error(err);
        const resBox = document.getElementById('whatif-result');
        resBox.style.display = 'block';
        resBox.innerHTML = `<span style="color:var(--risk-red);"><i class='bx bx-error'></i> Network error: Is the ML service (FastAPI) running?</span>`;
    }

    btn.innerHTML = '<i class="bx bx-radar"></i> Predict Hypothetical Score';
    btn.disabled = false;
}

function downloadPDF() {
    let element = document.getElementById('pdf-report-canvas');
    if (!element) element = document.getElementById('crm-card'); // fallback for reports.html
    if (!element) return alert("No render target found for PDF.");

    const opt = {
      margin:       0.5,
      filename:     'CRIP_Dashboard_Report.pdf',
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'landscape' }
    };
    
    html2pdf().set(opt).from(element).save();
}

// ─────────────────────────────────────────────
// DATABASE CRUD OPS
// ─────────────────────────────────────────────
function getDynamicKeys() {
    if(customerData.length === 0) return [];
    let dynamicKeys = new Set();
    customerData.forEach(c => {
        Object.keys(c).forEach(k => {
            if (!datasetFormBlockedKeys.has(k)) dynamicKeys.add(k);
        });
    });
    return Array.from(dynamicKeys);
}

function openAddModal() {
    const keys = getDynamicKeys();
    if(keys.length === 0) return alert("Please upload a CSV dataset first to establish the customer database structure.");
    let html = '';
    keys.forEach(k => {
        const inputId = `add-inp-${encodeURIComponent(k)}`;
        html += `
            <div style="margin-bottom:0.5rem;">
                <label for="${escapeAttr(inputId)}" style="display:block; font-size:0.8rem; color:var(--secondary-text); margin-bottom:0.3rem; text-transform:capitalize;">${escapeHTML(k)}</label>
                <input type="text" id="${escapeAttr(inputId)}" data-key="${escapeAttr(k)}" style="width:100%; padding:0.6rem; background:rgba(255,255,255,0.05); border:1px solid var(--border-color); border-radius:6px; color:var(--text-color);">
            </div>
        `;
    });
    document.getElementById('dynamic-add-inputs').innerHTML = html;
    document.getElementById('add-modal').style.display = 'flex';
}

function editRecord(id) {
    const cust = customerData.find(c => c._id === id);
    if (!cust) return;

    document.getElementById('edit-id').value = cust._id;
    
    const keys = getDynamicKeys();
    
    // ── Status Selector (pinned at top) ──────────────────────────
    const currentStatus = cust.risk_level || 'Safe';
    const statusColors = { 'Safe': 'var(--risk-green)', 'Warning': 'var(--risk-yellow)', 'High Risk': 'var(--risk-red)' };
    const statusColor = statusColors[currentStatus] || 'var(--text-color)';
    const currentCrmStage = String(cust.crm_stage || '').toLowerCase();
    
    let html = `
        <div style="padding:1rem; border-radius:8px; border:2px solid ${statusColor}; background:rgba(0,0,0,0.2); margin-bottom:0.5rem;">
            <label style="display:block; font-size:0.75rem; color:var(--secondary-text); margin-bottom:0.5rem; text-transform:uppercase; letter-spacing:0.1em; font-weight:600;">
                <i class='bx bx-shield-alt-2'></i> ML Risk Status
            </label>
            <select id="edit-status" onchange="updateStatusBorder(this)" style="width:100%; padding:0.6rem; background:var(--card-bg); border:1px solid var(--border-color); border-radius:6px; color:var(--text-color); font-size:1rem; font-weight:600; cursor:pointer;">
                <option value="Safe"      ${currentStatus === 'Safe'      ? 'selected' : ''}>Safe (Low Risk)</option>
                <option value="Warning"   ${currentStatus === 'Warning'   ? 'selected' : ''}>Warning (Medium Risk)</option>
                <option value="High Risk" ${currentStatus === 'High Risk' ? 'selected' : ''}>High Risk (Churn Danger)</option>
            </select>
        </div>
        <div style="padding:1rem; border-radius:8px; border:1px solid var(--border-color); background:rgba(255,255,255,0.03); margin-bottom:0.5rem;">
            <label style="display:block; font-size:0.75rem; color:var(--secondary-text); margin-bottom:0.5rem; text-transform:uppercase; letter-spacing:0.1em; font-weight:600;">
                <i class='bx bx-git-branch'></i> Retention Workflow Stage
            </label>
            <select id="edit-crm-stage" style="width:100%; padding:0.6rem; background:var(--card-bg); border:1px solid var(--border-color); border-radius:6px; color:var(--text-color); font-size:1rem; font-weight:600; cursor:pointer;">
                <option value=""            ${currentCrmStage === ''            ? 'selected' : ''}>Not started</option>
                <option value="highrisk"    ${currentCrmStage === 'highrisk'    ? 'selected' : ''}>High Risk Queue</option>
                <option value="contacted"   ${currentCrmStage === 'contacted'   ? 'selected' : ''}>Contacted</option>
                <option value="negotiating" ${currentCrmStage === 'negotiating' ? 'selected' : ''}>Negotiating</option>
                <option value="saved"       ${currentCrmStage === 'saved'       ? 'selected' : ''}>Saved</option>
                <option value="churned"     ${currentCrmStage === 'churned'     ? 'selected' : ''}>Churned</option>
            </select>
        </div>
        <hr style="border-color:var(--border-color); margin:0.5rem 0;">
    `;
    
    // ── All other metadata fields ─────────────────────────────────
    keys.forEach(k => {
        let val = cust[k] !== undefined && cust[k] !== null ? cust[k] : '';
        const inputId = `edit-inp-${encodeURIComponent(k)}`;
        html += `
            <div style="margin-bottom:0.5rem;">
                <label for="${escapeAttr(inputId)}" style="display:block; font-size:0.8rem; color:var(--secondary-text); margin-bottom:0.3rem; text-transform:capitalize;">${escapeHTML(k)}</label>
                <input type="text" id="${escapeAttr(inputId)}" data-key="${escapeAttr(k)}" value="${escapeAttr(val)}" style="width:100%; padding:0.6rem; background:rgba(255,255,255,0.05); border:1px solid var(--border-color); border-radius:6px; color:var(--text-color);">
            </div>
        `;
    });

    document.getElementById('dynamic-edit-inputs').innerHTML = html;
    document.getElementById('edit-modal').style.display = 'flex';
}

function updateStatusBorder(selectEl) {
    const colorMap = { 'Safe': 'var(--risk-green)', 'Warning': 'var(--risk-yellow)', 'High Risk': 'var(--risk-red)' };
    const wrapper = selectEl.closest('div');
    wrapper.style.borderColor = colorMap[selectEl.value] || 'var(--border-color)';
}

async function saveEdit() {
    const id = document.getElementById('edit-id').value;
    const keys = getDynamicKeys();
    let payload = {};
    
    // Grab the dedicated status dropdown first
    const statusEl = document.getElementById('edit-status');
    if (statusEl) payload.risk_level = statusEl.value;
    const crmStageEl = document.getElementById('edit-crm-stage');
    if (crmStageEl) payload.crm_stage = crmStageEl.value;
    
    document.querySelectorAll('#dynamic-edit-inputs input[data-key]').forEach(inp => {
        const k = inp.dataset.key;
        let val = inp.value;
        payload[k] = isNaN(val) || val.trim() === '' ? val : parseFloat(val);
    });

    try {
        const csrfToken = await getCsrfToken();
        const res = await fetch(`${BASE_URL}/api/data/customers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        
        const result = await res.json();
        if (result.success) {
            document.getElementById('edit-modal').style.display = 'none';
            loadDashboardData(); // Refresh everything instantly
        } else {
            alert(result.message || "Failed to edit record");
        }
    } catch (err) {
        console.error(err);
        alert("Server error.");
    }
}

async function saveNewRecord() {
    const keys = getDynamicKeys();
    let payload = {};
    let hasCustomerID = false;

    document.querySelectorAll('#dynamic-add-inputs input[data-key]').forEach(inp => {
        const k = inp.dataset.key;
        let val = inp.value;
        payload[k] = isNaN(val) || val.trim() === '' ? val : parseFloat(val);
        if(k.toLowerCase().includes('id') && val.trim() !== '') hasCustomerID = true;
    });

    if(!hasCustomerID) {
        // Just a safe guard, we'll try to add it anyway
    }

    try {
        const csrfToken = await getCsrfToken();
        const res = await fetch(`${BASE_URL}/api/data/customers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        
        const result = await res.json();
        if (result.success) {
            document.getElementById('add-modal').style.display = 'none';
            loadDashboardData(); // Refresh everything instantly
        } else {
            alert(result.message || "Failed to add record");
        }
    } catch (err) {
        console.error("Save new record error:", err);
        alert("Server error.");
    }
}

async function deleteRecord(id) {
    if (!confirm("Permanently delete this customer record from the database?")) return;

    try {
        const res = await fetch(`${BASE_URL}/api/data/customers/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        const result = await res.json();
        if (result.success) {
            loadDashboardData(); // Refresh UI
        }
    } catch (err) {
        console.error(err);
        alert("Failed to delete record.");
    }
}

// ─────────────────────────────────────────────
// DATA FILTERING
// ─────────────────────────────────────────────
async function applyFilters() {
    const searchText = document.getElementById('filter-search').value.toLowerCase();
    const riskLevel = document.getElementById('filter-risk').value;

    const isReportsPage = !!document.getElementById('crm-table-body');
    if (isReportsPage) {
        try {
            currentPage = 1;
            const params = new URLSearchParams({ page: '1', limit: String(rowsPerPage) });
            if (searchText) params.set('search', searchText);
            if (riskLevel !== 'All') params.set('riskLevel', riskLevel);
            const res = await fetch(`${BASE_URL}/api/data/customers?${params.toString()}`, { credentials: 'include' });
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Filter failed');
            customerData = data.customers;
            totalPages = data.totalPages || 1;
            totalRecords = data.total || customerData.length;
            renderTable(customerData, true);
            return;
        } catch (err) {
            console.error(err);
            alert('Failed to apply filters.');
        }
    }

    const filtered = customerData.filter(c => {
        // Universal search: Check all string keys for search match
        let matchesSearch = false;
        if(searchText === '') matchesSearch = true;
        else {
            for(let key in c) {
                if(c[key] && String(c[key]).toLowerCase().includes(searchText)) {
                    matchesSearch = true;
                    break;
                }
            }
        }
        const matchesRisk = riskLevel === 'All' || c.risk_level === riskLevel;
        return matchesSearch && matchesRisk;
    });

    renderTable(filtered, 1);
}

// ─────────────────────────────────────────────
// PEAK AI EXTENSIONS
// ─────────────────────────────────────────────
function openXAI(reason1, reason2) {
    document.getElementById('xai-reason1').innerText = reason1 || "Generic predictive risk marker.";
    document.getElementById('xai-reason2').innerText = reason2 || "N/A";
    document.getElementById('xai-modal').style.display = 'flex';
}

async function askAI() {
    if (!globalStats) return alert("System stats not fully loaded yet.");
    document.getElementById('strategy-content').innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Computing global strategy with Gemini AI...`;
    document.getElementById('strategy-modal').style.display = 'flex';

    // Calculate MRR Average
    let totalMRR = 0;
    customerData.forEach(c => totalMRR += (parseFloat(c.MonthlyCharges) || 0));
    let avg_mrr = customerData.length > 0 ? (totalMRR / customerData.length).toFixed(2) : 0;

    const payload = {
        total: globalStats.total,
        safe: globalStats.green,
        warning: globalStats.yellow,
        high_risk: globalStats.red,
        avg_mrr: formatDatasetValue('MonthlyCharges', Number(avg_mrr) || 0)
    };

    try {
        const csrfToken = await getCsrfToken();
        const res = await fetch(`${BASE_URL}/api/grow/macro-strategy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('strategy-content').innerHTML = DOMPurify.sanitize(data.strategy);
        } else {
            document.getElementById('strategy-content').innerHTML = `<span style="color:var(--risk-red);"><i class='bx bx-error'></i> ${DOMPurify.sanitize(data.message)}</span>`;
        }
    } catch (err) {
        console.error(err);
        document.getElementById('strategy-content').innerHTML = `<span style="color:var(--risk-red);"><i class='bx bx-error'></i> Network failure reaching AI engine.</span>`;
    }
}

// ─────────────────────────────────────────────
// BULK ACTIONS
// ─────────────────────────────────────────────
function toggleSelectAll() {
    const mainCheck = document.getElementById('selectAllCheckbox');
    const rowChecks = document.querySelectorAll('.row-checkbox');
    
    rowChecks.forEach(chk => {
        chk.checked = mainCheck.checked;
        if (mainCheck.checked) selectedRows.add(chk.value);
        else selectedRows.delete(chk.value);
    });
    updateBulkActionBar();
}

function handleRowCheck(checkbox) {
    if (checkbox.checked) selectedRows.add(checkbox.value);
    else selectedRows.delete(checkbox.value);
    
    // Manage Main Checker state conceptually
    const mainCheck = document.getElementById('selectAllCheckbox');
    const rowChecks = document.querySelectorAll('.row-checkbox');
    mainCheck.checked = (selectedRows.size === rowChecks.length && rowChecks.length > 0);
    
    updateBulkActionBar();
}

function updateBulkActionBar() {
    const bar = document.getElementById('bulk-action-bar');
    if (selectedRows.size > 0) {
        document.getElementById('bulk-count').innerText = selectedRows.size;
        bar.style.display = 'flex';
    } else {
        bar.style.display = 'none';
        const mainCheck = document.getElementById('selectAllCheckbox');
        if(mainCheck) mainCheck.checked = false;
    }
}

async function executeBulkDelete() {
    if (selectedRows.size === 0) return;
    if (!confirm(`Are you absolutely sure you want to PERMANENTLY delete ${selectedRows.size} customers?`)) return;

    try {
        const csrfToken = await getCsrfToken();
        const res = await fetch(`${BASE_URL}/api/data/customers/bulk-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
            credentials: 'include',
            body: JSON.stringify({ action: 'delete', ids: Array.from(selectedRows) })
        });
        
        const data = await res.json();
        if (data.success) {
            selectedRows.clear();
            loadDashboardData(); // Rapid reload
        } else {
            alert("Bulk delete failed: " + data.message);
        }
    } catch (err) {
        console.error(err);
        alert("Server error during bulk delete.");
    }
}
