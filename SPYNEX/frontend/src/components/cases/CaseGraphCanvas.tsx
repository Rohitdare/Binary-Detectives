import React, { useEffect, useRef } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { ZoomIn, ZoomOut, Maximize2, RefreshCw } from 'lucide-react';
import type { CaseGraphData, CaseTransaction } from '../../types';

interface CaseGraphCanvasProps {
  graphData: CaseGraphData | null;
  selectedTx: CaseTransaction | null;
  onSelectTx: (txId: string | null) => void;
  onSelectAccount: (accountId: string) => void;
  loading?: boolean;
}

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const CaseGraphCanvas: React.FC<CaseGraphCanvasProps> = ({
  graphData,
  selectedTx,
  onSelectTx,
  onSelectAccount,
  loading,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current || !graphData || loading) return;

    cyRef.current?.destroy();

    const nodes: cytoscape.ElementDefinition[] = graphData.nodes.map((node) => {
      const isOrigin = node.roles.includes('origin');
      const isSink = node.roles.includes('sink');
      const isHub = node.roles.includes('hub');

      let roleColor = '#64748B'; // slate
      if (isOrigin) roleColor = '#F59E0B'; // amber
      else if (isSink) roleColor = '#10B981'; // emerald
      else if (isHub) roleColor = '#06B6D4'; // cyan

      return {
        data: {
          id: node.id,
          label: node.id,
          type: node.type,
          roles: node.roles.join(', ') || 'member',
          inCase: node.in_case,
          roleColor,
        },
      };
    });

    const edges: cytoscape.ElementDefinition[] = graphData.edges.map((edge) => ({
      data: {
        id: edge.tx_id,
        source: edge.source,
        target: edge.target,
        amount: edge.amount,
        label: currency.format(edge.amount),
        ts: edge.ts,
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
            color: '#F1F5F9',
            'font-size': '10px',
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'background-color': 'data(roleColor)',
            'border-width': 2,
            'border-color': '#1E293B',
            width: 28,
            height: 28,
            'transition-property': 'background-color, border-color, width, height',
            'transition-duration': 0.15,
          },
        },
        {
          selector: 'node[?inCase]',
          style: {
            'border-color': '#FFFFFF',
            'border-width': 2.5,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#38BDF8',
            'border-width': 3,
            width: 32,
            height: 32,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.8,
            'line-color': 'rgba(148, 163, 184, 0.5)',
            'target-arrow-color': 'rgba(148, 163, 184, 0.7)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.85,
            label: 'data(label)',
            'font-size': '8.5px',
            'font-family': 'ui-monospace, monospace',
            color: '#94A3B8',
            'text-background-opacity': 0.85,
            'text-background-color': '#0B0F14',
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'text-rotation': 'autorotate',
            'text-margin-y': -6,
            'transition-property': 'line-color, target-arrow-color, width',
            'transition-duration': 0.15,
          },
        },
        {
          selector: 'edge.highlighted',
          style: {
            width: 3.5,
            'line-color': '#38BDF8',
            'target-arrow-color': '#38BDF8',
            'arrow-scale': 1.1,
            color: '#38BDF8',
            'z-index': 999,
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        padding: 40,
        nodeRepulsion: () => 600000,
        idealEdgeLength: () => 120,
      },
      minZoom: 0.2,
      maxZoom: 3.5,
      wheelSensitivity: 0.25,
    });

    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id();
      onSelectAccount(nodeId);
    });

    cy.on('tap', 'edge', (evt) => {
      const txId = evt.target.id();
      onSelectTx(txId);
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        onSelectTx(null);
      }
    });

    // Run layout with guaranteed resize and fit
    const layout = cy.layout({
      name: 'cose',
      animate: false,
      padding: 40,
      nodeRepulsion: () => 600000,
      idealEdgeLength: () => 120,
    });
    layout.one('layoutstop', () => {
      cy.resize();
      cy.fit(undefined, 35);
    });
    layout.run();

    // Secondary deferred fit to handle any pending CSS reflow / animations
    const rafId = requestAnimationFrame(() => {
      cy.resize();
      cy.fit(undefined, 35);
    });

    const timer = setTimeout(() => {
      cy.resize();
      cy.fit(undefined, 35);
    }, 150);

    const ro = new ResizeObserver(() => {
      cy.resize();
      cy.fit(undefined, 35);
    });
    ro.observe(containerRef.current);

    cyRef.current = cy;

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
      ro.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [graphData, loading, onSelectAccount, onSelectTx]);

  // Sync edge highlight with selectedTx
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.edges().removeClass('highlighted');
    if (selectedTx) {
      const edge = cy.getElementById(selectedTx.tx_id);
      if (edge && edge.length > 0) {
        edge.addClass('highlighted');
        cy.center(edge);
      }
    }
  }, [selectedTx]);

  const handleZoomIn = () => {
    if (!cyRef.current) return;
    cyRef.current.zoom({
      level: cyRef.current.zoom() * 1.25,
      renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 },
    });
  };

  const handleZoomOut = () => {
    if (!cyRef.current) return;
    cyRef.current.zoom({
      level: cyRef.current.zoom() / 1.25,
      renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 },
    });
  };

  const handleFit = () => {
    if (!cyRef.current) return;
    cyRef.current.resize();
    cyRef.current.fit(undefined, 35);
  };

  const handleReset = () => {
    if (!cyRef.current) return;
    const layout = cyRef.current.elements().layout({ name: 'cose', animate: true, padding: 35 });
    layout.one('layoutstop', () => {
      cyRef.current?.resize();
      cyRef.current?.fit(undefined, 35);
    });
    layout.run();
  };

  return (
    <div
      style={{
        position: 'relative',
        height: '380px',
        backgroundColor: '#080C10',
        borderRadius: '10px',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Empty State Overlay */}
      {(!graphData || graphData.nodes.length === 0) && !loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748B',
            gap: '0.4rem',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>No graph entities found for this case</span>
        </div>
      )}

      {/* Canvas Toolbar */}
      <div
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          display: 'flex',
          gap: '4px',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          padding: '4px',
          borderRadius: '6px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(6px)',
          zIndex: 10,
        }}
      >
        <button
          onClick={handleZoomIn}
          className="rt-button rt-button-sm"
          style={{ padding: '4px 6px', border: 'none', background: 'transparent', color: '#94A3B8' }}
          title="Zoom In"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={handleZoomOut}
          className="rt-button rt-button-sm"
          style={{ padding: '4px 6px', border: 'none', background: 'transparent', color: '#94A3B8' }}
          title="Zoom Out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={handleFit}
          className="rt-button rt-button-sm"
          style={{ padding: '4px 6px', border: 'none', background: 'transparent', color: '#94A3B8' }}
          title="Fit View"
        >
          <Maximize2 size={14} />
        </button>
        <button
          onClick={handleReset}
          className="rt-button rt-button-sm"
          style={{ padding: '4px 6px', border: 'none', background: 'transparent', color: '#94A3B8' }}
          title="Reset Layout"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Graph Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          padding: '4px 10px',
          borderRadius: '6px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          fontSize: '0.675rem',
          color: '#94A3B8',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} />
          <span>Origin</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
          <span>Sink</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#06B6D4' }} />
          <span>Hub</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#64748B' }} />
          <span>Intermediary</span>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
        <span style={{ color: '#E2E8F0' }}>1 edge per transaction</span>
      </div>
    </div>
  );
};
