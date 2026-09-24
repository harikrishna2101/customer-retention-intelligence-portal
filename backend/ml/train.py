import sys
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix, classification_report
import numpy as np
import joblib
import os

def train_master_model(csv_path):
    print(f"Loading master dataset from {csv_path}...")
    try:
        df = pd.read_csv(csv_path, encoding='utf-8-sig')
    except Exception as e:
        print(f"Failed to load dataset: {e}")
        return
    
    if 'TotalCharges' in df.columns:
        df['TotalCharges'] = pd.to_numeric(df['TotalCharges'], errors='coerce')
    df = df.fillna(0)
    
    # Static features ensuring consistency
    features = ['tenure', 'MonthlyCharges', 'TotalCharges', 'Contract', 'InternetService', 'PaymentMethod', 'SeniorCitizen']
    
    # Validate features exist in this dataset
    missing = [f for f in features if f not in df.columns]
    if missing:
        print(f"Dataset missing required Master features: {missing}. Cannot train.")
        return
        
    X = df[features].copy()
    
    print("Encoding categorical variables and generating dictionary...")
    encoders = {}
    categorical_cols = X.select_dtypes(include=['object']).columns
    for col in categorical_cols:
        encoders[col] = LabelEncoder()
        # Train strictly on strings
        X[col] = encoders[col].fit_transform(X[col].astype(str))
        
    if 'Churn' not in df.columns:
        print("Missing target column 'Churn'. Cannot train.")
        return
        
    y = np.where(df['Churn'].astype(str).str.lower() == 'yes', 1, 0)
    
    # ── Train/Test Split (80/20) for proper model validation ──
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    
    print(f"Training RandomForestClassifier on {len(X_train)} rows (80% split)...")
    print(f"Holdout test set: {len(X_test)} rows (20% split)")
    model = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)
    
    # ── Model Evaluation on Test Set ──────────────────────────
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]
    
    accuracy  = round(accuracy_score(y_test, y_pred) * 100, 2)
    precision = round(precision_score(y_test, y_pred, zero_division=0) * 100, 2)
    recall    = round(recall_score(y_test, y_pred, zero_division=0) * 100, 2)
    f1        = round(f1_score(y_test, y_pred, zero_division=0) * 100, 2)
    auc       = round(roc_auc_score(y_test, y_proba) * 100, 2)
    
    cm = confusion_matrix(y_test, y_pred)
    
    print("\n" + "=" * 50)
    print("  MODEL EVALUATION METRICS (Test Set)")
    print("=" * 50)
    print(f"  Algorithm       : Random Forest Classifier")
    print(f"  Dataset          : Telco Customer Churn")
    print(f"  Total Samples    : {len(X)}")
    print(f"  Training Set     : {len(X_train)} (80%)")
    print(f"  Test Set         : {len(X_test)} (20%)")
    print(f"  ─────────────────────────────────────")
    print(f"  Accuracy         : {accuracy}%")
    print(f"  Precision        : {precision}%")
    print(f"  Recall           : {recall}%")
    print(f"  F1 Score         : {f1}%")
    print(f"  AUC-ROC          : {auc}%")
    print(f"  ─────────────────────────────────────")
    print(f"  Confusion Matrix :")
    print(f"    TN={cm[0][0]}  FP={cm[0][1]}")
    print(f"    FN={cm[1][0]}  TP={cm[1][1]}")
    print("=" * 50)
    print("\n" + classification_report(y_test, y_pred, target_names=['Not Churned', 'Churned']))
    
    metrics = {
        'algorithm': 'Random Forest Classifier',
        'dataset': 'Telco Customer Churn',
        'total_samples': int(len(X)),
        'train_samples': int(len(X_train)),
        'test_samples': int(len(X_test)),
        'accuracy': accuracy,
        'precision': precision,
        'recall': recall,
        'f1_score': f1,
        'auc_roc': auc,
        'confusion_matrix': {
            'true_negatives': int(cm[0][0]),
            'false_positives': int(cm[0][1]),
            'false_negatives': int(cm[1][0]),
            'true_positives': int(cm[1][1])
        },
        'feature_importance': sorted(
            [{'feature': f, 'importance': round(float(i), 4)} for f, i in zip(features, model.feature_importances_)],
            key=lambda x: x['importance'], reverse=True
        )[:8]
    }
    
    # Now retrain on full dataset for production deployment
    print("\nRetraining on full dataset for production model...")
    model.fit(X, y)
    
    # Calculate baseline safe means for Explainable AI comparisons later
    probs = model.predict_proba(X)[:, 1]
    safe_mask = probs < 0.3
    safe_means = X[safe_mask].mean()
    
    # Define package to save — includes metrics for API access
    artifact = {
        'model': model,
        'encoders': encoders,
        'features': features,
        'safe_means': safe_means,
        'metrics': metrics
    }
    
    save_path = os.path.join(os.path.dirname(__file__), 'model.pkl')
    print(f"Saving optimized ML artifact to {save_path}...")
    joblib.dump(artifact, save_path)
    
    print("Training Complete! The AI is now production-ready and pre-compiled.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python train.py <path_to_master_csv>")
        sys.exit(1)
    train_master_model(sys.argv[1])
