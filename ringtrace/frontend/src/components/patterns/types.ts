import type { DetectorPattern, DetectorTransaction } from '../../types';

export interface WorkbenchCandidate {
  id: string;
  pattern: DetectorPattern;
  accounts: string[];
  transactions: DetectorTransaction[];
  measurements: Record<string, unknown>;
  suspicious: boolean;
  explanation: string;
  primaryLabel: string;
  totalAmount: number;
  timeSpanSeconds?: number;
}

export interface DetectorMetadata {
  id: DetectorPattern;
  name: string;
  tag: string;
  explanation: string;
  iconName: 'circle-dashed' | 'git-branch' | 'network' | 'arrow-right' | 'grid' | 'boxes' | 'share-2' | string;
  isLive: boolean;
}
