from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from .distress_service import analyze_distress_score

router = APIRouter()

class DistressRequest(BaseModel):
    text: str

@router.post("/api/distress-score")
async def distress_score_endpoint(request: DistressRequest):
    try:
        score = await analyze_distress_score(request.text)
        return {"score": score}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
