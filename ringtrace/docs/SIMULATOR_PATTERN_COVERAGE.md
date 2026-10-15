# RingTrace Simulator Pattern Coverage Matrix

This document tracks the coverage, implementation evidence, and testing readiness of all 9 planned financial crime patterns in RingTrace.

---

## Pattern Coverage Summary

| # | Pattern Name | Simulator Support | Generation Method | Ground-Truth Labels | Benign Look-Alikes Included | Status |
|---|---|---|---|---|---|---|
| 1 | `cycle` | **Full** | `inj_cycle` | `ALERT_cycle_*` (`is_fraud=true`) | `slow_family_cycle`, `unordered_cycle` | Supported & Tested |
| 2 | `fan_in` | **Full** | `inj_fan_in` | `ALERT_fan_in_*` (`is_fraud=true`) | `merchant_fan_in`, `near_miss_fan_in` | Supported & Tested |
| 3 | `fan_out` | **Full** | `inj_fan_out` | `ALERT_fan_out_*` (`is_fraud=true`) | `payroll_fan_out` | Supported & Tested |
| 4 | `relay_chain` | **Full** | `inj_relay_chain` | `ALERT_relay_chain_*` (`is_fraud=true`) | `near_miss_relay` | Supported & Tested |
| 5 | `scatter_gather` | **Full** | `inj_scatter_gather` | `ALERT_scatter_gather_*` (`is_fraud=true`) | None (relies on background noise) | Supported & Tested |
| 6 | `gather_scatter` | **Full** | `inj_gather_scatter` | `ALERT_gather_scatter_*` (`is_fraud=true`) | None (relies on background noise) | Supported & Tested |
| 7 | `bipartite` | **Full** | `inj_bipartite` | `ALERT_bipartite_*` (`is_fraud=true`) | None (relies on community background) | Supported & Tested |
| 8 | `dense_cluster` | **Full** | `inj_dense_cluster` | `ALERT_dense_cluster_*` (`is_fraud=true`) | None (relies on community background) | Supported & Tested |
| 9 | `hub_account` | **Algorithmic Signal** | Emergent via background Pareto distribution | None (not a planted injection) | Natural merchants & payroll runs | Algorithmic Evaluation |

---

## Detailed Pattern Analysis

### 1. `cycle`
- **Implementation in `simulate.py`:** Line 159 (`inj_cycle()`).
- **Structure:** 3 to 5 personal accounts forming a directed ring: $A \to B \to C \to A$.
- **Attributes:** Amount decays by 1-10% at each hop to simulate laundering cuts. Hops are spaced 10 minutes to 12 hours apart.
- **Benign Look-Alikes:**
  - `slow_family_cycle`: Spaced 8 to 20 days apart per hop with severe amount drops (40-80%).
  - `unordered_cycle`: Structural cycle where timestamps violate chronological order from every possible starting account.
- **Detector Implication:** Time-respecting path checks and amount conservation are essential to distinguish fraud cycles from background noise and benign look-alikes.

### 2. `fan_in`
- **Implementation in `simulate.py`:** Line 171 (`inj_fan_in()`).
- **Structure:** 8 to 25 distinct source accounts paying into a single sink account within 2 to 48 hours.
- **Attributes:** 40% of instances use structured amounts just below regulatory reporting limits ($42,500 to $49,500).
- **Benign Look-Alikes:**
  - `merchant_fan_in`: 15 to 40 customers paying a merchant account across 24 hours.
  - `near_miss_fan_in`: 3 to 5 personal accounts pooling small funds.
- **Detector Implication:** Account type metadata (`merchant` vs `personal`) and source count thresholds distinguish legitimate retail commerce from mule aggregation.

### 3. `fan_out`
- **Implementation in `simulate.py`:** Line 183 (`inj_fan_out()`).
- **Structure:** 1 origin account disbursing to 8 to 25 recipients within 2 to 48 hours.
- **Benign Look-Alikes:**
  - `payroll_fan_out`: Corporate payroll disbursement to 15 to 40 staff accounts within 1 hour.
- **Detector Implication:** Payroll account classification and periodic monthly recurrence separate legitimate wages from illicit dispersal.

### 4. `relay_chain`
- **Implementation in `simulate.py`:** Line 193 (`inj_relay_chain()`).
- **Structure:** Linear transfer chain of 3 to 6 hops: $A \to B \to C \to D$.
- **Attributes:** Quick turnover (5 minutes to 6 hours per hop) with 85-98% capital retention.
- **Benign Look-Alikes:**
  - `near_miss_relay`: Slow peer-to-peer transfers spaced 3 to 10 days apart with large amount discrepancies.

### 5. `scatter_gather`
- **Implementation in `simulate.py`:** Line 205 (`inj_scatter_gather()`).
- **Structure:** 1 origin splits funds into 3 to 6 intermediaries, which subsequently re-converge into 1 single sink account.
- **Attributes:** Inflow within 6 hours, intermediate holding 30 minutes to 24 hours before re-aggregation.

### 6. `gather_scatter`
- **Implementation in `simulate.py`:** Line 220 (`inj_gather_scatter()`).
- **Structure:** 5 to 12 sources funnel funds into a central hub account within 24 hours; the hub subsequently disperses funds to 5 to 12 different recipients within the next 24 hours.

### 7. `bipartite`
- **Implementation in `simulate.py`:** Line 236 (`inj_bipartite()`).
- **Structure:** Group of 3 to 5 source accounts transferring money to 3 to 5 target accounts with dense cross-connections over 48 hours.

### 8. `dense_cluster`
- **Implementation in `simulate.py`:** Line 248 (`inj_dense_cluster()`).
- **Structure:** 5 to 10 nodes with chain backbone and 50% random edge density, executing multiple circular and bidirectional transfers over 4 days.

### 9. `hub_account`
- **Implementation:** Not planted as a discrete fraud pattern in `FRAUD_PATTERNS`.
- **Reasoning:** In graph analysis and financial crime detection, "hub account" is a topological metric (high in-degree, out-degree, or PageRank) rather than an isolated illicit transaction sequence.
- **Generation:** Merchants receive 20x higher transaction volume than personal accounts; payroll accounts burst transactions every 30 days. These naturally emerge as high-degree hub accounts in the background graph.
- **Detection Method:** Graph centrality Cypher queries (`CALL algo.pageRank('Account', 'SENT')` or degree counting `count(r)`).
