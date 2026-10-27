from fastapi import FastAPI

app = FastAPI(title="MealBridge prediction scaffold", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "prediction-scaffold"}


@app.post("/predict/surplus")
def predict_surplus(payload: dict[str, float]) -> dict[str, object]:
    quantity = payload.get("historical_average_kg", 0)
    if quantity < 0:
        return {"error": "historical_average_kg must be non-negative"}
    return {
        "quantity_kg": round(quantity, 1),
        "confidence": "low",
        "basis": "Transparent baseline; not a trained model."
    }