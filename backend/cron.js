const cron = require('node-cron');
const axios = require('axios');
const nodemailer = require('nodemailer');
const Customer = require('./models/Customer');
const Activity = require('./models/Activity');
const User = require('./models/User');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { cleanupTempFile } = require('./utils/shared');

// cleanupTempFile imported from ./utils/shared.js (DRY)

// ─────────────────────────────────────────────
// Mailer Setup
// ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD }
});

// ─────────────────────────────────────────────
// DAILY 3 AM — ML Recalibration + Proactive Alerts
// ─────────────────────────────────────────────
cron.schedule('0 3 * * *', async () => {
    console.log('[CRON] Initiating 24-Hour ML Recalibration + Proactive Alert scan...');
    try {
        const uniqueUsers = await Customer.distinct('uploadedBy');
        if (uniqueUsers.length === 0) return;

        for (const userId of uniqueUsers) {
            const customers = await Customer.find({ uploadedBy: userId }).lean();
            if (customers.length === 0) continue;

            // Generate synthetic CSV for ML
            const tempPath = path.join(__dirname, 'uploads', `cron_${Date.now()}_${userId}.csv`);
            let csvContent = '';
            let keys = new Set();

            customers.forEach(c => {
                const flat = { ...c, ...(c.metadata || {}) };
                delete flat.metadata; delete flat._id; delete flat.uploadedBy;
                delete flat.createdAt; delete flat.updatedAt; delete flat.__v;
                Object.keys(flat).forEach(k => keys.add(k));
            });

            const keysArr = Array.from(keys);
            csvContent += keysArr.join(',') + '\n';
            customers.forEach(c => {
                const flat = { ...c, ...(c.metadata || {}) };
                const row = keysArr.map(k => {
                    let v = flat[k] !== undefined && flat[k] !== null ? flat[k] : '';
                    return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v;
                });
                csvContent += row.join(',') + '\n';
            });

            if (!fs.existsSync(path.join(__dirname, 'uploads'))) fs.mkdirSync(path.join(__dirname, 'uploads'));
            fs.writeFileSync(tempPath, csvContent);

            let readStream = null;
            try {
                const formData = new FormData();
                readStream = fs.createReadStream(tempPath);
                formData.append('file', readStream);
                const aiResponse = await axios.post(process.env.ML_ENGINE_URL || 'http://localhost:8000/predict', formData, { headers: formData.getHeaders() });
                readStream.destroy();

                const mlData = aiResponse.data.data;

                let bulkOps = [];
                let newRisksCount = 0;
                const alertedCustomers = [];

                // Fetch user for alert threshold
                const user = await User.findById(userId).lean();
                const alertThreshold = user ? (user.alertThreshold || 80) : 80;

                customers.forEach(c => {
                    const cid = String(c.customerID || '');
                    const mlRecord = mlData[cid];
                    if (!mlRecord) return;

                    const prevScore = c.risk_score || 0;
                    const newScore  = mlRecord.risk_score || 0;

                    // Track new high-risk emergence
                    if (c.risk_level !== 'High Risk' && mlRecord.risk_level === 'High Risk') newRisksCount++;

                    // Track threshold crossing for proactive alert
                    if (prevScore < alertThreshold && newScore >= alertThreshold) {
                        alertedCustomers.push({ customerID: cid, newScore, reason: mlRecord.xai_reason1 });
                    }

                    bulkOps.push({
                        updateOne: {
                            filter: { _id: c._id },
                            update: {
                                $set: {
                                    prev_risk_score: prevScore,
                                    risk_score: newScore,
                                    risk_level: mlRecord.risk_level,
                                    xai_reason1: mlRecord.xai_reason1,
                                    xai_reason2: mlRecord.xai_reason2,
                                    clv: mlRecord.clv || null,
                                    health_score: mlRecord.health_score || null
                                }
                            }
                        }
                    });
                });

                if (bulkOps.length > 0) await Customer.bulkWrite(bulkOps);

                if (newRisksCount > 0) {
                    await Activity.create({
                        user: userId,
                        icon: 'bx-radar',
                        color: 'var(--risk-yellow)',
                        title: 'CRON: ML Recalibration Complete',
                        sub: `Identified ${newRisksCount} new high-risk customers overnight.`
                    });
                }

                // ── Proactive Alert Email ──
                if (alertedCustomers.length > 0 && user && user.email) {
                    const alertRows = alertedCustomers.map(a =>
                        `<tr><td style="padding:8px;border-bottom:1px solid #333;">${a.customerID}</td>
                         <td style="padding:8px;border-bottom:1px solid #333;color:#ef4444;font-weight:bold;">${a.newScore}%</td>
                         <td style="padding:8px;border-bottom:1px solid #333;color:#aaa;font-size:12px;">${a.reason || '—'}</td></tr>`
                    ).join('');

                    await transporter.sendMail({
                        from: `"CRIP Alert System" <${process.env.EMAIL_USER}>`,
                        to: user.email,
                        subject: `⚠ CRIP Alert: ${alertedCustomers.length} Customer(s) Crossed Risk Threshold`,
                        html: `
                        <div style="font-family:Inter,sans-serif;background:#0a0a0a;color:#fff;padding:32px;max-width:600px;margin:auto;border-radius:12px;">
                            <h2 style="color:#ef4444;">Proactive Risk Alert</h2>
                            <p style="color:#aaa;">The following customers just crossed your risk alert threshold of <strong style="color:#fff">${alertThreshold}%</strong>:</p>
                            <table style="width:100%;border-collapse:collapse;margin-top:16px;">
                                <tr style="background:#1a1a1a;"><th style="padding:8px;text-align:left;">Customer ID</th><th style="padding:8px;text-align:left;">Risk Score</th><th style="padding:8px;text-align:left;">Primary Reason</th></tr>
                                ${alertRows}
                            </table>
                            <p style="margin-top:24px;color:#aaa;font-size:13px;">Log in to <a href="http://localhost:5000/reports.html" style="color:#7c3aed;">CRIP Dashboard</a> to take action.</p>
                        </div>`
                    });
                    console.log(`[CRON] Proactive alert sent for user ${user.email}: ${alertedCustomers.length} customers.`);
                }

                await cleanupTempFile(tempPath, 'recalibration CSV');
            } catch (mlErr) {
                console.error(`[CRON] ML failed for user ${userId}:`, mlErr.message);
                if (readStream) readStream.destroy();
                await cleanupTempFile(tempPath, 'recalibration CSV');
            }
        }
        console.log('[CRON] Recalibration + Alert cycle complete.');
    } catch (err) {
        console.error('[CRON] Recalibration failed:', err);
    }
});

// ─────────────────────────────────────────────
// WEEKLY MONDAY 9 AM — Digest Email
// ─────────────────────────────────────────────
cron.schedule('0 9 * * 1', async () => {
    console.log('[CRON] Sending weekly digest emails...');
    try {
        const users = await User.find({}).lean();

        for (const user of users) {
            const customers = await Customer.find({ uploadedBy: user._id }).lean();
            if (customers.length === 0) continue;

            const total    = customers.length;
            const highRisk = customers.filter(c => c.risk_level === 'High Risk').length;
            const warning  = customers.filter(c => c.risk_level === 'Warning').length;
            const safe     = customers.filter(c => c.risk_level === 'Safe').length;
            const avgHealth = Math.round(customers.reduce((a, c) => a + (c.health_score || 0), 0) / total);
            const totalClv  = customers.reduce((a, c) => a + (c.clv || 0), 0);
            const revenueAtRisk = customers
                .filter(c => c.risk_level === 'High Risk')
                .reduce((a, c) => a + (c.clv || 0), 0);

            // Top 3 riskiest customers
            const top3 = [...customers]
                .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0))
                .slice(0, 3);

            const top3Rows = top3.map(c =>
                `<tr>
                    <td style="padding:8px;border-bottom:1px solid #222;">${c.customerID}</td>
                    <td style="padding:8px;border-bottom:1px solid #222;color:#ef4444;font-weight:bold;">${c.risk_score || 0}%</td>
                    <td style="padding:8px;border-bottom:1px solid #222;color:#aaa;font-size:12px;">${c.xai_reason1 ? c.xai_reason1.slice(0, 80) + '...' : '—'}</td>
                </tr>`
            ).join('');

            await transporter.sendMail({
                from: `"CRIP Weekly Digest" <${process.env.EMAIL_USER}>`,
                to: user.email,
                subject: `Your CRIP Weekly Summary — ${new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' })}`,
                html: `
                <div style="font-family:Inter,sans-serif;background:#0a0a0a;color:#fff;padding:32px;max-width:600px;margin:auto;border-radius:12px;">
                    <h2 style="margin-bottom:4px;">Weekly Churn Intelligence Report</h2>
                    <p style="color:#666;margin-bottom:24px;">${user.organization} · ${new Date().toLocaleDateString()}</p>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">
                        <div style="background:#1a1a1a;border-radius:8px;padding:16px;">
                            <div style="color:#888;font-size:12px;">Total Customers</div>
                            <div style="font-size:28px;font-weight:700;">${total.toLocaleString()}</div>
                        </div>
                        <div style="background:#1a1a1a;border-radius:8px;padding:16px;">
                            <div style="color:#888;font-size:12px;">High Risk</div>
                            <div style="font-size:28px;font-weight:700;color:#ef4444;">${highRisk.toLocaleString()}</div>
                        </div>
                        <div style="background:#1a1a1a;border-radius:8px;padding:16px;">
                            <div style="color:#888;font-size:12px;">Avg Health Score</div>
                            <div style="font-size:28px;font-weight:700;color:#22c55e;">${avgHealth}/100</div>
                        </div>
                        <div style="background:#1a1a1a;border-radius:8px;padding:16px;">
                            <div style="color:#888;font-size:12px;">Revenue at Risk</div>
                            <div style="font-size:28px;font-weight:700;color:#f59e0b;">$${Math.round(revenueAtRisk).toLocaleString()}</div>
                        </div>
                    </div>

                    <h3 style="margin-bottom:12px;color:#aaa;">Top At-Risk Customers</h3>
                    <table style="width:100%;border-collapse:collapse;">
                        <tr style="background:#1a1a1a;"><th style="padding:8px;text-align:left;">Customer</th><th style="padding:8px;text-align:left;">Risk</th><th style="padding:8px;text-align:left;">Reason</th></tr>
                        ${top3Rows}
                    </table>

                    <div style="margin-top:28px;text-align:center;">
                        <a href="http://localhost:5000/dashboard.html" style="background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Open Dashboard</a>
                    </div>
                    <p style="margin-top:24px;color:#444;font-size:12px;text-align:center;">CRIP Enterprise · Automated Weekly Digest · Sent every Monday at 9 AM</p>
                </div>`
            });

            console.log(`[CRON] Weekly digest sent to ${user.email}`);
        }
    } catch (err) {
        console.error('[CRON] Weekly digest failed:', err);
    }
});

module.exports = cron;
