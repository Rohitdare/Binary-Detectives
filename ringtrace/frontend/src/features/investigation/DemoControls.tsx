import React, { useEffect, useState, useRef } from 'react';
import {
  RotateCcw,
  Play,
  Pause,
  Square,
  Activity,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { ringtraceApi } from '../../services/api';
import type { StreamStatus, DemoResetResponse } from '../../types';

export interface DemoControlsProps {
  onResetComplete?: (res: DemoResetResponse) => void;
}

export const DemoControls: React.FC<DemoControlsProps> = ({ onResetComplete = () => {} }) => {
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({
    state: 'idle',
    sent: 0,
    total: 4067,
    batch_size: 50,
  });
  const [batchSize, setBatchSize] = useState<number>(50);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);
  const [recentBurst, setRecentBurst] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchStatus = async () => {
    try {
      const s = await ringtraceApi.getStreamStatus();
      setStreamStatus(s);
    } catch {
      // ignore on initial load
    }
  };

  useEffect(() => {
    fetchStatus();

    // Connect to /api/v1/stream/events SSE stream
    const es = new EventSource('/api/v1/stream/events');
    eventSourceRef.current = es;

    es.addEventListener('stream_status', (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        setStreamStatus((prev) => ({ ...prev, ...data }));
      } catch (e) {
        console.error('Failed to parse stream_status', e);
      }
    });

    es.addEventListener('tx_batch', (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        setStreamStatus((prev) => ({
          ...prev,
          sent: data.sent,
          total: data.total,
          state: 'running',
        }));
        setRecentBurst(`Injected burst: ${data.count} transactions (Total: ${data.sent} / ${data.total})`);
      } catch (e) {
        console.error('Failed to parse tx_batch', e);
      }
    });

    es.addEventListener('case_created', (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        setRecentBurst(`New Case Detected: ${data.case_id} (Score: ${data.score})`);
      } catch (e) {
        console.error('Failed to parse case_created', e);
      }
    });

    return () => {
      es.close();
    };
  }, []);

  const handleStart = async () => {
    setLoadingAction('start');
    try {
      const s = await ringtraceApi.startStream(batchSize, 1.0);
      setStreamStatus(s);
    } catch (err: any) {
      console.error('Failed to start stream', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handlePause = async () => {
    setLoadingAction('pause');
    try {
      const s = await ringtraceApi.pauseStream();
      setStreamStatus(s);
    } catch (err: any) {
      console.error('Failed to pause stream', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResume = async () => {
    setLoadingAction('resume');
    try {
      const s = await ringtraceApi.resumeStream();
      setStreamStatus(s);
    } catch (err: any) {
      console.error('Failed to resume stream', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleStop = async () => {
    setLoadingAction('stop');
    try {
      const s = await ringtraceApi.stopStream();
      setStreamStatus(s);
    } catch (err: any) {
      console.error('Failed to stop stream', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResetDemo = async () => {
    setLoadingAction('reset');
    setResetFeedback(null);
    try {
      const res = await ringtraceApi.resetDemo();
      setStreamStatus((prev) => ({ ...prev, state: 'idle', sent: 0 }));
      setRecentBurst(null);
      setResetFeedback(`Demo Environment Reset: Cleared memory graph, wiped ${res.removed_demo_accounts} demo accounts, reset replay stream, and restored ${res.cases_seeded} clean seed cases.`);
      onResetComplete(res);
    } catch (err: any) {
      setResetFeedback(`Reset failed: ${err?.message || 'Error executing demo reset.'}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const percent = streamStatus.total > 0 ? Math.round((streamStatus.sent / streamStatus.total) * 100) : 0;

  return (
    <div
      className="rt-card"
      style={{
        marginBottom: '1.25rem',
        backgroundColor: 'rgba(11, 17, 28, 0.95)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        {/* Left: Replay Status & Live Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              padding: '0.45rem',
              borderRadius: '8px',
              backgroundColor: streamStatus.state === 'running' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              color: streamStatus.state === 'running' ? 'var(--accent-cyan)' : 'var(--text-muted)',
            }}
          >
            <Radio size={20} className={streamStatus.state === 'running' ? 'spin' : ''} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Live Transaction Stream Replay
              </span>
              <span
                className={`rt-badge ${streamStatus.state === 'running' ? 'badge-merchant' : streamStatus.state === 'paused' ? 'badge-warning' : 'badge-personal'}`}
                style={{ fontSize: '0.675rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {streamStatus.state}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Replaying withheld transaction bursts ({streamStatus.sent.toLocaleString()} / {streamStatus.total.toLocaleString()} txs • {percent}%)
            </div>
          </div>
        </div>

        {/* Right: Controls & One-Click Demo Reset */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          {/* Burst Size Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>Burst:</span>
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              disabled={streamStatus.state === 'running'}
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                padding: '0.25rem 0.5rem',
                color: 'var(--text-primary)',
                fontSize: '0.75rem',
              }}
            >
              <option value={25}>25 tx/s</option>
              <option value={50}>50 tx/s</option>
              <option value={100}>100 tx/s</option>
            </select>
          </div>

          {/* Stream Controls */}
          {streamStatus.state !== 'running' && (
            <button
              onClick={streamStatus.state === 'paused' ? handleResume : handleStart}
              disabled={loadingAction !== null}
              className="rt-button rt-button-sm"
              style={{ backgroundColor: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.35)', color: 'var(--accent-cyan)' }}
              title="Start Playback"
            >
              <Play size={13} />
              <span>{streamStatus.state === 'paused' ? 'Resume' : 'Start Replay'}</span>
            </button>
          )}

          {streamStatus.state === 'running' && (
            <button
              onClick={handlePause}
              disabled={loadingAction !== null}
              className="rt-button rt-button-sm"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.35)', color: 'var(--accent-amber)' }}
              title="Pause Playback"
            >
              <Pause size={13} />
              <span>Pause</span>
            </button>
          )}

          {streamStatus.state === 'running' && (
            <button
              onClick={handleStop}
              disabled={loadingAction !== null}
              className="rt-button rt-button-sm"
              style={{ backgroundColor: 'rgba(244, 63, 94, 0.12)', borderColor: 'rgba(244, 63, 94, 0.3)', color: 'var(--accent-rose)' }}
              title="Stop Playback"
            >
              <Square size={13} />
              <span>Stop</span>
            </button>
          )}

          {/* One-Click Demo Reset Button */}
          <button
            onClick={handleResetDemo}
            disabled={loadingAction !== null}
            className="rt-button rt-button-sm"
            style={{
              backgroundColor: 'rgba(244, 63, 94, 0.18)',
              borderColor: 'rgba(244, 63, 94, 0.45)',
              color: 'var(--accent-rose)',
              fontWeight: 600,
            }}
            title="Wipe memory, clean injected demo data, and restore clean seed cases"
          >
            {loadingAction === 'reset' ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
            <span>One-Click Demo Reset</span>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: '100%',
          height: '4px',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '2px',
          marginTop: '0.75rem',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            backgroundColor: streamStatus.state === 'running' ? 'var(--accent-cyan)' : 'var(--accent-purple)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Live Burst Info or Reset Feedback */}
      {recentBurst && (
        <div style={{ marginTop: '0.65rem', fontSize: '0.725rem', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Activity size={12} />
          <span>{recentBurst}</span>
        </div>
      )}

      {resetFeedback && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.55rem 0.85rem',
            borderRadius: '6px',
            backgroundColor: resetFeedback.includes('failed') ? 'rgba(244, 63, 94, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            border: `1px solid ${resetFeedback.includes('failed') ? 'rgba(244, 63, 94, 0.35)' : 'rgba(16, 185, 129, 0.35)'}`,
            color: resetFeedback.includes('failed') ? 'var(--accent-rose)' : 'var(--accent-emerald)',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          {resetFeedback.includes('failed') ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          <span>{resetFeedback}</span>
        </div>
      )}
    </div>
  );
};

export default DemoControls;
