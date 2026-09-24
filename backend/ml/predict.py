import sys
import json
import pandas as pd
import numpy as np
import traceback
import os
import joblib
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

# Try to import SHAP — gracefully degrade if not installed
try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model.pkl')
_PRETRAINED_ARTIFACT = None
_PRETRAINED_LOADED = False

def load_pretrained_artifact():
    global _PRETRAINED_ARTIFACT, _PRETRAINED_LOADED
    if _PRETRAINED_LOADED:
        return _PRETRAINED_ARTIFACT

    _PRETRAINED_LOADED = True
    if not os.path.exists(MODEL_PATH):
        return None

    try:
        artifact = joblib.load(MODEL_PATH)
        if isinstance(artifact, dict) and artifact.get('model') is not None and artifact.get('features'):
            if hasattr(artifact['model'], 'n_jobs'):
                artifact['model'].n_jobs = 1
            _PRETRAINED_ARTIFACT = artifact
    except Exception as exc:
        print(f"ML Warn: failed to load pretrained model: {exc}", file=sys.stderr)
        _PRETRAINED_ARTIFACT = None

    return _PRETRAINED_ARTIFACT

def prepare_pretrained_features(df, artifact):
    X = pd.DataFrame(index=df.index)
    encoders = artifact.get('encoders', {})

    for feature in artifact['features']:
        if feature in df.columns:
            series = df[feature]
        else:
            series = pd.Series([0] * len(df), index=df.index)

        if feature in encoders:
            encoder = encoders[feature]
            known = set(encoder.classes_)
            values = series.astype(str).fillna('Unknown')
            fallback = encoder.classes_[0] if len(encoder.classes_) else ''
            safe_values = values.where(values.isin(known), fallback)
            X[feature] = encoder.transform(safe_values)
        else:
            X[feature] = pd.to_numeric(series, errors='coerce').fillna(0)

    return X

def run_pretrained(df, id_col, artifact):
    model = artifact['model']
    X = prepare_pretrained_features(df, artifact)
    probs = model.predict_proba(X)[:, 1] if hasattr(model, 'predict_proba') else model.predict(X)
    monetary_col = identify_monetary_column(df)
    tenure_col = identify_tenure_column(df)

    median_mrr = 0
    median_tenure = 12
    if monetary_col and monetary_col in df.columns:
        median_mrr = pd.to_numeric(df[monetary_col], errors='coerce').median()
    if tenure_col and tenure_col in df.columns:
        median_tenure = pd.to_numeric(df[tenure_col], errors='coerce').median()

    importances = getattr(model, 'feature_importances_', np.zeros(len(artifact['features'])))
    global_top = sorted(zip(artifact['features'], importances), key=lambda x: x[1], reverse=True)[:3]

    results = {}
    for i in range(len(df)):
        cid = format_record_id(df.iloc[i].get(id_col), f"row_{i}") if id_col else f"row_{i}"
        risk_score = int(min(100, max(0, probs[i] * 100)))

        if risk_score > 75:
            risk_level = "High Risk"
        elif risk_score > 40:
            risk_level = "Warning"
        else:
            risk_level = "Safe"

        reasons = []
        if risk_level != "Safe":
            for feat, imp in global_top:
                if imp > 0.01:
                    val = df.iloc[i][feat] if feat in df.columns else "missing"
                    reasons.append(f"'{feat}' = {val} is a pretrained churn predictor ({imp*100:.1f}% feature weight).")
                if len(reasons) >= 2:
                    break

        while len(reasons) < 2:
            reasons.append("")

        mrr_val = df.iloc[i][monetary_col] if monetary_col and monetary_col in df.columns else None
        tenure_val = df.iloc[i][tenure_col] if tenure_col and tenure_col in df.columns else None

        results[cid] = {
            "risk_score": risk_score,
            "risk_level": risk_level,
            "xai_reason1": reasons[0][:200] if reasons[0] else "Pretrained model classified as low churn probability.",
            "xai_reason2": reasons[1][:200] if reasons[1] else "",
            "clv": compute_clv(risk_score, mrr_val, median_mrr),
            "health_score": compute_health_score(risk_score, tenure_val, median_tenure, mrr_val, median_mrr)
        }

    return results

def identify_target_column(df):
    target_keywords = [
        'churn', 'churnvalue', 'churnlabel', 'churned',
        'canceled', 'cancelled', 'exit', 'exited', 'left',
        'status', 'label', 'riskbinary'
    ]
    for col in df.columns:
        c_lower = str(col).strip().lower()
        c_norm = c_lower.replace(' ', '').replace('_', '').replace('-', '')
        if c_norm in target_keywords:
            return col
    return None

def normalize_column_name(col):
    return str(col).strip().lower().replace(' ', '').replace('_', '').replace('-', '')

def identify_id_column(df):
    for col in df.columns:
        if normalize_column_name(col) in ['customerid', 'id', 'userid', 'clientid']:
            return col
    return None

def format_record_id(value, fallback):
    if pd.isna(value) or str(value).strip() == '':
        return fallback
    if isinstance(value, (int, np.integer)):
        return str(value)
    if isinstance(value, (float, np.floating)) and float(value).is_integer():
        return str(int(value))
    return str(value).strip()

def identify_monetary_column(df):
    """Find a monetary/MRR column for CLV calculation."""
    monetary_keywords = [
        'monthlycharges', 'mrr', 'revenue', 'amount', 'price', 'fee', 'charges',
        'avgordervalue', 'averageordervalue', 'ordervalue', 'totalspent', 'spent',
        'lifetimevalue', 'clv'
    ]
    for col in df.columns:
        if normalize_column_name(col) in monetary_keywords:
            return col
    return None

def identify_tenure_column(df):
    """Find a tenure column for health score calculation."""
    tenure_keywords = ['tenure', 'months', 'age', 'duration', 'period']
    for col in df.columns:
        if any(k in str(col).lower() for k in tenure_keywords):
            return col
    return None

def encode_categorical(df):
    encoded_df = df.copy()
    label_encoders = {}
    for col in encoded_df.columns:
        if encoded_df[col].dtype == 'object' or encoded_df[col].dtype.name == 'category':
            le = LabelEncoder()
            encoded_df[col] = le.fit_transform(encoded_df[col].astype(str).fillna('Unknown'))
            label_encoders[col] = le
    return encoded_df

def compute_clv(risk_score, monthly_charge, median_charge):
    """
    CLV = monthly_charge * predicted_months_remaining
    predicted_months_remaining = (1 - risk_score/100) * 24 (max 2 yrs)
    """
    mrr = float(monthly_charge) if pd.notna(monthly_charge) and monthly_charge != '' else float(median_charge or 0)
    if mrr <= 0:
        mrr = float(median_charge or 0)
    predicted_months = max(0, (1 - risk_score / 100) * 24)
    return round(mrr * predicted_months, 2)

def compute_health_score(risk_score, tenure_val, median_tenure, monthly_val, median_monthly):
    """
    Health = 0.4*(1 - risk_score/100) + 0.3*tenure_score + 0.3*payment_score
    tenure_score  = min(1, tenure / 72)  [72 months = 6 year cap]
    payment_score = min(1, monthly_charges / max_mrr)  [normalized]
    """
    risk_component = 1 - (risk_score / 100)

    t = float(tenure_val) if pd.notna(tenure_val) and str(tenure_val).strip() != '' else float(median_tenure or 12)
    tenure_score = min(1.0, t / 72.0)

    m = float(monthly_val) if pd.notna(monthly_val) and str(monthly_val).strip() != '' else float(median_monthly or 50)
    # Higher charges can indicate higher engagement/retention (enterprise customers)
    payment_score = min(1.0, m / max(float(median_monthly or 50) * 2, 1))

    health = (0.4 * risk_component) + (0.3 * tenure_score) + (0.3 * payment_score)
    return round(min(1.0, max(0.0, health)) * 100, 1)  # Return as 0-100

def run_supervised(df, target_col, id_col):
    results = {}
    monetary_col = identify_monetary_column(df)
    tenure_col = identify_tenure_column(df)

    df_clean = df.dropna(subset=[target_col]).copy()
    if len(df_clean[target_col].unique()) < 2:
        return run_unsupervised(df, id_col)

    y = df_clean[target_col]
    X_raw = df_clean.drop(columns=[target_col])
    if id_col and id_col in X_raw.columns:
        X_raw = X_raw.drop(columns=[id_col])

    X_encoded = encode_categorical(X_raw)
    for col in X_encoded.columns:
        if pd.api.types.is_numeric_dtype(X_encoded[col]):
            X_encoded[col] = X_encoded[col].fillna(X_encoded[col].median())
        else:
            X_encoded[col] = X_encoded[col].fillna(0)
    # Prevent extreme overfitting on tiny datasets (like LAYITUP which has 29 rows)
    # by limiting depth and setting min samples per leaf so the tree generalizes rather than memorizes.
    depth = min(3, len(X_encoded) // 8) if len(X_encoded) < 100 else 10
    min_samples = 3 if len(X_encoded) < 100 else 1
    rf = RandomForestClassifier(
        n_estimators=100, 
        random_state=42, 
        max_depth=max(2, depth), 
        min_samples_leaf=min_samples, 
        n_jobs=1
    )
    train_X = X_encoded.sample(n=min(15000, len(X_encoded)), random_state=42)
    train_y = y.loc[train_X.index].astype(str)
    rf.fit(train_X, train_y)

    classes = list(rf.classes_)
    pos_idx = -1
    for i, c in enumerate(classes):
        if str(c).lower() in ['yes', 'true', '1', 'churned', 'left']:
            pos_idx = i
            break
    if pos_idx == -1:
        pos_idx = 1 if len(classes) > 1 else 0

    probs = rf.predict_proba(X_encoded)[:, pos_idx]
    feat_names = list(X_encoded.columns)

    # ── SHAP-based per-customer XAI ──────────────────────────────────────
    shap_values_matrix = None
    if SHAP_AVAILABLE and len(X_encoded) <= 5000:
        try:
            explainer = shap.TreeExplainer(rf)
            shap_all = explainer.shap_values(X_encoded)
            # For binary classification, shap_values returns list[2]; use churn class index
            if isinstance(shap_all, list):
                shap_values_matrix = shap_all[pos_idx]
            elif getattr(shap_all, 'ndim', 0) == 3:
                shap_values_matrix = shap_all[:, :, pos_idx]
            else:
                shap_values_matrix = shap_all
        except Exception:
            shap_values_matrix = None

    # Pre-compute global feature importances as fallback
    importances = rf.feature_importances_
    global_top = sorted(zip(feat_names, importances), key=lambda x: x[1], reverse=True)[:3]

    # Pre-compute monetary medians for CLV / health
    median_mrr = 0
    median_tenure = 12
    if monetary_col and monetary_col in df.columns:
        try:
            median_mrr = pd.to_numeric(df[monetary_col], errors='coerce').median()
        except Exception:
            pass
    if tenure_col and tenure_col in df.columns:
        try:
            median_tenure = pd.to_numeric(df[tenure_col], errors='coerce').median()
        except Exception:
            pass

    for i in range(len(df_clean)):
        original_idx = df_clean.index[i]
        cid = format_record_id(df.loc[original_idx].get(id_col), f"row_{original_idx}") if id_col else f"row_{original_idx}"

        prob = probs[i]
        risk_score = int(min(100, max(0, prob * 100)))

        if risk_score > 75:
            risk_level = "High Risk"
        elif risk_score > 40:
            risk_level = "Warning"
        else:
            risk_level = "Safe"

        # ── SHAP per-customer reasons ──
        reasons = []
        if shap_values_matrix is not None and risk_level != "Safe":
            row_shap = shap_values_matrix[i]
            shap_pairs = sorted(zip(feat_names, row_shap), key=lambda x: abs(x[1]), reverse=True)
            for feat, sv in shap_pairs[:3]:
                if abs(sv) > 0.01:
                    raw_val = X_raw.iloc[i][feat] if feat in X_raw.columns else "N/A"
                    direction = "increases" if sv > 0 else "decreases"
                    reasons.append(f"'{feat}' = {raw_val} {direction} churn risk (SHAP impact: {sv:+.3f}).")
        elif risk_level != "Safe":
            for feat, imp in global_top:
                if imp > 0.05:
                    val = X_raw.iloc[i][feat] if feat in X_raw.columns else "N/A"
                    reasons.append(f"'{feat}' = {val} is a strong churn predictor ({imp*100:.1f}% feature weight).")

        while len(reasons) < 2:
            reasons.append("")

        # ── CLV & Health Score ──
        mrr_val = df.loc[original_idx, monetary_col] if monetary_col and monetary_col in df.columns else None
        tenure_val = df.loc[original_idx, tenure_col] if tenure_col and tenure_col in df.columns else None
        clv = compute_clv(risk_score, mrr_val, median_mrr)
        health = compute_health_score(risk_score, tenure_val, median_tenure, mrr_val, median_mrr)

        results[cid] = {
            "risk_score": risk_score,
            "risk_level": risk_level,
            "xai_reason1": reasons[0][:200] if reasons[0] else "Model classified as low churn probability.",
            "xai_reason2": reasons[1][:200] if reasons[1] else "",
            "clv": clv,
            "health_score": health
        }

    return results


def run_unsupervised(df, id_col):
    monetary_col = identify_monetary_column(df)
    tenure_col = identify_tenure_column(df)

    df_encoded = encode_categorical(df)
    if id_col and id_col in df_encoded.columns:
        dataset = df_encoded.drop(columns=[id_col])
    else:
        dataset = df_encoded.copy()

    numeric_df = dataset.select_dtypes(include=[np.number]).copy()
    for col in numeric_df.columns:
        numeric_df[col] = numeric_df[col].fillna(numeric_df.median(numeric_only=True).get(col, 0))
    numeric_df = numeric_df.dropna(axis=1, how='all')

    if numeric_df.empty:
        return generate_fallback(df, id_col)

    iso_forest = IsolationForest(n_estimators=100, contamination=0.15, random_state=42)
    training_df = numeric_df.sample(n=min(5000, len(numeric_df)), random_state=42)
    iso_forest.fit(training_df)
    scores = iso_forest.decision_function(numeric_df)
    predictions = iso_forest.predict(numeric_df)

    means = numeric_df.mean()
    stds = numeric_df.std()

    # Pre-compute medians for CLV / health
    median_mrr = 0
    median_tenure = 12
    if monetary_col and monetary_col in df.columns:
        try:
            median_mrr = pd.to_numeric(df[monetary_col], errors='coerce').median()
        except Exception:
            pass
    if tenure_col and tenure_col in df.columns:
        try:
            median_tenure = pd.to_numeric(df[tenure_col], errors='coerce').median()
        except Exception:
            pass

    results = {}
    for i in range(len(df)):
        cid = format_record_id(df.iloc[i].get(id_col), f"row_{i}") if id_col else f"row_{i}"

        raw_score = scores[i]
        normalized_risk = max(0, min(100, 50 - (raw_score * 200)))

        if predictions[i] == -1:
            risk = "High Risk"
        elif normalized_risk > 60:
            risk = "Warning"
        else:
            risk = "Safe"

        reasons = []
        if risk != "Safe":
            deviations = []
            for col in numeric_df.columns:
                std_dev = stds[col]
                row_val = numeric_df.iloc[i][col]
                if std_dev > 0 and pd.notna(row_val):
                    z_score = abs((row_val - means[col]) / std_dev)
                    deviations.append((col, z_score, row_val, means[col]))
            deviations.sort(key=lambda x: x[1], reverse=True)
            for dev in deviations[:2]:
                if dev[1] > 1.0:
                    direction = "significantly above" if dev[2] > dev[3] else "significantly below"
                    reasons.append(f"'{dev[0]}' ({dev[2]:.2f}) is {direction} the average ({dev[3]:.2f}), flagged as behavioral anomaly.")

        while len(reasons) < 2:
            reasons.append("")

        risk_score = int(normalized_risk)
        mrr_val = df.iloc[i][monetary_col] if monetary_col and monetary_col in df.columns else None
        tenure_val = df.iloc[i][tenure_col] if tenure_col and tenure_col in df.columns else None
        clv = compute_clv(risk_score, mrr_val, median_mrr)
        health = compute_health_score(risk_score, tenure_val, median_tenure, mrr_val, median_mrr)

        results[cid] = {
            "risk_score": risk_score,
            "risk_level": risk,
            "xai_reason1": reasons[0][:200] if reasons[0] else "No significant anomaly detected in behavioral patterns.",
            "xai_reason2": reasons[1][:200] if reasons[1] else "",
            "clv": clv,
            "health_score": health
        }
    return results


def run_ml(csv_path):
    try:
        df = pd.read_csv(csv_path, encoding='utf-8-sig')
    except Exception as e:
        return {"error": f"Failed to read CSV: {str(e)}"}

    id_col = identify_id_column(df)
    target_col = identify_target_column(df)
    artifact = load_pretrained_artifact()
    if artifact:
        available_features = sum(1 for feature in artifact['features'] if feature in df.columns)
        if available_features < max(1, len(artifact['features']) // 2):
            print("ML Warn: pretrained model skipped because uploaded schema is not compatible.", file=sys.stderr)
            artifact = None

    try:
        if artifact:
            return run_pretrained(df, id_col, artifact)
        elif target_col:
            return run_supervised(df, target_col, id_col)
        else:
            return run_unsupervised(df, id_col)
    except Exception as exc:
        print("ML Warn:", traceback.format_exc(), file=sys.stderr)
        return generate_fallback(df, id_col)


def generate_fallback(df, id_col):
    results = {}
    for i in range(len(df)):
        cid = format_record_id(df.iloc[i].get(id_col), f"row_{i}") if id_col else f"row_{i}"
        results[cid] = {
            "risk_score": 50,
            "risk_level": "Warning",
            "xai_reason1": "Standard review required — model fallback triggered.",
            "xai_reason2": "",
            "clv": 0,
            "health_score": 50
        }
    return results


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No CSV file provided"}))
        sys.exit(1)
    csv_path = sys.argv[1]
    output = run_ml(csv_path)
    print(json.dumps(output))
