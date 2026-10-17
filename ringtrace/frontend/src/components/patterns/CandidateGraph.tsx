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
}

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const CandidateGraph: React.FC<CandidateGraphProps> = ({
  candidate,
  selectedTx,
  onSelectTx,
  onInspectAccount,
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
            color: '#E2E8F0',
            'font-size': '10px',
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'background-color': '#475569',
            'border-width': 1.5,
            'border-color': '#1E293B',
            width: 26,
            height: 26,
            'transition-property': 'background-color, border-color, width, height',
            'transition-duration': 0.15,
          },
        },
        {
          selector: 'node[?hub]',
          style: {
            'background-color': '#38BDF8',
            'border-color': '#0284C7',
            'border-width': 2.5,
            width: 38,
            height: 38,
            color: '#BAE6FD',
            'font-weight': 700,
          },
        },
        {
          selector: 'node[bipartiteRole = "source"]',
          style: {
            'background-color': '#06B6D4',
            'border-color': '#0891B2',
            'border-width': 2,
            color: '#A5F3FC',
          },
        },
        {
          selector: 'node[bipartiteRole = "target"]',
          style: {
            'background-color': '#A855F7',
            'border-color': '#9333EA',
            'border-width': 2,
            color: '#F3E8FF',
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
            width: 32,
            height: 32,
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            color: '#CBD5E1',
            'font-size': '8.5px',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#38BDF8',
            'line-color': 'rgba(148, 163, 184, 0.45)',
            width: 1.8,
            'arrow-scale': 1.1,
            'text-background-color': '#080C10',
            'text-background-opacity': 0.9,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', height: '100%' }}>
      {/* Mini Graph Header & Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Evidence Subgraph
          </span>
          <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
            ({candidate.accounts.length} entities · {candidate.transactions.length} transfers)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button onClick={handleZoomIn} className="rt-button rt-button-sm" title="Zoom In">
            <ZoomIn size={12} />
          </button>
          <button onClick={handleZoomOut} className="rt-button rt-button-sm" title="Zoom Out">
            <ZoomOut size={12} />
          </button>
          <button onClick={handleFit} className="rt-button rt-button-sm" title="Fit to Viewport">
            <Maximize2 size={12} />
          </button>
          <button onClick={handleReset} className="rt-button rt-button-sm" title="Reset View">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Graph Canvas */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '320px',
          backgroundColor: 'var(--graph-bg)',
          borderRadius: '8px',
          border: '1px solid var(--graph-border)',
          boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.45)',
          position: 'relative',
        }}
      />
    </div>
  );
};
