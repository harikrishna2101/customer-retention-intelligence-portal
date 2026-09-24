from fastapi import FastAPI, HTTPException, UploadFile, File
import os
import shutil
from tempfile import NamedTemporaryFile

# Import the existing ML logic
from predict import run_ml

app = FastAPI(title="CRIP ML Engine Microservice")

@app.post("/predict")
async def analyze_dataset(file: UploadFile = File(...)):
    """
    Receives a CSV file over HTTP and runs the predictive anomaly detection pipeline.
    """
    tmp_path = None
    try:
        with NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name
            
        # Run the heavy statistical analysis
        results = run_ml(tmp_path)
        
        # predict.py returns a dict with 'error' key if it fails
        if isinstance(results, dict) and "error" in results:
            raise HTTPException(status_code=500, detail=results["error"])
            
        return {"success": True, "data": results}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
