"""Detector modules for RingTrace."""
from app.detectors.cycle import detect_cycles
from app.detectors.fan_in import detect_fan_in
from app.detectors.fan_out import detect_fan_out
from app.detectors.gather_scatter import detect_gather_scatter
from app.detectors.bipartite import detect_bipartite
from app.detectors.dense_cluster import detect_dense_clusters
from app.detectors.hub_account import detect_hub_accounts
from app.detectors.relay_chain import detect_relay_chains
from app.detectors.scatter_gather import detect_scatter_gather

__all__ = [
    "detect_cycles", "detect_fan_in", "detect_fan_out",
    "detect_relay_chains", "detect_scatter_gather", "detect_gather_scatter",
    "detect_bipartite", "detect_dense_clusters", "detect_hub_accounts",
]
