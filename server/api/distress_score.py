from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from services.distress_service import llm_distress_score

router = APIRouter()

class DistressRequest(BaseModel):
    text: str

@router.post("/api/distress-score")
async def distress_score_endpoint(request: DistressRequest):
    try:
        score = llm_distress_score(request.text)
        return {"score": score}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
