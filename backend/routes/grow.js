const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Campaign = require('../models/Campaign');
const Activity = require('../models/Activity');
const { GoogleGenAI } = require('@google/genai');
const nodemailer = require('nodemailer');
const fs = require('fs');
const { finished } = require('stream/promises');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { protect, cleanupTempFile } = require('../utils/shared');

const INTERNAL_CUSTOMER_KEYS = new Set([
    '_id', 'uploadedBy', 'createdAt', 'updatedAt', '__v',
    'risk_level', 'risk_score', 'prev_risk_score', 'xai_reason1', 'xai_reason2',
    'clv', 'health_score', 'renewalDate',
    'crm_stage', 'ab_variant', 'campaign_sent_at', 'campaign_outcome',
    'actionHistory', 'metadata'
]);

function isDatasetField(key, value) {
    if (INTERNAL_CUSTOMER_KEYS.has(key)) return false;
    if (value !== null && typeof value === 'object') return false;
    return true;
}

function csvCell(value) {
    if (value === undefined || value === null) return '';
    if (value instanceof Date) value = value.toISOString();
    else if (typeof value === 'object') value = JSON.stringify(value);
    return `"${String(value).replace(/"/g, '""')}"`;
}

// protect and cleanupTempFile imported from ../utils/shared.js (DRY)

// ─────────────────────────────────────────────
// True Generative AI Engine 
// ─────────────────────────────────────────────
let ai_client = null;
if (process.env.GEMINI_API_KEY) {
    ai_client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
    console.warn("⚠️ No GEMINI_API_KEY found in .env! Generating fallback text instead.");
}

// ─────────────────────────────────────────────
// POST /api/grow/what-if - Live Predictive Sandbox
// ─────────────────────────────────────────────
router.post('/what-if', protect, async (req, res) => {
    let tempPath = null;
    try {
        const payload = {};
        Object.entries(req.body || {}).forEach(([key, value]) => {
            if (isDatasetField(key, value)) payload[key] = value;
        });

        // 1. Fetch user's customer count to ensure enough training context
        const count = await Customer.countDocuments({ uploadedBy: req.user.userId });
        
        if (count < 5) {
            return res.status(400).json({ success: false, message: "You need at least 5 customers uploaded before the sandbox can simulate predictions." });
        }

        // 2. Prepare the synthetic row
        const SYNTHETIC_ID = '__whatif_synthetic__';
        const syntheticRow = { ...payload, customerID: SYNTHETIC_ID };

        // 3. Collect all column keys by sampling the first 100 records
        const sampleCustomers = await Customer.find({ uploadedBy: req.user.userId }).limit(100).lean();
        const allKeys = new Set();
        sampleCustomers.forEach(c => {
            const flat = { ...c, ...(c.metadata || {}) };
            Object.entries(flat).forEach(([k, v]) => {
                if (isDatasetField(k, v) || k === 'customerID') allKeys.add(k);
            });
        });
        Object.keys(syntheticRow).forEach(k => allKeys.add(k));
        const keysArr = Array.from(allKeys);

        // 4. Stream data to CSV
        tempPath = path.join(__dirname, '..', 'uploads', `whatif_${Date.now()}.csv`);
        if (!fs.existsSync(path.join(__dirname, '..', 'uploads'))) {
            fs.mkdirSync(path.join(__dirname, '..', 'uploads'));
        }

        const writeStream = fs.createWriteStream(tempPath);
        writeStream.write(keysArr.map(csvCell).join(',') + '\n');

        const cursor = Customer.find({ uploadedBy: req.user.userId }).lean().cursor();
        for await (const doc of cursor) {
            const flat = { ...doc, ...(doc.metadata || {}) };
            const rowStr = keysArr.map(k => csvCell(flat[k])).join(',') + '\n';
            if (!writeStream.write(rowStr)) {
                await new Promise(resolve => writeStream.once('drain', resolve));
            }
        }

        // Write synthetic row last
        const synthStr = keysArr.map(k => csvCell(syntheticRow[k])).join(',') + '\n';
        writeStream.write(synthStr);
        writeStream.end();

        await finished(writeStream);
        
        // Read file synchronously into a memory buffer to prevent active OS file-handle streams from locking on Windows
        const fileBuffer = fs.readFileSync(tempPath);

        // 5. Send to FastAPI using FormData
        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: 'whatif.csv',
            contentType: 'text/csv'
        });

        const aiResponse = await axios.post(process.env.ML_ENGINE_URL || 'http://localhost:8000/predict', formData, {
            headers: formData.getHeaders()
        });
        const mlData = aiResponse.data.data;

        await cleanupTempFile(tempPath, 'what-if CSV');

        // 6. Extract only the synthetic row result
        const result = mlData[SYNTHETIC_ID];
        if (result) {
            return res.json({ success: true, result });
        }

        return res.status(500).json({ success: false, message: "ML Engine could not score the synthetic record." });

    } catch(err) {
        const detail = err?.response?.data?.detail || err?.response?.data?.message || err?.message || String(err || 'Unknown error');
        console.error("What-If Engine Error:", detail);
        if (err?.stack) console.error(err.stack);
        await cleanupTempFile(tempPath, 'what-if CSV');
        return res.status(500).json({ success: false, message: "What-If engine failed: " + detail });
    }
});


const aiDraftCache = new Map();
let geminiUnavailableUntil = 0;

function buildFallbackAction(customer, type, reason1, reason2) {
    const reason = [reason1, reason2].filter(Boolean).join(' ');
    let subject = "Let's make your plan work better for you";
    let body = `Hi Customer ${customer.customerID},\n\nWe noticed a few signals that you may not be getting the full value from your current plan. We would like to help with a quick review, answer any concerns, and suggest the best next step for your account.\n\nWould you be open to a short call this week?\n\nBest,\nCustomer Success Team`;

    if (reason.toLowerCase().includes('charge') || reason.toLowerCase().includes('price') || reason.toLowerCase().includes('cost')) {
        subject = "A better-fit offer for your account";
        body = `Hi Customer ${customer.customerID},\n\nWe noticed your account may be sensitive to billing or plan value. We can review your current usage and suggest a better-fit option, including any available retention offer.\n\nWould you like us to send a quick recommendation?\n\nBest,\nCustomer Success Team`;
    } else if (reason.toLowerCase().includes('contract')) {
        subject = "A simpler contract option for your account";
        body = `Hi Customer ${customer.customerID},\n\nWe noticed your contract status may be affecting your experience. We can help you compare flexible options and choose the plan that gives you the most value without unnecessary friction.\n\nCan we help you review it?\n\nBest,\nCustomer Success Team`;
    } else if (reason.toLowerCase().includes('support') || reason.toLowerCase().includes('service')) {
        subject = "We'd like to help resolve your service concerns";
        body = `Hi Customer ${customer.customerID},\n\nWe noticed signals that your recent experience may need support attention. We would like to prioritize your account, understand what went wrong, and help resolve it quickly.\n\nCould we schedule a support callback?\n\nBest,\nCustomer Success Team`;
    }

    return { type, subject, body, source: 'fallback' };
}

async function generateAIAction(customer) {
    const reason1 = customer.xai_reason1 || 'General At-Risk Warning';
    const reason2 = customer.xai_reason2 || '';
    
    let type = "Custom AI Retention";
    if (reason1.toLowerCase().includes('charge')) type = "Discount Offer";
    else if (reason1.toLowerCase().includes('tenure')) type = "Onboarding Support";
    else if (reason1.toLowerCase().includes('contract')) type = "Contract Upgrade Incentive";
    
    const cacheKey = String(customer._id || customer.customerID);
    if (aiDraftCache.has(cacheKey)) return aiDraftCache.get(cacheKey);

    // If Gemini is configured and healthy, use real Generative AI
    if (ai_client && Date.now() > geminiUnavailableUntil) {
        try {
            const prompt = `You are a Customer Success Manager at a SaaS/Telco company. 
I have a customer (ID: ${customer.customerID}) who is at severe risk of churning (${customer.risk_score}% probability).
Our Explainable AI detected the following exact reasons they might churn:
1. ${reason1}
2. ${reason2}

Write a short, professional, and directly actionable email draft to save this customer. Address the reasons specifically but elegantly (no robotic terminology).
Return your response STRICTLY as a JSON object, exactly like this:
{"subject": "The Subject Line", "body": "The email body..."}
Do not return markdown, only the raw JSON.`;

            const response = await Promise.race([
                ai_client.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini request timed out')), 6000))
            ]);
            
            let jsonString = response.text;
            // Clean markdown JSON ticks if present
            if (jsonString.startsWith('```json')) jsonString = jsonString.slice(7, -3);
            else if (jsonString.startsWith('```')) jsonString = jsonString.slice(3, -3);
            
            const aiData = JSON.parse(jsonString.trim());
            const draft = { type, subject: aiData.subject, body: aiData.body, source: 'gemini' };
            aiDraftCache.set(cacheKey, draft);
            return draft;
            
        } catch (e) {
            const status = e.status || e.code || 'unknown';
            console.error(`[GROW] Gemini draft failed (${status}). Using local fallback draft.`);
            if (status === 429 || status === 503) {
                geminiUnavailableUntil = Date.now() + 2 * 60 * 1000;
            }
        }
    }
    
    const fallback = buildFallbackAction(customer, type, reason1, reason2);
    aiDraftCache.set(cacheKey, fallback);
    return fallback;
}

router.get('/campaigns', protect, async (req, res) => {
    try {
        const customers = await Customer.find({ 
            uploadedBy: new mongoose.Types.ObjectId(req.user.userId),
            risk_level: { $in: ['High Risk', 'Warning'] }
        })
        .sort({ risk_score: -1 })
        .limit(10); // Batch AI prompts
        
        let campaigns = [];
        for (const cust of customers) {
            const aiDraft = await generateAIAction(cust);
            const meta = cust.metadata instanceof Map
                ? Object.fromEntries(cust.metadata)
                : (cust.metadata || {});
            const emailKey = Object.keys(meta).find(k => ['email', 'customer_email', 'customeremail'].includes(k.toLowerCase()));
            campaigns.push({
                _id: cust._id,
                customerID: cust.customerID,
                risk_level: cust.risk_level,
                risk_score: cust.risk_score,
                primary_reason: cust.xai_reason1 || "General At-Risk",
                campaign_type: aiDraft.type,
                email_subject: aiDraft.subject,
                email_body: aiDraft.body,
                draft_source: aiDraft.source,
                recipient_email: emailKey ? meta[emailKey] : null
            });
        }
        
        return res.json({ success: true, count: campaigns.length, campaigns });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Failed to generate AI campaigns." });
    }
});

// Phase 4 - Real Send Hook
router.post('/send', protect, async (req, res) => {
    try {
        const { target_id, subject, body, target_email } = req.body;
        if (!subject || !body) {
            return res.status(400).json({ success: false, message: 'Subject and body are required.' });
        }
        
        let recipient = null;
        if (target_id) {
            const customer = await Customer.findOne({ _id: target_id, uploadedBy: req.user.userId }).lean();
            if (!customer) return res.status(404).json({ success: false, message: 'Target customer not found.' });

            const meta = customer.metadata instanceof Map
                ? Object.fromEntries(customer.metadata)
                : (customer.metadata || {});
            const emailKey = Object.keys(meta).find(k => ['email', 'customer_email', 'customeremail'].includes(k.toLowerCase()));
            if (emailKey && String(meta[emailKey]).includes('@')) recipient = String(meta[emailKey]).trim();
        }
        if (target_email && target_email.includes('@')) {
            recipient = target_email.trim();
        }
        if (!recipient && !target_id) recipient = process.env.EMAIL_USER;
        if (!recipient) {
            return res.status(400).json({ success: false, message: 'No customer email found. Keep this as a draft or add an email column to the dataset.' });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail', // Extensible for SendGrid/Mailgun SMTP
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_APP_PASSWORD,
            },
        });

        const mailOptions = {
            from: `"CRIP Growth AI" <${process.env.EMAIL_USER}>`,
            to: recipient,
            subject: `[DISPATCH] ${subject}`,
            text: body,
        };

        await transporter.sendMail(mailOptions);
        if (target_id) {
            await Customer.findOneAndUpdate(
                { _id: target_id, uploadedBy: req.user.userId },
                {
                    $set: { campaign_sent_at: new Date(), campaign_outcome: 'pending' },
                    $push: {
                        actionHistory: {
                            type: 'email',
                            text: `Retention email sent to ${recipient}.`
                        }
                    }
                }
            );
        }
        
        return res.json({ success: true, message: `Email deployed to ${recipient}!` });
    } catch (e) {
        console.error("Mailer routing Error:", e);
        return res.status(500).json({ success: false, message: "Server mailer failed." });
    }
});

// ─────────────────────────────────────────────
// GET /api/grow/macro-strategy - Corporate Level Advisory
// ─────────────────────────────────────────────
router.post('/macro-strategy', protect, async (req, res) => {
    try {
        const { total, safe, warning, high_risk, avg_mrr } = req.body;
        
        if (!ai_client) {
            return res.json({ 
                success: true, 
                strategy: "Gemini AI Engine is currently offline (No API Key). Please provision credentials to receive your custom macroeconomic directive." 
            });
        }

        const prompt = `You are an elite C-level Corporate Strategist advising a SaaS/Telco company.
Here are the current live metrics of the customer database:
- Total Customers: ${total}
- Safe/Stable: ${safe}
- Warning Status: ${warning}
- High Risk (Immediate Churn Danger): ${high_risk}
- Average MRR (Monthly Recurring Revenue) per user: $${avg_mrr || 0}

Write a stark, highly-professional, and purely analytical 3-paragraph macro-economic strategy. 
Paragraph 1: Assess the severity of the risk distribution.
Paragraph 2: Propose exactly which global contract or pricing shift should be enacted to plug the churn leak.
Paragraph 3: Suggest a marketing directive to aggressively acquire safer profiles.
Format beautifully with HTML tags inside a single string (use <b>, <i>, <br> only, do NOT use markdown tables or blocks).`;

        const response = await ai_client.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        
        let strategyHTML = response.text;
        
        // Log this high-level activity
        await Activity.create({ 
            user: req.user.userId, 
            icon: 'bx-network-chart',
            color: '#4facfe',
            title: `AI Macro Strategy`, 
            sub: `Generated elite corporate advisory strategy.` 
        });

        return res.json({ success: true, strategy: strategyHTML });

    } catch (err) {
        console.error("Macro Strategy AI Error:", err);
        return res.status(500).json({ success: false, message: "AI Engine failed to compute strategy. Error: " + err.message });
    }
});

// ─────────────────────────────────────────────
// POST /api/grow/dispatch - Tag campaign variant (A/B) on dispatch
// ─────────────────────────────────────────────
router.post('/dispatch', protect, async (req, res) => {
    try {
        const { customerIds } = req.body;
        if (!customerIds || customerIds.length === 0) {
            return res.status(400).json({ success: false, message: 'No customers selected.' });
        }

        // Randomly assign A or B variant per customer for A/B testing
        const bulkOps = customerIds.map((id, idx) => ({
            updateOne: {
                filter: { _id: id, uploadedBy: req.user.userId },
                update: { $set: {
                    ab_variant: idx % 2 === 0 ? 'A' : 'B',
                    campaign_sent_at: new Date(),
                    campaign_outcome: 'pending'
                }}
            }
        }));
        await Customer.bulkWrite(bulkOps);

        await Activity.create({
            user: req.user.userId,
            icon: 'bx-send',
            color: 'var(--risk-blue)',
            title: 'A/B Campaign Dispatched',
            sub: `Tagged ${customerIds.length} customers across Variant A & B for retention tracking.`
        });

        return res.json({ success: true, count: customerIds.length });
    } catch (err) {
        console.error('Dispatch A/B error:', err);
        return res.status(500).json({ success: false, message: 'Dispatch failed.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/grow/ab-outcome - Mark a customer outcome
// ─────────────────────────────────────────────
router.post('/ab-outcome', protect, async (req, res) => {
    try {
        const { customerId, outcome } = req.body;
        if (!['retained', 'churned'].includes(outcome)) {
            return res.status(400).json({ success: false, message: 'Invalid outcome.' });
        }
        await Customer.findOneAndUpdate(
            { _id: customerId, uploadedBy: req.user.userId },
            { $set: { campaign_outcome: outcome } }
        );
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to record outcome.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/grow/ab-stats - A/B Test Results Summary
// ─────────────────────────────────────────────
router.get('/ab-stats', protect, async (req, res) => {
    try {
        const userId = req.user.userId;
        const campaignCustomers = await Customer.find({
            uploadedBy: userId,
            ab_variant: { $in: ['A', 'B'] }
        }).lean();

        const stats = { A: { retained: 0, churned: 0, pending: 0, total: 0 }, B: { retained: 0, churned: 0, pending: 0, total: 0 } };
        campaignCustomers.forEach(c => {
            const v = c.ab_variant;
            if (!stats[v]) return;
            stats[v].total++;
            stats[v][c.campaign_outcome || 'pending']++;
        });

        const retentionA = stats.A.total > 0 ? Math.round((stats.A.retained / stats.A.total) * 100) : 0;
        const retentionB = stats.B.total > 0 ? Math.round((stats.B.retained / stats.B.total) * 100) : 0;

        return res.json({ success: true, stats, retentionA, retentionB });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to fetch A/B stats.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/grow/email/:customerId — Single-Customer AI Email Draft
// Returns AI subject + body for ONE specific customer (used by CRM drawer)
// ─────────────────────────────────────────────
router.get('/email/:customerId', protect, async (req, res) => {
    try {
        const customer = await Customer.findOne({
            _id: req.params.customerId,
            uploadedBy: req.user.userId
        }).lean();
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

        // Detect email field in metadata (any capitalisation)
        const meta = customer.metadata instanceof Map
            ? Object.fromEntries(customer.metadata)
            : (customer.metadata || {});
        const emailKey = Object.keys(meta).find(k => ['email', 'Email', 'EMAIL', 'customer_email', 'CustomerEmail'].includes(k));
        const recipientEmail = emailKey ? meta[emailKey] : null;

        const aiDraft = await generateAIAction(customer);
        return res.json({
            success: true,
            customerID: customer.customerID,
            risk_score: customer.risk_score,
            risk_level: customer.risk_level,
            campaign_type: aiDraft.type,
            email_subject: aiDraft.subject,
            email_body: aiDraft.body,
            recipient_email: recipientEmail   // null if not in dataset
        });
    } catch (err) {
        console.error('Single AI email error:', err);
        return res.status(500).json({ success: false, message: 'Failed to generate AI email.' });
    }
});

// ─────────────────────────────────────────────
// POST /api/grow/save-campaign — Save workflow to MongoDB
// ─────────────────────────────────────────────
router.post('/save-campaign', protect, async (req, res) => {
    try {
        const { name, trigger, nodes, status } = req.body;
        if (!name || !trigger || !nodes || nodes.length < 2) {
            return res.status(400).json({ success: false, message: 'Campaign needs a name, trigger, and at least 2 nodes.' });
        }
        const camp = await Campaign.create({
            createdBy: req.user.userId,
            name, trigger,
            nodes,
            status: status || 'draft'
        });
        await Activity.create({
            user: req.user.userId,
            icon: 'bx-git-branch',
            color: 'var(--risk-blue)',
            title: 'Campaign Saved',
            sub: `"${name}" saved with ${nodes.length} workflow nodes.`
        });
        return res.json({ success: true, campaign: camp });
    } catch (err) {
        console.error('Save campaign error:', err);
        return res.status(500).json({ success: false, message: 'Failed to save campaign.' });
    }
});

// ─────────────────────────────────────────────
// GET /api/grow/saved-campaigns — Retrieve all saved campaigns from MongoDB
// ─────────────────────────────────────────────
router.get('/saved-campaigns', protect, async (req, res) => {
    try {
        const campaigns = await Campaign.find({ createdBy: req.user.userId })
            .sort({ createdAt: -1 })
            .lean();

        // Compute live enrolled counts from customer risk scores
        const highRisk = await Customer.countDocuments({ uploadedBy: req.user.userId, risk_level: 'High Risk' });
        const warning  = await Customer.countDocuments({ uploadedBy: req.user.userId, risk_level: 'Warning' });

        const enriched = campaigns.map(c => ({
            ...c,
            enrolled: c.trigger.includes('75') ? highRisk
                    : c.trigger.toLowerCase().includes('payment') ? Math.round(highRisk * 0.4)
                    : c.trigger.toLowerCase().includes('inact')   ? warning
                    : highRisk + warning
        }));

        return res.json({ success: true, campaigns: enriched });
    } catch (err) {
        console.error('Get saved campaigns error:', err);
        return res.status(500).json({ success: false, message: 'Failed to fetch campaigns.' });
    }
});

// ─────────────────────────────────────────────
// DELETE /api/grow/saved-campaigns/:id — Remove a campaign from MongoDB
// ─────────────────────────────────────────────
router.delete('/saved-campaigns/:id', protect, async (req, res) => {
    try {
        const deleted = await Campaign.findOneAndDelete({ _id: req.params.id, createdBy: req.user.userId });
        if (!deleted) return res.status(404).json({ success: false, message: 'Campaign not found.' });
        return res.json({ success: true });
    } catch (err) {
        console.error('Delete campaign error:', err);
        return res.status(500).json({ success: false, message: 'Failed to delete campaign.' });
    }
});

module.exports = router;
