"""Pydantic response models for Member A detection and case APIs."""
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, ConfigDict, Field


class TransactionModel(BaseModel):
    tx_id: str
    src: str
    dst: str
    amount: float
    ts: Union[int, str]
    tx_type: Optional[str] = None


class HitModel(BaseModel):
    hit_id: str
    pattern: str
    account_ids: List[str]
    tx_ids: List[str]
    measurements: Dict[str, Any] = Field(default_factory=dict)
    explanation: str = ""
    model_config = ConfigDict(extra="allow")


class CaseRecord(BaseModel):
    case_id: str
    status: str = "open"
    severity: str
    score: int
    patterns: List[str]
    account_count: int
    tx_count: int
    total_amount: float
    first_ts: Optional[str] = None
    last_ts: Optional[str] = None
    similar_case_count: int = 0
    updated_at: str
    score_breakdown: Optional[Dict[str, Any]] = None
    model_config = ConfigDict(extra="allow")


class CaseDetail(CaseRecord):
    hits: List[HitModel] = Field(default_factory=list)
    transactions: List[TransactionModel] = Field(default_factory=list)
    decisions: List[Dict[str, Any]] = Field(default_factory=list)


class CaseListResponse(BaseModel):
    items: List[CaseRecord]
    next_cursor: Optional[str] = None


class ScanReceipt(BaseModel):
    scan_id: str
    status: str
    active_scan_id: Optional[str] = None
    message: Optional[str] = None
    model_config = ConfigDict(extra="allow")



class ScanStatus(BaseModel):
    scan_id: str
    status: str
    trigger: Optional[str] = "manual"
    graph: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    duration_ms: Optional[float] = None
    effective_window_start: Optional[str] = None
    effective_window_end: Optional[str] = None
    detectors_completed: List[str] = Field(default_factory=list)
    detectors_failed: List[str] = Field(default_factory=list)
    detector_reports: Dict[str, Any] = Field(default_factory=dict)
    detector_errors: Dict[str, str] = Field(default_factory=dict)
    error_summary: Optional[str] = None
    hits_found: Optional[int] = None
    hit_count: Optional[int] = None
    cases_created_or_updated: Optional[int] = None
    case_count: Optional[int] = None
    limitations: List[str] = Field(default_factory=list)
    skipped_non_case_generating_hit_ids: List[str] = Field(default_factory=list)
    skipped_oversized_hit_ids: List[str] = Field(default_factory=list)
    model_config = ConfigDict(extra="allow")


class SchedulerStatusResponse(BaseModel):
    enabled: bool
    running: bool
    paused: bool = False
    interval_seconds: int
    scan_on_startup: bool = False
    next_run_at: Optional[str] = None
    last_run_at: Optional[str] = None
    run_count: int = 0
    failure_count: int = 0
    skip_count: int = 0
    is_scan_active: bool = False
    active_scan_id: Optional[str] = None
    latest_scan: Optional[ScanStatus] = None
    model_config = ConfigDict(extra="allow")



class GraphSummary(BaseModel):
    graph: str
    account_count: int
    transaction_count: int
    case_count: int
    first_transaction_ts: Optional[int] = None
    last_transaction_ts: Optional[int] = None
    cases_by_pattern: Dict[str, int] = Field(default_factory=dict)


class GraphData(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]


class EvaluationResponse(BaseModel):
    run_at: Optional[str] = None
    reports: Dict[str, Any] = Field(default_factory=dict)
    overall_summary: Optional[Dict[str, Any]] = None
    by_detector: Optional[Dict[str, Any]] = None
    limitations: List[str] = Field(default_factory=list)
    status: str = "not_run"
    model_config = ConfigDict(extra="allow")


class ScenarioRequest(BaseModel):
    scenario_id: str


class ScenarioInjectionResponse(BaseModel):
    injected_accounts: int
    injected_tx: int
    rescan: str
    scan_id: str


class HealthResponse(BaseModel):
    status: str
    falkordb_connected: bool
    graph: str


class ScenarioItem(BaseModel):
    scenario_id: str
    account_count: int
    transaction_count: int


class ScenarioListResponse(BaseModel):
    items: List[ScenarioItem]


class DetectorResponse(BaseModel):
    status: str
    pattern: str
    count: int
    hits: List[HitModel]
    truncated: bool
    truncation_reasons: List[str] = Field(default_factory=list)
    edges_scanned: int = 0
    search_steps: int = 0
    execution_time_ms: float


class AccountProfile(BaseModel):
    account: Dict[str, Any]
    incoming: List[TransactionModel]
    outgoing: List[TransactionModel]
    linked_cases: List[CaseRecord] = Field(default_factory=list)


class EvaluationJob(BaseModel):
    evaluation_id: str
    status: str


class EvaluationStatus(BaseModel):
    evaluation_id: str
    status: str
    run_at: Optional[str] = None
    reports: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
