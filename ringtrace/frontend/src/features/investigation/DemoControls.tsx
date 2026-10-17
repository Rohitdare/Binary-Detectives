import React, { useEffect, useState, useRef } from 'react';
import {
  RotateCcw,
  Play,
  Pause,
  Square,
  Activity,
  Radio,
  CheckCircle2,
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
        padding: '1rem 1.25rem',
        marginBottom: '1.25rem',
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
              backgroundColor: streamStatus.state === 'running' ? 'var(--brand-mint-subtle)' : 'var(--surface-secondary)',
              color: streamStatus.state === 'running' ? 'var(--brand-forest)' : 'var(--text-muted)',
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
                className={`rt-badge ${streamStatus.state === 'running' ? 'rt-badge-cyan' : streamStatus.state === 'paused' ? 'rt-badge-amber' : 'rt-badge-gray'}`}
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
                backgroundColor: 'var(--surface-primary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '6px',
                padding: '0.3rem 0.5rem',
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
              className="rt-button rt-button-primary rt-button-sm"
              title={streamStatus.state === 'paused' ? 'Resume Stream Playback' : 'Start Stream Playback'}
            >
              {loadingAction === 'start' || loadingAction === 'resume' ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <Play size={13} />
              )}
              <span>{streamStatus.state === 'paused' ? 'Resume' : 'Start Replay'}</span>
            </button>
          )}

          {streamStatus.state === 'running' && (
            <>
              <button
                onClick={handlePause}
                disabled={loadingAction !== null}
                className="rt-button rt-button-sm"
                title="Pause Stream Playback"
              >
                {loadingAction === 'pause' ? <Loader2 size={13} className="spin" /> : <Pause size={13} />}
                <span>Pause</span>
              </button>
              <button
                onClick={handleStop}
                disabled={loadingAction !== null}
                className="rt-button rt-button-sm"
                style={{ borderColor: 'var(--accent-red-border)', color: 'var(--accent-red)' }}
                title="Stop Stream Playback"
              >
                {loadingAction === 'stop' ? <Loader2 size={13} className="spin" /> : <Square size={13} />}
                <span>Stop</span>
              </button>
            </>
          )}

          {/* One-Click Demo Reset Button */}
          <button
            onClick={handleResetDemo}
            disabled={loadingAction !== null}
            className="rt-button rt-button-sm"
            style={{
              backgroundColor: 'var(--accent-amber-subtle)',
              borderColor: 'var(--accent-amber-border)',
              color: 'var(--accent-amber)',
              fontWeight: 600,
            }}
            title="Wipe demo state, reset memory graph and re-seed clean baseline"
          >
            {loadingAction === 'reset' ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
            <span>Reset Demo</span>
          </button>
        </div>
      </div>

      {/* Burst notification or reset feedback banner */}
      {(recentBurst || resetFeedback) && (
        <div
          style={{
            marginTop: '0.85rem',
            padding: '0.55rem 0.85rem',
            borderRadius: '6px',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: resetFeedback ? 'var(--accent-green-subtle)' : 'var(--accent-blue-subtle)',
            border: `1px solid ${resetFeedback ? 'var(--accent-green-border)' : 'var(--accent-blue-border)'}`,
            color: resetFeedback ? 'var(--accent-green)' : 'var(--accent-blue)',
          }}
        >
          {resetFeedback ? <CheckCircle2 size={14} /> : <Activity size={14} />}
          <span style={{ flex: 1 }}>{resetFeedback || recentBurst}</span>
          <button
            onClick={() => {
              setRecentBurst(null);
              setResetFeedback(null);
            }}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.7rem' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

export default DemoControls;
