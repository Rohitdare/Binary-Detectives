import React, { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { ZoomIn, ZoomOut, Maximize2, RefreshCw, ExternalLink, Network } from 'lucide-react';
import type { GraphNodeData, NetworkGraphData } from '../../types';
import { ringtraceApi } from '../../services/api';

interface NetworkPreviewProps {
  onInspectAccount: (accountId: string) => void;
}

export const NetworkPreview: React.FC<NetworkPreviewProps> = ({ onInspectAccount }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NetworkGraphData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [limit, setLimit] = useState(80);

  const loadGraph = async (sampleLimit: number) => {
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    try {
      const graphData = await ringtraceApi.getGraph(sampleLimit);
      setData(graphData);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch graph from FalkorDB backend');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraph(limit);
  }, [limit]);

  // Initialize and update Cytoscape
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
            'label': 'data(label)',
            'color': '#cbd5e1',
            'font-size': '10px',
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'background-color': '#64748b',
            'width': 22,
            'height': 22,
            'border-width': 1.5,
            'border-color': '#334155',
          },
        },
        {
          selector: 'node[type = "merchant"]',
          style: {
            'background-color': '#0284c7',
            'border-color': '#38bdf8',
            'width': 30,
            'height': 30,
          },
        },
        {
          selector: 'node[type = "payroll"]',
          style: {
            'background-color': '#059669',
            'border-color': '#34d399',
            'width': 28,
            'height': 28,
          },
        },
        {
          selector: 'node[type = "personal"]',
          style: {
            'background-color': '#475569',
            'border-color': '#64748b',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#f43f5e',
            'background-color': '#e11d48',
            'color': '#ffffff',
            'font-weight': 'bold',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.2,
            'line-color': '#334155',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#475569',
            'arrow-scale': 0.7,
            'opacity': 0.75,
          },
        },
        {
          selector: 'edge:selected',
          style: {
            'width': 2.5,
            'line-color': '#38bdf8',
            'target-arrow-color': '#38bdf8',
            'opacity': 1,
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        randomize: false,
        componentSpacing: 60,
        nodeOverlap: 20,
        idealEdgeLength: 60,
      },
    });

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      setSelectedNode(node.data());
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data]);

  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.25);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8);
  const handleFit = () => cyRef.current?.fit(undefined, 30);

  return (
    <div className="rt-card" style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Panel Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ padding: '0.35rem', borderRadius: '6px', background: 'var(--accent-cyan-subtle)', color: 'var(--accent-cyan)' }}>
            <Network size={16} />
          </div>
          <div>
            <h3 style={{ fontSize: '0.95rem' }}>Transaction Network Topology</h3>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
              Live FalkorDB sample: {data ? `${data.total_nodes} accounts, ${data.total_edges} transfers` : 'Connecting...'}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '0.3rem 0.5rem',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              outline: 'none'
            }}
          >
            <option value={40}>Sample: 40 txs</option>
            <option value={80}>Sample: 80 txs</option>
            <option value={150}>Sample: 150 txs</option>
          </select>

          <button onClick={handleZoomIn} className="rt-button rt-button-sm" title="Zoom In">
            <ZoomIn size={13} />
          </button>
          <button onClick={handleZoomOut} className="rt-button rt-button-sm" title="Zoom Out">
            <ZoomOut size={13} />
          </button>
          <button onClick={handleFit} className="rt-button rt-button-sm" title="Fit to Screen">
            <Maximize2 size={13} />
          </button>
          <button onClick={() => loadGraph(limit)} disabled={loading} className="rt-button rt-button-sm" title="Reload graph">
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Canvas Area with Inspector Overlay */}
      <div style={{ position: 'relative' }}>
        {loading && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(7, 11, 18, 0.75)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            borderRadius: '6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', color: 'var(--accent-cyan)', fontSize: '0.85rem' }}>
              <RefreshCw size={16} className="spin" />
              <span>Querying FalkorDB graph topology...</span>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(7, 11, 18, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            gap: '0.5rem',
            padding: '2rem',
            textAlign: 'center'
          }}>
            <div style={{ color: 'var(--accent-rose)', fontWeight: 600, fontSize: '0.9rem' }}>
              Database Connection Failed
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', maxWidth: '400px' }}>
              {error}
            </div>
            <button onClick={() => loadGraph(limit)} className="rt-button rt-button-sm" style={{ marginTop: '0.5rem' }}>
              Retry
            </button>
          </div>
        )}

        <div ref={containerRef} className="cytoscape-canvas" />

        {/* Selected Node Inspector Drawer */}
        {selectedNode && (
          <div style={{
            position: 'absolute',
            bottom: '12px',
            right: '12px',
            width: '260px',
            backgroundColor: 'var(--bg-card-elevated)',
            border: '1px solid var(--border-highlight)',
            borderRadius: '8px',
            padding: '0.85rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            zIndex: 5
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span className="mono" style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                {selectedNode.id}
              </span>
              <span className={`rt-badge badge-${selectedNode.type}`}>
                {selectedNode.type}
              </span>
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginBottom: '0.65rem' }}>
              Community Cluster: #{selectedNode.community}
            </div>
            <button
              onClick={() => onInspectAccount(selectedNode.id)}
              className="rt-button rt-button-primary rt-button-sm"
              style={{ width: '100%' }}
            >
              <span>Inspect Account</span>
              <ExternalLink size={12} />
            </button>
          </div>
        )}

        {/* Legend */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '0.4rem 0.65rem',
          display: 'flex',
          gap: '0.75rem',
          fontSize: '0.7rem',
          color: 'var(--text-secondary)',
          zIndex: 5
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8' }} />
            <span>Merchant</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' }} />
            <span>Payroll</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#64748b' }} />
            <span>Personal</span>
          </div>
        </div>
      </div>
    </div>
  );
};
