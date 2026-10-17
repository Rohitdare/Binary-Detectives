import React, { useEffect, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { ZoomIn, ZoomOut, Maximize2, RefreshCw } from 'lucide-react';
import type { WorkbenchCandidate } from './types';
import type { DetectorTransaction } from '../../types';

interface CandidateGraphProps {
  candidate: WorkbenchCandidate;
  selectedTx: DetectorTransaction | null;
  onSelectTx: (tx: DetectorTransaction | null) => void;
  onInspectAccount: (accountId: string) => void;
  height?: number | string;
}

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const CandidateGraph: React.FC<CandidateGraphProps> = ({
  candidate,
  selectedTx,
  onSelectTx,
  onInspectAccount,
  height = 260,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    cyRef.current?.destroy();

    // Determine hub account for fan-in, fan-out, gather-scatter, and hub_account
    let hubAccount: string | null = null;
    if (candidate.pattern === 'hub_account') {
      hubAccount = candidate.accounts[0];
    } else if (candidate.pattern === 'fan_in' || candidate.pattern === 'fan_out') {
      hubAccount = candidate.accounts[0];
    } else if (candidate.pattern === 'gather_scatter') {
      hubAccount = String(candidate.measurements.accumulator_id ?? candidate.accounts[0]);
    }

    // For bipartite: classify accounts into source or target
    const isBipartite = candidate.pattern === 'bipartite';
    const sourceSet = new Set<string>();
    const targetSet = new Set<string>();
    if (isBipartite) {
      for (const tx of candidate.transactions) {
        sourceSet.add(tx.src);
        targetSet.add(tx.dst);
      }
    }

    const nodes: cytoscape.ElementDefinition[] = candidate.accounts.map((id, index) => {
      const isSrc = isBipartite && sourceSet.has(id);
      const isDst = isBipartite && targetSet.has(id);
      return {
        data: {
          id,
          label: id,
          hub: id === hubAccount,
          bipartiteRole: isSrc ? 'source' : isDst ? 'target' : 'none',
          sequence: index,
        },
      };
    });

    const edges: cytoscape.ElementDefinition[] = candidate.transactions.map((tx, index) => ({
      data: {
        id: tx.tx_id,
        source: tx.src,
        target: tx.dst,
        label: currency.format(tx.amount),
        txId: tx.tx_id,
        amount: tx.amount,
        ts: tx.ts,
        channel: tx.tx_type,
        sequence: index,
      },
    }));

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...nodes, ...edges],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            color: '#F8FAFC',
            'font-size': '10px',
            'font-weight': 600,
            'font-family': 'JetBrains Mono, ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'text-background-color': '#090D16',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'background-color': '#334155',
            'border-width': 1.5,
            'border-color': '#94A3B8',
            width: 26,
            height: 26,
            'transition-property': 'background-color, border-color, width, height',
            'transition-duration': 0.15,
          },
        },
        {
          selector: 'node[?hub]',
          style: {
            'background-color': '#6D4AFF',
            'border-color': '#FFFFFF',
            'border-width': 2.5,
            width: 36,
            height: 36,
            color: '#F5F3FF',
            'font-weight': 700,
          },
        },
        {
          selector: 'node[bipartiteRole = "source"]',
          style: {
            'background-color': '#0284C7',
            'border-color': '#38BDF8',
            'border-width': 2,
            color: '#E0F2FE',
          },
        },
        {
          selector: 'node[bipartiteRole = "target"]',
          style: {
            'background-color': '#7C3AED',
            'border-color': '#C084FC',
            'border-width': 2,
            color: '#F3E8FF',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#FFFFFF',
            'background-color': '#10B981',
            color: '#6EE7B7',
            'font-weight': 700,
            width: 34,
            height: 34,
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            color: '#E2E8F0',
            'font-size': '9px',
            'font-weight': 600,
            'font-family': 'JetBrains Mono, ui-monospace, monospace',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#818CF8',
            'line-color': 'rgba(148, 163, 184, 0.45)',
            width: 1.8,
            'arrow-scale': 1.15,
            'text-background-color': '#090D16',
            'text-background-opacity': 0.92,
            'text-background-padding': '3px',
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: 'edge.selected',
          style: {
            'line-color': '#F59E0B',
            'target-arrow-color': '#F59E0B',
            width: 3.5,
            color: '#FDE047',
            'font-weight': 700,
            'arrow-scale': 1.3,
          },
        },
      ],
      layout: {
        name:
          candidate.pattern === 'cycle'
            ? 'circle'
            : candidate.pattern === 'bipartite'
            ? 'breadthfirst'
            : 'concentric',
        padding: 32,
        animate: false,
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });

    cy.on('tap', 'edge', (event) => {
      const data = event.target.data();
      onSelectTx({
        tx_id: String(data.txId),
        src: String(data.source),
        dst: String(data.target),
        amount: Number(data.amount),
        ts: Number(data.ts),
        tx_type: String(data.channel),
      });
    });

    cy.on('tap', 'node', (event) => {
      onInspectAccount(String(event.target.id()));
    });

    cy.on('tap', (event) => {
      if (event.target === cy) {
        onSelectTx(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [candidate, onSelectTx, onInspectAccount]);

  // Synchronize edge selection state
  useEffect(() => {
    if (!cyRef.current) return;
    cyRef.current.edges().removeClass('selected');
    if (selectedTx) {
      const edge = cyRef.current.getElementById(selectedTx.tx_id);
      if (edge && edge.length > 0) {
        edge.addClass('selected');
      }
    }
  }, [selectedTx]);

  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.25);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8);
  const handleFit = () => cyRef.current?.fit(undefined, 30);
  const handleReset = () => {
    if (!cyRef.current) return;
    cyRef.current.fit(undefined, 30);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', height: '100%' }}>
      {/* Mini Graph Header & Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
            Evidence Subgraph
          </span>
          <span
            className="rt-badge rt-badge-gray"
            style={{ fontSize: '0.675rem', fontVariantNumeric: 'tabular-nums' }}
          >
            {candidate.accounts.length} entities · {candidate.transactions.length} transfers
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button onClick={handleZoomIn} className="rt-button rt-button-sm" title="Zoom In" style={{ padding: '0.25rem 0.45rem' }}>
            <ZoomIn size={12} />
          </button>
          <button onClick={handleZoomOut} className="rt-button rt-button-sm" title="Zoom Out" style={{ padding: '0.25rem 0.45rem' }}>
            <ZoomOut size={12} />
          </button>
          <button onClick={handleFit} className="rt-button rt-button-sm" title="Fit to Viewport" style={{ padding: '0.25rem 0.45rem' }}>
            <Maximize2 size={12} />
          </button>
          <button onClick={handleReset} className="rt-button rt-button-sm" title="Reset View" style={{ padding: '0.25rem 0.45rem' }}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Graph Canvas */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: typeof height === 'number' ? `${height}px` : height,
          backgroundColor: '#090D16',
          borderRadius: '10px',
          border: '1px solid #1E293B',
          boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.45)',
          position: 'relative',
        }}
      />
    </div>
  );
};
