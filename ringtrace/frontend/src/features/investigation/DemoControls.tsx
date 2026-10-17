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
  Loader2,
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
  const [recentBurst, setRecentBurst] = useState<string | null>(null);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);

  const pollIntervalRef = useRef<any>(null);

  const fetchStatus = async () => {
    try {
      const status = await ringtraceApi.getStreamStatus();
      setStreamStatus(status);
      setBatchSize(status.batch_size || 50);
    } catch (err) {
      // Keep silent during polling failures
    }
  };

  useEffect(() => {
    fetchStatus();
    pollIntervalRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleStart = async () => {
    setLoadingAction('start');
    try {
      const res = await ringtraceApi.startStream(batchSize);
      setStreamStatus((prev) => ({
        ...prev,
        state: 'running',
        sent: res.sent,
        total: res.total,
      }));
      setRecentBurst(`Started transaction stream replay at ${batchSize} tx/batch`);
    } catch (err: any) {
      console.error('Failed to start stream', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handlePause = async () => {
    setLoadingAction('pause');
    try {
      await ringtraceApi.pauseStream();
      setStreamStatus((prev) => ({ ...prev, state: 'paused' }));
    } catch (err: any) {
      console.error('Failed to pause stream', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResume = async () => {
    setLoadingAction('resume');
    try {
      const res = await ringtraceApi.resumeStream();
      setStreamStatus((prev) => ({
        ...prev,
        state: 'running',
        sent: res.sent,
        total: res.total,
      }));
    } catch (err: any) {
      console.error('Failed to resume stream', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleStop = async () => {
    setLoadingAction('stop');
    try {
      await ringtraceApi.stopStream();
      setStreamStatus((prev) => ({ ...prev, state: 'idle' }));
    } catch (err: any) {
      console.error('Failed to stop stream', err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResetDemo = async () => {
    if (!window.confirm('Reset Demo Environment?\n\nThis will wipe the memory graph, delete all demo_ injected accounts, reset transaction stream replay to 0, and re-seed clean seed cases (CASE_0001, CASE_0002, CASE_0003).')) {
      return;
    }
    setLoadingAction('reset');
    setResetFeedback(null);
    try {
      const res = await ringtraceApi.resetDemo();
      setStreamStatus((prev) => ({
        ...prev,
        state: 'idle',
        sent: 0,
      }));
      setResetFeedback(`Environment successfully reset! Memory cleared, deleted ${res.removed_demo_accounts} injected accounts (${res.removed_demo_edges} edges), and re-seeded ${res.cases_seeded} baseline cases.`);
      onResetComplete(res);
    } catch (err: any) {
      setResetFeedback(`Demo reset failed: ${err?.message || 'Check backend logs.'}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const percent = streamStatus.total > 0
    ? Math.min(100, Math.round((streamStatus.sent / streamStatus.total) * 100))
    : 0;

  return (
    <div
      className="rt-card"
      style={{
        padding: '1.15rem 1.35rem',
        marginBottom: '1rem',
        backgroundColor: '#FFFFFF',
        border: '1px solid #E2E8F0',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        {/* Left: Replay Status & Live Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              padding: '0.55rem',
              borderRadius: '8px',
              backgroundColor: streamStatus.state === 'running' ? '#EFF6FF' : '#F1F5F9',
              color: streamStatus.state === 'running' ? '#0284C7' : '#64748B',
              border: '1px solid #E2E8F0',
            }}
          >
            <Radio size={19} className={streamStatus.state === 'running' ? 'spin' : ''} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A' }}>
                Live Transaction Stream Replay
              </span>
              <span
                style={{
                  fontSize: '0.675rem',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '9999px',
                  backgroundColor:
                    streamStatus.state === 'running'
                      ? '#EFF6FF'
                      : streamStatus.state === 'paused'
                      ? '#FFFBEB'
                      : '#F1F5F9',
                  color:
                    streamStatus.state === 'running'
                      ? '#0284C7'
                      : streamStatus.state === 'paused'
                      ? '#B45309'
                      : '#475569',
                  border: `1px solid ${
                    streamStatus.state === 'running'
                      ? '#BFDBFE'
                      : streamStatus.state === 'paused'
                      ? '#FCD34D'
                      : '#E2E8F0'
                  }`,
                }}
              >
                {streamStatus.state}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '0.15rem' }}>
              Replaying withheld transaction bursts (<span className="mono" style={{ fontWeight: 600 }}>{streamStatus.sent.toLocaleString()}</span> / <span className="mono">{streamStatus.total.toLocaleString()}</span> txs • <span className="mono" style={{ fontWeight: 600 }}>{percent}%</span>)
            </div>
          </div>
        </div>

        {/* Right: Controls & One-Click Demo Reset */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          {/* Burst Size Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.725rem', color: '#64748B', fontWeight: 500 }}>Burst:</span>
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              disabled={streamStatus.state === 'running'}
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: '6px',
                padding: '0.25rem 0.5rem',
                color: '#0F172A',
                fontSize: '0.75rem',
                fontWeight: 500,
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
              style={{ gap: '0.35rem' }}
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
                style={{ backgroundColor: '#FFFBEB', borderColor: '#FCD34D', color: '#B45309' }}
                title="Pause Stream Playback"
              >
                {loadingAction === 'pause' ? <Loader2 size={13} className="spin" /> : <Pause size={13} />}
                <span>Pause</span>
              </button>
              <button
                onClick={handleStop}
                disabled={loadingAction !== null}
                className="rt-button rt-button-sm"
                style={{ backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', color: '#B91C1C' }}
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
              backgroundColor: '#FEF2F2',
              borderColor: '#FCA5A5',
              color: '#B91C1C',
              fontWeight: 600,
            }}
            title="Wipe demo state, reset memory graph and re-seed clean baseline"
          >
            {loadingAction === 'reset' ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
            <span>Reset Demo</span>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: '100%',
          height: '5px',
          backgroundColor: '#F1F5F9',
          borderRadius: '9999px',
          marginTop: '0.85rem',
          overflow: 'hidden',
          border: '1px solid #E2E8F0',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            background: 'linear-gradient(90deg, #7C3AED 0%, #0284C7 100%)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Burst notification or reset feedback banner */}
      {(recentBurst || resetFeedback) && (
        <div
          style={{
            marginTop: '0.85rem',
            padding: '0.55rem 0.85rem',
            borderRadius: '6px',
            backgroundColor: resetFeedback
              ? resetFeedback.includes('failed')
                ? '#FEF2F2'
                : '#ECFDF5'
              : '#EFF6FF',
            border: `1px solid ${
              resetFeedback
                ? resetFeedback.includes('failed')
                  ? '#FCA5A5'
                  : '#6EE7B7'
                : '#BFDBFE'
            }`,
            color: resetFeedback
              ? resetFeedback.includes('failed')
                ? '#B91C1C'
                : '#047857'
              : '#0284C7',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: 500,
          }}
        >
          {resetFeedback ? (
            resetFeedback.includes('failed') ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />
          ) : (
            <Activity size={14} />
          )}
          <span style={{ flex: 1 }}>{resetFeedback || recentBurst}</span>
          <button
            onClick={() => {
              setRecentBurst(null);
              setResetFeedback(null);
            }}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.75rem', padding: '0 0.25rem' }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

export default DemoControls;
