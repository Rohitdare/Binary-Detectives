import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RefreshCw,
  Eye,
  EyeOff,
  DollarSign,
  X,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Check,
  Users,
  AlertTriangle,
  Info,
  Layers,
  Database,
  Calendar,
} from 'lucide-react';
import type {
  CaseGraphData,
  CaseGraphNode,
  CaseTransaction,
  CaseDetail,
  AccountDetailsResponse,
} from '../../types';
import { ringtraceApi } from '../../services/api';

export interface CaseGraphCanvasProps {
  graphData: CaseGraphData | null;
  selectedTx: CaseTransaction | null;
  caseDetail?: CaseDetail | null;
  onSelectTx: (txId: string | null) => void;
  onSelectAccount: (accountId: string) => void;
  loading?: boolean;
  error?: { status?: number; code?: string; message: string } | null;
  onRetry?: () => void;
  isStale?: boolean;
  latestScanStatus?: string | null;
  latestScanTime?: string | null;
  onRefreshGraph?: () => void;
}

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const CaseGraphCanvas: React.FC<CaseGraphCanvasProps> = ({
  graphData,
  selectedTx,
  caseDetail,
  onSelectTx,
  onSelectAccount,
  loading = false,
  error = null,
  onRetry,
  isStale = false,
  latestScanStatus = null,
  latestScanTime = null,
  onRefreshGraph,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  // Canvas View Controls
  const [showLabels, setShowLabels] = useState(true);
  const [showAmounts, setShowAmounts] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  // Selected Entity state (within canvas)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [copiedAccount, setCopiedAccount] = useState(false);

  // Counterparty Inspection state
  const [inspectMode, setInspectMode] = useState<'overview' | 'counterparties'>('overview');
  const [accountDetails, setAccountDetails] = useState<AccountDetailsResponse | null>(null);
  const [loadingAccountDetails, setLoadingAccountDetails] = useState(false);

  // Fetch account profile when inspecting counterparties
  const fetchAccountDetails = useCallback(async (accId: string) => {
    setLoadingAccountDetails(true);
    try {
      const res = await ringtraceApi.getAccountDetails(accId, 25);
      setAccountDetails(res);
    } catch {
      setAccountDetails(null);
    } finally {
      setLoadingAccountDetails(false);
    }
  }, []);

  // Compute selected node details from existing graphData
  const selectedNode: CaseGraphNode | null = useMemo(() => {
    if (!graphData || !selectedNodeId) return null;
    return graphData.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [graphData, selectedNodeId]);

  // Compute transactions involving the selected node
  const nodeTransactions = useMemo(() => {
    if (!graphData || !selectedNodeId) {
      return { incoming: [], outgoing: [], totalIn: 0, totalOut: 0, counterparties: [] };
    }
    const incoming = graphData.edges.filter((e) => e.target === selectedNodeId);
    const outgoing = graphData.edges.filter((e) => e.source === selectedNodeId);
    const totalIn = incoming.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalOut = outgoing.reduce((sum, e) => sum + (e.amount || 0), 0);

    // Group counterparties
    const cpMap = new Map<string, { id: string; inAmount: number; outAmount: number; txCount: number; type?: string }>();

    for (const e of incoming) {
      const cpNode = graphData.nodes.find((n) => n.id === e.source);
      const existing = cpMap.get(e.source) || { id: e.source, inAmount: 0, outAmount: 0, txCount: 0, type: cpNode?.type };
      existing.inAmount += e.amount || 0;
      existing.txCount += 1;
      cpMap.set(e.source, existing);
    }

    for (const e of outgoing) {
      const cpNode = graphData.nodes.find((n) => n.id === e.target);
      const existing = cpMap.get(e.target) || { id: e.target, inAmount: 0, outAmount: 0, txCount: 0, type: cpNode?.type };
      existing.outAmount += e.amount || 0;
      existing.txCount += 1;
      cpMap.set(e.target, existing);
    }

    return {
      incoming,
      outgoing,
      totalIn,
      totalOut,
      counterparties: Array.from(cpMap.values()),
    };
  }, [graphData, selectedNodeId]);

  // Selected edge object
  const selectedEdgeObj = useMemo(() => {
    if (!graphData) return null;
    const targetId = selectedTx?.tx_id || selectedEdgeId;
    if (!targetId) return null;
    return graphData.edges.find((e) => e.tx_id === targetId) || null;
  }, [graphData, selectedTx, selectedEdgeId]);

  // Initialize and update Cytoscape canvas
  useEffect(() => {
    if (!containerRef.current || !graphData || loading) return;

    cyRef.current?.destroy();

    // Prepare Cytoscape nodes
    const nodes: cytoscape.ElementDefinition[] = graphData.nodes.map((node) => {
      const isOrigin = node.roles.includes('origin');
      const isSink = node.roles.includes('sink');
      const isHub = node.roles.includes('hub');

      // Base category color from API
      let baseColor = '#64748B'; // personal / default
      if (node.type === 'merchant') baseColor = '#0EA5E9'; // cyan blue
      else if (node.type === 'payroll') baseColor = '#10B981'; // emerald green
      else if (node.type === 'personal') baseColor = '#6366F1'; // indigo slate

      // Border and role-based prominence
      let borderColor = '#334155';
      let borderWidth = 2;
      let borderStyle: 'solid' | 'dashed' = 'solid';

      if (node.in_case) {
        if (isOrigin) {
          borderColor = '#F59E0B'; // amber glow
          borderWidth = 3.5;
        } else if (isSink) {
          borderColor = '#8B5CF6'; // purple glow
          borderWidth = 3;
        } else if (isHub) {
          borderColor = '#38BDF8'; // sky blue
          borderWidth = 3.5;
        } else {
          borderColor = '#FFFFFF'; // crisp white flagged boundary
          borderWidth = 2.5;
        }
      } else {
        // Supporting counterparty: explicitly dashed, muted border to avoid false fraud labeling
        borderColor = 'rgba(148, 163, 184, 0.45)';
        borderWidth = 1.5;
        borderStyle = 'dashed';
        baseColor = '#475569';
      }

      return {
        data: {
          id: node.id,
          label: node.id,
          type: node.type,
          roles: node.roles.join(', ') || 'member',
          inCase: node.in_case,
          isOrigin,
          isSink,
          isHub,
          baseColor,
          borderColor,
          borderWidth,
          borderStyle,
          nodeSize: isHub ? 38 : isOrigin || isSink ? 32 : node.in_case ? 28 : 22,
        },
      };
    });

    // Prepare Cytoscape edges
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

    // Choose appropriate layout based on case typologies
    const patterns = caseDetail?.patterns || [];
    let layoutConfig: any = {
      name: 'cose',
      animate: false,
      padding: 40,
      nodeRepulsion: () => 550000,
      idealEdgeLength: () => 120,
      componentSpacing: 70,
      nodeOverlap: 25,
    };

    if (patterns.includes('cycle') && nodes.length <= 12) {
      layoutConfig = { name: 'circle', padding: 45, animate: false };
    } else if ((patterns.includes('fan_in') || patterns.includes('fan_out')) && nodes.length <= 35) {
      layoutConfig = { name: 'concentric', padding: 40, animate: false };
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...nodes, ...edges],
      style: [
        {
          selector: 'node',
          style: {
            label: showLabels ? 'data(label)' : '',
            color: '#F8FAFC',
            'font-size': '9.5px',
            'font-family': 'ui-monospace, monospace',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'background-color': 'data(baseColor)',
            'border-width': 'data(borderWidth)',
            'border-color': 'data(borderColor)',
            'border-style': 'data(borderStyle)',
            width: 'data(nodeSize)',
            height: 'data(nodeSize)',
            'text-background-color': '#080C14',
            'text-background-opacity': 0.85,
            'text-background-padding': '2.5px',
            'text-background-shape': 'roundrectangle',
            'transition-property': 'background-color, border-color, width, height, opacity',
            'transition-duration': 0.15,
          } as any,
        },
        // Central selected entity with distinct glowing outline
        {
          selector: 'node.selected-entity, node:selected',
          style: {
            'border-color': '#38BDF8',
            'border-width': 4,
            'border-opacity': 1,
            'shadow-blur': 25,
            'shadow-color': '#38BDF8',
            'shadow-opacity': 0.9,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'overlay-color': '#38BDF8',
            'overlay-opacity': 0.25,
            'overlay-padding': 7,
            width: 36,
            height: 36,
            color: '#FFFFFF',
            'font-size': '10.5px',
            'font-weight': 700,
            'z-index': 9999,
          } as any,
        },
        // Highlighted counterparties when inspecting 1-hop neighborhood
        {
          selector: 'node.counterparty-highlight',
          style: {
            'border-color': '#F59E0B',
            'border-width': 3,
            'border-style': 'solid',
            'shadow-blur': 15,
            'shadow-color': '#F59E0B',
            'shadow-opacity': 0.75,
            opacity: 1,
            'z-index': 8000,
          } as any,
        },
        // Directed transaction edges with sharp arrowheads
        {
          selector: 'edge',
          style: {
            width: 1.8,
            'line-color': 'rgba(148, 163, 184, 0.45)',
            'target-arrow-color': 'rgba(148, 163, 184, 0.75)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 1.1,
            label: showAmounts ? 'data(label)' : '',
            'font-size': '8.5px',
            'font-family': 'ui-monospace, monospace',
            'font-weight': 500,
            color: '#94A3B8',
            'text-background-opacity': 0.9,
            'text-background-color': '#0F172A',
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            'text-rotation': 'autorotate',
            'text-margin-y': -5,
            'transition-property': 'line-color, target-arrow-color, width, opacity',
            'transition-duration': 0.15,
          } as any,
        },
        // Highlighted connected edges
        {
          selector: 'edge.connected-to-selected',
          style: {
            width: 2.8,
            'line-color': '#38BDF8',
            'target-arrow-color': '#38BDF8',
            'arrow-scale': 1.25,
            color: '#38BDF8',
            'font-weight': 700,
            'z-index': 99,
            opacity: 1,
          } as any,
        },
        // Selected single transfer
        {
          selector: 'edge.selected-transfer',
          style: {
            width: 3.8,
            'line-color': '#F59E0B',
            'target-arrow-color': '#F59E0B',
            'arrow-scale': 1.35,
            color: '#FDE047',
            'font-weight': 700,
            'z-index': 999,
            opacity: 1,
          } as any,
        },
        // Dimmed elements when an entity is focused
        {
          selector: 'node.dimmed, edge.dimmed',
          style: {
            opacity: 0.22,
          } as any,
        },
      ],
      layout: layoutConfig,
      minZoom: 0.25,
      maxZoom: 3.5,
      wheelSensitivity: 0.25,
    });

    // Tap node: select central entity and highlight its incident flows
    cy.on('tap', 'node', (evt: EventObject) => {
      const nodeId = evt.target.id();
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setInspectMode('overview');
      onSelectTx(null);
    });

    // Tap edge: select transaction transfer
    cy.on('tap', 'edge', (evt: EventObject) => {
      const txId = evt.target.id();
      setSelectedEdgeId(txId);
      onSelectTx(txId);
    });

    // Tap blank canvas: clear selections
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        onSelectTx(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graphData, loading, showLabels, showAmounts, caseDetail?.patterns, onSelectTx]);

  // Synchronize canvas selection and neighborhood dimming when selectedNodeId changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().removeClass('selected-entity connected-to-selected counterparty-highlight dimmed');

    if (selectedNodeId) {
      const node = cy.getElementById(selectedNodeId);
      if (node && node.length > 0) {
        node.addClass('selected-entity');

        // Find connected edges and counterparties
        const connectedEdges = node.connectedEdges();
        connectedEdges.addClass('connected-to-selected');

        const neighbors = connectedEdges.connectedNodes().not(node);
        neighbors.addClass('counterparty-highlight');

        // Dim everything else
        const activeSet = node.union(connectedEdges).union(neighbors);
        cy.elements().not(activeSet).addClass('dimmed');

        // Center on the selected entity
        cy.animate({
          center: { eles: node },
          zoom: Math.max(cy.zoom(), 1.25),
          duration: 350,
        });
      }
    }
  }, [selectedNodeId]);

  // Synchronize edge selection state
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.edges().removeClass('selected-transfer');
    const targetTxId = selectedTx?.tx_id || selectedEdgeId;

    if (targetTxId) {
      const edge = cy.getElementById(targetTxId);
      if (edge && edge.length > 0) {
        edge.addClass('selected-transfer');
        cy.animate({
          center: { eles: edge },
          duration: 300,
        });
      }
    }
  }, [selectedTx, selectedEdgeId]);

  // Action: Inspect Counterparties
  const handleInspectCounterparties = useCallback(() => {
    if (!selectedNodeId) return;
    setInspectMode('counterparties');
    void fetchAccountDetails(selectedNodeId);

    // In canvas: center and fit the 1-hop neighborhood
    const cy = cyRef.current;
    if (cy) {
      const node = cy.getElementById(selectedNodeId);
      if (node && node.length > 0) {
        const neighborhood = node.closedNeighborhood();
        cy.animate({
          fit: { eles: neighborhood, padding: 50 },
          duration: 400,
        });
      }
    }
  }, [selectedNodeId, fetchAccountDetails]);

  // Copy account ID to clipboard
  const handleCopyAccount = (accId: string) => {
    void navigator.clipboard.writeText(accId);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 1800);
  };

  // Zoom / Pan / Layout Actions
  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.25);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() / 1.25);
  const handleFit = () => cyRef.current?.fit(undefined, 35);
  const handleReset = () => {
    if (!cyRef.current) return;
    cyRef.current.elements().removeClass('selected-entity connected-to-selected counterparty-highlight dimmed selected-transfer');
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    onSelectTx(null);
    cyRef.current.elements().layout({ name: 'cose', animate: true, padding: 35 }).run();
  };

  // Loading state
  if (loading) {
    return (
      <div
        className="rt-card"
        style={{
          height: isExpanded ? '640px' : '440px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#080C14',
          borderRadius: '10px',
          border: '1px solid #1E293B',
          gap: '1rem',
          color: '#94A3B8',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            border: '3px solid #1E293B',
            borderTopColor: '#38BDF8',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#E2E8F0' }}>
          Loading case forensic evidence and graph topology...
        </div>
        <div style={{ fontSize: '0.725rem', color: '#64748B' }}>
          Extracting directed transaction edges from FalkorDB <span className="mono">txn</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className="rt-card"
        style={{
          height: '440px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#080C14',
          borderRadius: '10px',
          border: '1px solid #334155',
          gap: '1rem',
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <div
          style={{
            width: '46px',
            height: '46px',
            borderRadius: '10px',
            backgroundColor: '#451A1A',
            border: '1px solid #7F1D1D',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#F87171',
          }}
        >
          <AlertTriangle size={22} />
        </div>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#F1F5F9', margin: 0 }}>
            Case Graph Unavailable
          </h3>
          <p style={{ fontSize: '0.8rem', color: '#94A3B8', marginTop: '0.35rem', maxWidth: '380px' }}>
            {error.message || 'Could not retrieve case topology from database.'}
          </p>
        </div>
        {onRetry && (
          <button onClick={onRetry} className="rt-button rt-button-primary rt-button-sm">
            <RefreshCw size={12} />
            <span>Retry Graph Query</span>
          </button>
        )}
      </div>
    );
  }

  // Empty state
  if (!graphData || (graphData.nodes.length === 0 && graphData.edges.length === 0)) {
    return (
      <div
        className="rt-card"
        style={{
          height: '440px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#080C14',
          borderRadius: '10px',
          border: '1px solid #1E293B',
          gap: '1rem',
          color: '#64748B',
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <Layers size={36} color="#334155" />
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#E2E8F0', margin: 0 }}>
            No Graph Topology Available
          </h3>
          <p style={{ fontSize: '0.775rem', color: '#64748B', marginTop: '0.25rem', maxWidth: '360px' }}>
            This case contains no flagged transaction paths or entity links. Run a detection scan to discover evidence.
          </p>
        </div>
        {onRefreshGraph && (
          <button onClick={onRefreshGraph} className="rt-button rt-button-sm" style={{ marginTop: '0.25rem' }}>
            <RefreshCw size={12} />
            <span>Refresh Case Graph</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        height: isExpanded ? '640px' : '480px',
        backgroundColor: '#080C14',
        borderRadius: '10px',
        border: '1px solid #1E293B',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        transition: 'height 0.25s ease-in-out',
        boxShadow: 'inset 0 2px 12px rgba(0, 0, 0, 0.6)',
      }}
    >
      {/* Cytoscape Container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />

      {/* Top Banner: Partial Scan or Stale Data Warnings */}
      {(latestScanStatus === 'partial' || isStale) && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: '6px',
            padding: '0.35rem 0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: '#FDE68A',
            fontSize: '0.725rem',
            fontWeight: 500,
            zIndex: 20,
            backdropFilter: 'blur(8px)',
          }}
        >
          <AlertTriangle size={13} color="#F59E0B" />
          <span>
            {latestScanStatus === 'partial'
              ? 'Notice: Latest scan reported partial bounds (search limits reached). Confirmed forensic evidence shown.'
              : 'New detection scan finished. Case evidence may be refreshed.'}
          </span>
          {onRefreshGraph && (
            <button
              onClick={onRefreshGraph}
              style={{
                background: 'none',
                border: 'none',
                color: '#38BDF8',
                cursor: 'pointer',
                fontWeight: 700,
                padding: '0 0.2rem',
                textDecoration: 'underline',
              }}
            >
              Refresh
            </button>
          )}
        </div>
      )}

      {/* Top-Right HUD Controls Toolbar */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          padding: '4px 6px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          backdropFilter: 'blur(8px)',
          zIndex: 15,
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
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
          title="Reset Layout & Clear Selection"
        >
          <RefreshCw size={14} />
        </button>

        <span style={{ color: 'rgba(255,255,255,0.15)', margin: '0 2px' }}>|</span>

        {/* Labels Toggle */}
        <button
          onClick={() => setShowLabels((prev) => !prev)}
          className="rt-button rt-button-sm"
          style={{
            padding: '4px 6px',
            border: 'none',
            background: showLabels ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
            color: showLabels ? '#38BDF8' : '#64748B',
          }}
          title={showLabels ? 'Hide Account Labels' : 'Show Account Labels'}
        >
          {showLabels ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        {/* Amounts Toggle */}
        <button
          onClick={() => setShowAmounts((prev) => !prev)}
          className="rt-button rt-button-sm"
          style={{
            padding: '4px 6px',
            border: 'none',
            background: showAmounts ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
            color: showAmounts ? '#38BDF8' : '#64748B',
          }}
          title={showAmounts ? 'Hide Transaction Amounts' : 'Show Transaction Amounts'}
        >
          <DollarSign size={14} />
        </button>

        {/* Canvas Height Expand Toggle */}
        <button
          onClick={() => setIsExpanded((prev) => !prev)}
          className="rt-button rt-button-sm"
          style={{
            padding: '4px 6px',
            border: 'none',
            background: isExpanded ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
            color: isExpanded ? '#38BDF8' : '#94A3B8',
          }}
          title={isExpanded ? 'Collapse Canvas' : 'Expand Canvas Height'}
        >
          {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Top-Left Telemetry / Case Subgraph Info */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          padding: '4px 10px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(8px)',
          zIndex: 10,
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#10B981',
          }}
          className="pulse-indicator"
        />
        <span style={{ fontSize: '0.725rem', fontWeight: 700, color: '#F1F5F9', fontFamily: 'JetBrains Mono, monospace' }}>
          {graphData.nodes.length} Entities
        </span>
        <span style={{ color: '#64748B', fontSize: '0.7rem' }}>•</span>
        <span style={{ fontSize: '0.725rem', fontWeight: 600, color: '#38BDF8', fontFamily: 'JetBrains Mono, monospace' }}>
          {graphData.edges.length} Directed Transfers
        </span>
        {latestScanTime && (
          <>
            <span style={{ color: '#64748B', fontSize: '0.7rem' }}>•</span>
            <span style={{ fontSize: '0.675rem', color: '#94A3B8' }}>
              Scan: {latestScanTime.substring(11, 19)}
            </span>
          </>
        )}
      </div>

      {/* Selected Entity Details Panel (Floating Dock on Right) */}
      {selectedNode && (
        <div
          style={{
            position: 'absolute',
            top: '52px',
            right: '12px',
            width: '320px',
            maxHeight: isExpanded ? '560px' : '410px',
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            border: '1px solid #334155',
            borderRadius: '10px',
            padding: '1rem',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.75)',
            zIndex: 25,
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            overflowY: 'auto',
          }}
        >
          {/* Header with Account ID and Close */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span className="mono" style={{ fontSize: '0.95rem', fontWeight: 800, color: '#38BDF8' }}>
                  {selectedNode.id}
                </span>
                <button
                  onClick={() => handleCopyAccount(selectedNode.id)}
                  style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: 0 }}
                  title="Copy Account ID"
                >
                  {copiedAccount ? <Check size={12} color="#10B981" /> : <Copy size={12} />}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                <span
                  style={{
                    padding: '0.1rem 0.45rem',
                    borderRadius: '4px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    backgroundColor:
                      selectedNode.type === 'merchant'
                        ? 'rgba(14, 165, 233, 0.2)'
                        : selectedNode.type === 'payroll'
                        ? 'rgba(16, 185, 129, 0.2)'
                        : 'rgba(99, 102, 241, 0.2)',
                    color:
                      selectedNode.type === 'merchant'
                        ? '#38BDF8'
                        : selectedNode.type === 'payroll'
                        ? '#34D399'
                        : '#818CF8',
                    border: `1px solid ${
                      selectedNode.type === 'merchant'
                        ? 'rgba(14, 165, 233, 0.3)'
                        : selectedNode.type === 'payroll'
                        ? 'rgba(16, 185, 129, 0.3)'
                        : 'rgba(99, 102, 241, 0.3)'
                    }`,
                  }}
                >
                  {selectedNode.type}
                </span>

                {selectedNode.roles.length > 0 && (
                  <span
                    style={{
                      padding: '0.1rem 0.45rem',
                      borderRadius: '4px',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      backgroundColor: 'rgba(245, 158, 11, 0.2)',
                      color: '#FBBF24',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                    }}
                  >
                    {selectedNode.roles.join(', ')}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                setSelectedNodeId(null);
                setInspectMode('overview');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                padding: '2px',
              }}
              title="Close Panel"
            >
              <X size={15} />
            </button>
          </div>

          {/* Flagged Status Pill */}
          <div
            style={{
              padding: '0.4rem 0.65rem',
              borderRadius: '6px',
              backgroundColor: selectedNode.in_case ? 'rgba(220, 38, 38, 0.15)' : 'rgba(71, 85, 105, 0.2)',
              border: `1px solid ${selectedNode.in_case ? 'rgba(220, 38, 38, 0.3)' : 'rgba(71, 85, 105, 0.3)'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.725rem',
              color: selectedNode.in_case ? '#FCA5A5' : '#94A3B8',
            }}
          >
            {selectedNode.in_case ? (
              <>
                <ShieldAlert size={14} color="#EF4444" />
                <span style={{ fontWeight: 600 }}>Flagged in Case Topology</span>
              </>
            ) : (
              <>
                <Info size={14} color="#94A3B8" />
                <span>Contextual Counterparty (Not Flagged as Fraud)</span>
              </>
            )}
          </div>

          {/* Sub-view switcher inside panel */}
          <div style={{ display: 'flex', borderBottom: '1px solid #334155', paddingBottom: '0.35rem', gap: '0.5rem' }}>
            <button
              onClick={() => setInspectMode('overview')}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: inspectMode === 'overview' ? '2px solid #38BDF8' : 'none',
                color: inspectMode === 'overview' ? '#38BDF8' : '#94A3B8',
                fontSize: '0.725rem',
                fontWeight: 600,
                padding: '0.2rem 0.4rem',
                cursor: 'pointer',
              }}
            >
              Case Flows
            </button>
            <button
              onClick={handleInspectCounterparties}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: inspectMode === 'counterparties' ? '2px solid #38BDF8' : 'none',
                color: inspectMode === 'counterparties' ? '#38BDF8' : '#94A3B8',
                fontSize: '0.725rem',
                fontWeight: 600,
                padding: '0.2rem 0.4rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              <Users size={12} />
              <span>Counterparties ({nodeTransactions.counterparties.length})</span>
            </button>
          </div>

          {/* Mode 1: Case Flow Summary */}
          {inspectMode === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.5rem',
                }}
              >
                {/* Inflow Card */}
                <div
                  style={{
                    backgroundColor: '#1E293B',
                    padding: '0.5rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#10B981', fontSize: '0.675rem', fontWeight: 600 }}>
                    <ArrowDownLeft size={12} />
                    <span>Inflow</span>
                  </div>
                  <div className="mono" style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F1F5F9', marginTop: '0.2rem' }}>
                    {currency.format(nodeTransactions.totalIn)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>
                    {nodeTransactions.incoming.length} transfers
                  </div>
                </div>

                {/* Outflow Card */}
                <div
                  style={{
                    backgroundColor: '#1E293B',
                    padding: '0.5rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#F59E0B', fontSize: '0.675rem', fontWeight: 600 }}>
                    <ArrowUpRight size={12} />
                    <span>Outflow</span>
                  </div>
                  <div className="mono" style={{ fontSize: '0.875rem', fontWeight: 700, color: '#F1F5F9', marginTop: '0.2rem' }}>
                    {currency.format(nodeTransactions.totalOut)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>
                    {nodeTransactions.outgoing.length} transfers
                  </div>
                </div>
              </div>

              {/* Primary Action Button: Inspect Counterparties */}
              <button
                onClick={handleInspectCounterparties}
                className="rt-button rt-button-primary rt-button-sm"
                style={{ width: '100%', justifyContent: 'center', gap: '0.4rem', marginTop: '0.25rem' }}
              >
                <Users size={13} />
                <span>Inspect Counterparties</span>
              </button>
            </div>
          )}

          {/* Mode 2: Counterparty Breakdown & Account Intelligence */}
          {inspectMode === 'counterparties' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {/* External Intelligence from Backend API (if loaded) */}
              {loadingAccountDetails ? (
                <div style={{ fontSize: '0.725rem', color: '#94A3B8', textAlign: 'center', padding: '0.5rem' }}>
                  Querying database account profile...
                </div>
              ) : accountDetails?.account ? (
                <div
                  style={{
                    backgroundColor: '#1E293B',
                    borderRadius: '6px',
                    padding: '0.5rem 0.65rem',
                    fontSize: '0.7rem',
                    color: '#94A3B8',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    border: '1px solid #334155',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Layers size={11} color="#38BDF8" />
                      <span>Community Cluster:</span>
                    </span>
                    <strong className="mono" style={{ color: '#F1F5F9' }}>
                      #{accountDetails.account.community ?? 'N/A'}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={11} color="#38BDF8" />
                      <span>Created Timestamp:</span>
                    </span>
                    <span className="mono" style={{ color: '#F1F5F9' }}>
                      {accountDetails.account.created || 'N/A'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Database size={11} color="#38BDF8" />
                      <span>Total Transferred (Sample):</span>
                    </span>
                    <span className="mono" style={{ color: '#10B981' }}>
                      {currency.format(accountDetails.total_sent_sample + accountDetails.total_received_sample)}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Counterparties list in this case */}
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                Direct Counterparties in Case:
              </div>
              <div
                style={{
                  maxHeight: '140px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                {nodeTransactions.counterparties.map((cp) => (
                  <div
                    key={cp.id}
                    onClick={() => {
                      setSelectedNodeId(cp.id);
                      setInspectMode('overview');
                    }}
                    style={{
                      padding: '0.35rem 0.5rem',
                      backgroundColor: '#1E293B',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      fontSize: '0.725rem',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                    title="Click to focus counterparty"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span className="mono" style={{ color: '#38BDF8', fontWeight: 600 }}>
                        {cp.id}
                      </span>
                      {cp.type && (
                        <span style={{ fontSize: '0.625rem', color: '#94A3B8' }}>
                          ({cp.type})
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="mono" style={{ color: '#F1F5F9', fontWeight: 700, fontSize: '0.725rem' }}>
                        {currency.format(cp.inAmount + cp.outAmount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deep link action: Open in Transaction Explorer */}
          <button
            onClick={() => onSelectAccount(selectedNode.id)}
            className="rt-button rt-button-sm"
            style={{ width: '100%', justifyContent: 'center', gap: '0.4rem', border: '1px solid #334155', color: '#94A3B8' }}
          >
            <span>Open in Transaction Explorer</span>
            <ExternalLink size={12} />
          </button>
        </div>
      )}

      {/* Selected Transaction Edge Callout Card */}
      {selectedEdgeObj && !selectedNode && (
        <div
          style={{
            position: 'absolute',
            bottom: '46px',
            right: '12px',
            width: '290px',
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            border: '1px solid #F59E0B',
            borderRadius: '8px',
            padding: '0.75rem',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
            zIndex: 20,
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
            <span
              style={{
                fontSize: '0.675rem',
                fontWeight: 700,
                color: '#F59E0B',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Selected Directed Transfer
            </span>
            <button
              onClick={() => {
                setSelectedEdgeId(null);
                onSelectTx(null);
              }}
              style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 0 }}
            >
              <X size={13} />
            </button>
          </div>
          <div className="mono" style={{ fontSize: '0.8rem', fontWeight: 700, color: '#F1F5F9' }}>
            {selectedEdgeObj.tx_id}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginTop: '0.35rem',
              fontSize: '0.775rem',
            }}
          >
            <span className="mono" style={{ color: '#38BDF8', fontWeight: 600 }}>
              {selectedEdgeObj.source}
            </span>
            <ArrowRight size={13} color="#94A3B8" />
            <span className="mono" style={{ color: '#38BDF8', fontWeight: 600 }}>
              {selectedEdgeObj.target}
            </span>
          </div>
          <div style={{ marginTop: '0.35rem', fontSize: '0.875rem', fontWeight: 800, color: '#FDE047' }} className="mono">
            {currency.format(selectedEdgeObj.amount)}
          </div>
        </div>
      )}

      {/* Bottom Color & Symbol Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          padding: '4px 10px',
          borderRadius: '6px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          fontSize: '0.675rem',
          color: '#94A3B8',
          zIndex: 10,
          backdropFilter: 'blur(8px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B', border: '1px solid #D97706' }} />
          <span>Origin (Flagged)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#8B5CF6', border: '1px solid #7C3AED' }} />
          <span>Sink</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0EA5E9', border: '1px solid #0284C7' }} />
          <span>Merchant Hub</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981', border: '1px solid #059669' }} />
          <span>Payroll</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#6366F1', border: '1px solid #4F46E5' }} />
          <span>Personal</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#475569',
              border: '1px dashed #94A3B8',
            }}
          />
          <span>Supporting Counterparty (Not Flagged)</span>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#38BDF8', boxShadow: '0 0 6px #38BDF8' }} />
          <span style={{ color: '#BAE6FD', fontWeight: 600 }}>Selected Glowing Halo</span>
        </div>
      </div>
    </div>
  );
};

export default CaseGraphCanvas;

