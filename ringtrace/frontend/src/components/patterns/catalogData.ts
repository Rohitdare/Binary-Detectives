import React from 'react';
import {
  CircleDashed,
  GitBranch,
  Network,
  ArrowRight,
  Grid,
  Boxes,
  Share2,
} from 'lucide-react';
import type { DetectorPattern } from '../../types';

export interface CatalogDetector {
  id: DetectorPattern;
  name: string;
  tag: string;
  explanation: string;
  icon: React.ComponentType<{ size?: number; className?: string; color?: string }>;
  isLive: boolean;
}

export const DETECTOR_CATALOG: CatalogDetector[] = [
  {
    id: 'cycle',
    name: 'Cycle Typology',
    tag: 'Circular Flow',
    explanation: 'Detects capital circulating through a closed directed loop of accounts (3-5 hops) returning to origin.',
    icon: CircleDashed,
    isLive: true,
  },
  {
    id: 'fan_in',
    name: 'Fan-In Structuring',
    tag: 'Smurfing Aggregation',
    explanation: 'Detects multiple disparate senders aggregating capital into a single receiver in a rolling 48-hour window.',
    icon: GitBranch,
    isLive: true,
  },
  {
    id: 'fan_out',
    name: 'Fan-Out Dispersal',
    tag: 'Rapid Layering',
    explanation: 'Detects a single high-velocity source dispersing capital across multiple recipients in a tight time frame.',
    icon: Network,
    isLive: true,
  },
  {
    id: 'relay_chain',
    name: 'Relay Chain',
    tag: 'Multi-Hop Pass-Through',
    explanation: 'Detects rapid sequential transfers through pass-through intermediary accounts with hop decay and time bounds.',
    icon: ArrowRight,
    isLive: true,
  },
  {
    id: 'scatter_gather',
    name: 'Scatter-Gather',
    tag: 'U-Turn Layering',
    explanation: 'Detects funds dispersed from one origin through intermediaries that recombine at a single destination.',
    icon: GitBranch,
    isLive: true,
  },
  {
    id: 'gather_scatter',
    name: 'Gather-Scatter',
    tag: 'Mule Aggregator',
    explanation: 'Detects an accumulator account collecting inflows from multiple accounts and dispersing to multiple targets.',
    icon: Network,
    isLive: true,
  },
  {
    id: 'bipartite',
    name: 'Bipartite Networks',
    tag: 'Layered Structuring',
    explanation: 'Detects dense many-to-many bipartite transfer rectangles where distinct source accounts coordinate transfers across a shared group of targets.',
    icon: Grid,
    isLive: true,
  },
  {
    id: 'dense_cluster',
    name: 'Dense Clusters',
    tag: 'Community Density',
    explanation: 'Identifies compact local transaction neighborhoods exhibiting unusually high directed internal edge density and high transfer frequency.',
    icon: Boxes,
    isLive: true,
  },
  {
    id: 'hub_account',
    name: 'Hub Account Velocity',
    tag: 'Outlier Centrality',
    explanation: 'Flags high-degree centrality hub accounts with anomalous transaction velocity and balanced aggregate inflows and outflows.',
    icon: Share2,
    isLive: true,
  },
];

export const ROADMAP_DETECTORS = [
  { name: 'Temporal Entropy', tag: 'Micro-Timing Analysis', note: 'Sub-second inter-arrival anomaly scoring' },
  { name: 'Cross-Channel Mule Mesh', tag: 'Omnichannel Hopping', note: 'Heterogeneous payment channel correlation' },
  { name: 'Flow-Ratio Deviation', tag: 'Volume Delta Sinks', note: 'Longitudinal asymmetric accumulation' },
];
