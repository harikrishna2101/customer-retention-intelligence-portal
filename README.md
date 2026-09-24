# CRIP — Customer Retention Intelligence Portal

> AI-powered churn prediction, customer lifecycle management, and retention automation platform.

<p align="center">
  <img src="logo.png" alt="CRIP Logo" width="120">
</p>

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | HTML5, CSS3, JavaScript (Vanilla), Chart.js, Vanta.js, Boxicons |
| **Backend** | Node.js, Express.js, Socket.IO, Mongoose |
| **Database** | MongoDB Atlas |
| **ML Engine** | Python 3, scikit-learn (Random Forest), FastAPI |
| **AI/NLP** | Google Gemini 2.5 Flash (Campaign Generation) |
| **Email** | Nodemailer (Gmail SMTP) |
| **Security** | Helmet, CSRF (csrf-csrf), Rate Limiting, bcrypt, express-mongo-sanitize |
| **Scheduling** | node-cron (Daily Recalibration + Weekly Digest) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      CRIP Frontend                           │
│  ┌─────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────────┐│
│  │Dashboard│ │  Reports  │ │ Grow     │ │ Helpdesk / Billing ││
│  │(Charts) │ │ (Table)   │ │ Corner   │ │ Billing / Profile││
│  └────┬────┘ └─────┬─────┘ └────┬─────┘ └────────┬─────────┘│
└───────┼────────────┼────────────┼─────────────────┼──────────┘
        │            │            │                 │
        ▼            ▼            ▼                 ▼
┌──────────────────────────────────────────────────────────────┐
│                   Express.js API Server                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │ /api/auth│ │/api/data │ │/api/grow │ │  /api/contact    ││
│  │(JWT+OTP) │ │(CRUD,CSV)│ │(AI,Email)│ │  (Contact Form)  ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
│                       │                                      │
│              ┌────────┴────────┐                             │
│              ▼                 ▼                             │
│     ┌──────────────┐  ┌──────────────────┐                  │
│     │  MongoDB     │  │  FastAPI ML      │                  │
│     │  Atlas       │  │  Engine (Python) │                  │
│     └──────────────┘  └──────────────────┘                  │
│                                │                             │
│                       ┌────────┴────────┐                    │
│                       ▼                 ▼                    │
│              ┌──────────────┐  ┌──────────────────┐         │
│              │ Random Forest│  │ SHAP Explainable │         │
│              │ Classifier   │  │ AI (XAI)         │         │
│              └──────────────┘  └──────────────────┘         │
└──────────────────────────────────────────────────────────────┘
```

---

## ML Model Performance

| Metric | Score |
|--------|-------|
| Algorithm | Random Forest Classifier |
| Train/Test Split | 80/20 (Stratified) |
| Accuracy | 79.56% |
| Precision | 63.28% |
| Recall | 48.93% |
| F1 Score | 55.18% |
| AUC-ROC | 84.12% |

> Evaluated against Logistic Regression, XGBoost, and Decision Tree. Random Forest selected for best AUC-ROC.

---

## Features

### Core Modules
- **Churn Prediction** — ML-powered risk scoring with explainable AI (XAI) reasons
- **Dashboard Analytics** — Real-time charts, health score badges, risk labels (HIGH/MEDIUM/LOW)
- **Customer Management** — Full CRUD with CSV bulk upload and metadata storage

### AI & Automation
- **Gemini AI Campaigns** — Auto-generated retention emails with one-click dispatch
- **A/B Testing Framework** — Variant assignment, outcome tracking, retention rate comparison
- **What-If Simulator** — Live predictive sandbox for scenario-based risk analysis
- **Macro Strategy Generator** — C-level advisory powered by portfolio-wide analysis

### Operations
- **Helpdesk Ticketing** — Priority-based support tickets linked to customer records
- **Billing Analytics** — Revenue charts, payment method analysis, renewal calendar
- **Reports & Export** — CSV/PDF export, advanced filtering, paginated data tables
- **CRON Jobs** — Daily ML recalibration + proactive risk alerts + weekly email digests

### Security
- JWT authentication with HTTP-only cookies
- OTP-based two-factor verification
- Helmet, CSRF protection, rate limiting
- MongoDB injection sanitization (express-mongo-sanitize)
- bcrypt password hashing

---

## Setup

### Prerequisites
- Node.js 18+
- Python 3.9+
- MongoDB Atlas account

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd crip

# Install backend dependencies
cd backend
npm install

# Install ML dependencies
cd ml
pip install -r requirements.txt

# Train the model
python train.py ../../cripdatasets/Telco-Customer-Churn.csv
```

### Configuration

Create `backend/.env`:

```env
MONGO_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/crip
JWT_SECRET=<your-secret>
EMAIL_USER=<gmail-address>
EMAIL_APP_PASSWORD=<gmail-app-password>
GEMINI_API_KEY=<google-gemini-key>
ML_ENGINE_URL=http://localhost:8000/predict
```

### Run

```bash
# Start the ML microservice
cd backend/ml
python main.py

# Start the Node.js server (in another terminal)
cd backend
npm start
```

Navigate to `http://localhost:5000`

---

## Project Structure

```
crip/
├── backend/
│   ├── server.js          # Express app entry point
│   ├── cron.js            # Scheduled jobs (recalibration, digests)
│   ├── routes/
│   │   ├── auth.js        # Authentication (register, login, OTP, reset)
│   │   ├── data.js        # Customer CRUD, CSV upload, stats, ML metrics
│   │   ├── grow.js        # AI campaigns, A/B testing, what-if, strategy
│   │   └── contact.js     # Contact form handler
│   ├── models/            # Mongoose schemas (User, Customer, Campaign, Ticket, Activity)
│   ├── utils/
│   │   ├── shared.js      # Shared middleware (protect, cleanupTempFile, escapeHtml)
│   │   └── mailer.js      # Email transporter
│   └── ml/
│       ├── train.py       # Model training with validation metrics
│       ├── predict.py     # Batch prediction logic
│       ├── main.py        # FastAPI ML microservice
│       └── model.pkl      # Trained model artifact
├── dashboard.html         # Main analytics dashboard
├── dashboard.js           # Dashboard logic (charts, health badge, ML metrics)
├── reports.html           # Customer data table with filtering
├── customer.html          # Customer details page
├── campaigns.html         # Campaign management
├── helpdesk.html          # Support ticket system
├── billing.html           # Revenue analytics
├── grow.html              # AI Growth Corner
├── profile.html           # User profile management
├── future-scope.html      # Development roadmap
├── testing.html           # System testing results
├── styles.css             # Global design system
├── script.js              # Shared frontend utilities
└── nav.js                 # Navigation & theme toggle
```

---

## Team

Built at **MGIT, Hyderabad** as a B.Tech Industry-Oriented Mini Project.
