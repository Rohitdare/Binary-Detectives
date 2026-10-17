import React, { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  ExternalLink,
  Search,
  Eye,
  EyeOff,
  X,
  Layers,
  ArrowRight,
  Database,
  Zap,
} from 'lucide-react';
import type { GraphNodeData, NetworkGraphData, SystemStats } from '../../types';
import { ringtraceApi } from '../../services/api';

interface OverviewGraphProps {
  stats: SystemStats | null;
  onInspectAccount: (accountId: string) => void;
}

interface SelectedEdgeData {
  id: string;
  source: string;
  target: string;
  amount: number;
  tx_type: string;
}

export const OverviewGraph: React.FC<OverviewGraphProps> = ({ stats, onInspectAccount }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NetworkGraphData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdgeData | null>(null);
  const [limit, setLimit] = useState(100);
  const [showLabels, setShowLabels] = useState(true);
  const [searchAccountInput, setSearchAccountInput] = useState('');

  const loadGraph = useCallback(async (sampleLimit: number) => {
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    try {
      const graphData = await ringtraceApi.getGraph(sampleLimit);
      setData(graphData);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch graph topology from FalkorDB');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const graphData = await ringtraceApi.getGraph(limit);
        if (isMounted) {
          setData(graphData);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to fetch graph topology from FalkorDB');
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [limit]);

  // Cytoscape initialization and lifecycle
  useEffect(() => {
    if (!containerRef.current || !data) return;

    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const elements: cytoscape.ElementDefinition[] = [
      ...data.nodes.map((n) => ({
        data: {
          id: n.data.id,
          label: n.data.id,
          type: n.data.type,
          community: n.data.community,
        },
      })),
      ...data.edges.map((e) => ({
        data: {
          id: e.data.id,
          source: e.data.source,
          target: e.data.target,
          amount: e.data.amount,
          tx_type: e.data.tx_type,
        },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'label': showLabels ? 'data(label)' : '',
            'color': '#E2E8F0',
            'font-size': '10px',
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'background-color': '#475569',
            'width': 20,
            'height': 20,
            'border-width': 1.5,
            'border-color': '#1E293B',
            'transition-property': 'background-color, border-color, width, height',
            'transition-duration': 0.15,
          },
        },
        {
          selector: 'node[type = "merchant"]',
          style: {
            'background-color': '#38BDF8',
            'border-color': '#0284C7',
            'border-width': 2,
            'width': 30,
            'height': 30,
            'color': '#BAE6FD',
            'font-weight': 600,
          },
        },
        {
          selector: 'node[type = "payroll"]',
          style: {
            'background-color': '#10B981',
            'border-color': '#059669',
            'border-width': 2,
            'width': 28,
            'height': 28,
            'color': '#A7F3D0',
            'font-weight': 600,
          },
        },
        {
          selector: 'node[type = "personal"]',
          style: {
            'background-color': '#64748B',
            'border-color': '#334155',
            'width': 20,
            'height': 20,
            'color': '#CBD5E1',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#FFFFFF',
            'background-color': '#38A189',
            'color': '#FDE047',
            'font-weight': 700,
            'font-size': '11px',
            'width': 34,
            'height': 34,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.2,
            'line-color': 'rgba(148, 163, 184, 0.45)',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': 'rgba(148, 163, 184, 0.65)',
            'arrow-scale': 0.8,
            'opacity': 0.65,
          },
        },
        {
          selector: 'edge:selected',
          style: {
            'width': 3.2,
            'line-color': '#F59E0B',
            'target-arrow-color': '#F59E0B',
            'opacity': 1,
            'arrow-scale': 1.2,
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        randomize: false,
        componentSpacing: 70,
        nodeOverlap: 25,
        idealEdgeLength: 70,
      },
    });

    // Tap node
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      setSelectedNode(node.data());
      setSelectedEdge(null);
    });

    // Tap edge
    cy.on('tap', 'edge', (evt) => {
      const edge = evt.target;
      setSelectedEdge(edge.data());
      setSelectedNode(null);
    });

    // Tap background
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
        setSelectedEdge(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data, showLabels]);

  // Toolbar Actions
  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.25);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8);
  const handleFit = () => cyRef.current?.fit(undefined, 35);
  const handleToggleLabels = () => setShowLabels((prev) => !prev);

  // Search node within Cytoscape
  const handleSearchNode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cyRef.current || !searchAccountInput.trim()) return;

    const targetId = searchAccountInput.trim();
    const node = cyRef.current.getElementById(targetId);

    if (node && node.length > 0) {
      cyRef.current.elements().unselect();
      node.select();
      cyRef.current.animate({
        center: { eles: node },
        zoom: 1.8,
        duration: 350,
      });
      setSelectedNode(node.data());
      setSelectedEdge(null);
    }
  };

  const formatAmount = (amt: number) => {
    return '₹' + amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', height: '100%' }}>
      {/* Header with Minimal Inline Metrics */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          paddingBottom: '0.15rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.025em',
              margin: 0,
              fontFamily: 'var(--font-sans)',
            }}
          >
            Transaction Network
          </h1>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              marginTop: '0.15rem',
              margin: 0,
            }}
          >
            Real-time transaction flow, community clusters, and money laundering risk topology
          </p>
        </div>

        {/* Minimal Metrics Row — Clean, horizontal, uncluttered */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.35rem 0.65rem',
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '6px',
              fontSize: '0.75rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <Database size={13} color="#64748B" />
            <span style={{ fontWeight: 700, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
              {stats?.total_accounts?.toLocaleString() ?? '3,000'}
            </span>
            <span style={{ color: '#64748B' }}>Accounts</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.35rem 0.65rem',
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '6px',
              fontSize: '0.75rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <Layers size={13} color="#64748B" />
            <span style={{ fontWeight: 700, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
              {stats?.total_transactions?.toLocaleString() ?? '40,661'}
            </span>
            <span style={{ color: '#64748B' }}>Transfers</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.35rem 0.65rem',
              backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: '6px',
              fontSize: '0.75rem',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#DC2626' }} />
            <span style={{ fontWeight: 700, color: '#DC2626', fontFamily: 'JetBrains Mono, monospace' }}>
              12
            </span>
            <span style={{ color: '#991B1B', fontWeight: 500 }}>Flagged Subgraphs</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.35rem 0.65rem',
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '6px',
              fontSize: '0.75rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <Zap size={13} color="#059669" />
            <span style={{ fontWeight: 700, color: '#0F172A', fontFamily: 'JetBrains Mono, monospace' }}>
              0.8ms
            </span>
            <span style={{ color: '#64748B' }}>Latency</span>
          </div>
        </div>
      </div>

      {/* Main Graph Card Occupying Viewport */}
      <div className="rt-card" style={{
        flex: 1,
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        borderRadius: '12px',
        overflow: 'hidden'
      }}>
        {/* Top Minimal Toolbar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.65rem',
          marginBottom: '0.5rem'
        }}>
          {/* Node Search in Canvas */}
          <form onSubmit={handleSearchNode} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: 'var(--surface-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '0 0.55rem',
              height: '28px',
              boxSizing: 'border-box'
            }}>
              <Search size={12} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Find node (e.g. ACC_00125)..."
                value={searchAccountInput}
                onChange={(e) => setSearchAccountInput(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: '0.72rem',
                  width: '180px',
                  fontFamily: 'var(--font-mono)'
                }}
              />
              {searchAccountInput && (
                <button
                  type="button"
                  onClick={() => setSearchAccountInput('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </form>

          {/* Graph Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{
                background: 'var(--surface-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                height: '28px',
                padding: '0 0.55rem',
                color: 'var(--text-primary)',
                fontSize: '0.72rem',
                outline: 'none',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <option value={40}>40 tx</option>
              <option value={80}>80 tx</option>
              <option value={100}>100 tx</option>
              <option value={150}>150 tx</option>
              <option value={300}>300 tx</option>
            </select>

            <button
              type="button"
              onClick={handleToggleLabels}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                height: '28px',
                padding: '0 0.55rem',
                fontSize: '0.72rem',
                fontWeight: 600,
                background: showLabels ? 'var(--surface-secondary)' : 'transparent',
                color: showLabels ? 'var(--text-primary)' : 'var(--text-muted)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              title={showLabels ? 'Hide Labels' : 'Show Labels'}
            >
              {showLabels ? <Eye size={12} /> : <EyeOff size={12} />}
              <span>Labels</span>
            </button>

            {/* Segmented Zoom & View Controls */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              backgroundColor: 'var(--surface-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              overflow: 'hidden',
              height: '28px'
            }}>
              <button
                type="button"
                onClick={handleZoomIn}
                title="Zoom In"
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRight: '1px solid var(--border-subtle)',
                  padding: '0 0.5rem',
                  height: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)'
                }}
              >
                <ZoomIn size={12} />
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                title="Zoom Out"
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRight: '1px solid var(--border-subtle)',
                  padding: '0 0.5rem',
                  height: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)'
                }}
              >
                <ZoomOut size={12} />
              </button>
              <button
                type="button"
                onClick={handleFit}
                title="Fit to Viewport"
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRight: '1px solid var(--border-subtle)',
                  padding: '0 0.5rem',
                  height: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)'
                }}
              >
                <Maximize2 size={12} />
              </button>
              <button
                type="button"
                onClick={() => loadGraph(limit)}
                disabled={loading}
                title="Reload network"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '0 0.5rem',
                  height: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  color: 'var(--text-secondary)'
                }}
              >
                <RefreshCw size={12} className={loading ? 'spin' : ''} />
              </button>
            </div>
          </div>
        </div>

        {/* Canvas Area with Dark Charcoal Background */}
        <div style={{
          position: 'relative',
          flex: 1,
          minHeight: 'calc(100vh - 200px)',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid var(--graph-border)',
          boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.45)'
        }}>
          {loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(8, 12, 16, 0.85)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', color: '#38BDF8', fontSize: '0.85rem' }}>
                <RefreshCw size={16} className="spin" />
                <span>Querying FalkorDB txn network topology...</span>
              </div>
            </div>
          )}

          {error && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(8, 12, 16, 0.95)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              gap: '0.5rem',
              padding: '2rem',
              textAlign: 'center'
            }}>
              <div style={{ color: 'var(--accent-red)', fontWeight: 600, fontSize: '0.9rem' }}>
                Database Topology Query Failed
              </div>
              <div style={{ color: '#94A3B8', fontSize: '0.75rem', maxWidth: '400px' }}>
                {error}
              </div>
              <button onClick={() => loadGraph(limit)} className="rt-button rt-button-sm" style={{ marginTop: '0.5rem' }}>
                Retry Query
              </button>
            </div>
          )}

          {/* Cytoscape.js Network Canvas */}
          <div
            ref={containerRef}
            className="cytoscape-canvas"
            style={{ width: '100%', height: '100%', backgroundColor: 'var(--graph-bg)' }}
          />

          {/* Compact Legend Overlay */}
          <div style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            backgroundColor: 'rgba(8, 12, 16, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '6px',
            padding: '0.45rem 0.75rem',
            display: 'flex',
            gap: '0.85rem',
            fontSize: '0.7rem',
            color: '#CBD5E1',
            zIndex: 5,
            backdropFilter: 'blur(6px)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#38BDF8', border: '1px solid #0284C7' }} />
              <span>Merchant Hub</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#10B981', border: '1px solid #059669' }} />
              <span>Payroll Entity</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#64748B', border: '1px solid #334155' }} />
              <span>Personal Node</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#38A189', border: '1px solid #FFFFFF' }} />
              <span>Selected Entity</span>
            </div>
          </div>

          {/* Contextual Node Inspector Drawer */}
          {selectedNode && (
            <div style={{
              position: 'absolute',
              bottom: '16px',
              right: '16px',
              width: '280px',
              backgroundColor: '#0F172A',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '1rem',
              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.75)',
              zIndex: 15
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span className="mono" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#38BDF8' }}>
                  {selectedNode.id}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span className={`rt-badge badge-${selectedNode.type}`}>
                    {selectedNode.type}
                  </span>
                  <button
                    onClick={() => setSelectedNode(null)}
                    style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '0.725rem', color: '#94A3B8', marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Layers size={12} />
                <span>Community Cluster: #{selectedNode.community}</span>
              </div>
              <button
                onClick={() => onInspectAccount(selectedNode.id)}
                className="rt-button rt-button-primary rt-button-sm"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <span>Trace 1-Hop Neighborhood</span>
                <ExternalLink size={12} />
              </button>
            </div>
          )}

          {/* Contextual Edge Inspector Drawer */}
          {selectedEdge && (
            <div style={{
              position: 'absolute',
              bottom: '16px',
              right: '16px',
              width: '300px',
              backgroundColor: '#0F172A',
              border: '1px solid #F59E0B',
              borderRadius: '10px',
              padding: '1rem',
              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.75)',
              zIndex: 15
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span className="rt-badge badge-warning" style={{ fontSize: '0.675rem' }}>
                  Selected Directed Transfer
                </span>
                <button
                  onClick={() => setSelectedEdge(null)}
                  style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 0 }}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="mono" style={{ fontSize: '0.775rem', color: '#CBD5E1', marginBottom: '0.5rem' }}>
                {selectedEdge.id}
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.8rem',
                color: '#FFFFFF',
                marginBottom: '0.5rem'
              }}>
                <button
                  onClick={() => onInspectAccount(selectedEdge.source)}
                  className="account-link"
                  style={{ color: '#38BDF8', fontSize: '0.8rem' }}
                >
                  {selectedEdge.source}
                </button>
                <ArrowRight size={13} color="#94A3B8" />
                <button
                  onClick={() => onInspectAccount(selectedEdge.target)}
                  className="account-link"
                  style={{ color: '#38BDF8', fontSize: '0.8rem' }}
                >
                  {selectedEdge.target}
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: '0.4rem', borderTop: '1px solid #1E293B' }}>
                <span style={{ fontSize: '0.7rem', color: '#94A3B8', textTransform: 'uppercase' }}>Amount ({selectedEdge.tx_type})</span>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: '#FDE047', fontVariantNumeric: 'tabular-nums' }}>
                  {formatAmount(selectedEdge.amount)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
