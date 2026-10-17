import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Clock, Play, Pause, RotateCcw, CheckCircle2, AlertCircle, X, Zap } from 'lucide-react';
import { ringtraceApi } from '../../services/api';
import type { SchedulerStatus } from '../../types';

interface SchedulerButtonProps {
  onScanComplete?: () => void;
}

function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return 'Never';
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    if (diffMs < 0) return 'Just now';
    const totalSecs = Math.floor(diffMs / 1000);
    if (totalSecs < 45) return 'Just now';
    const mins = Math.floor(totalSecs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Recently';
  }
}

function formatCountdown(isoString: string | null | undefined): string {
  if (!isoString) return 'Not scheduled';
  try {
    const diffMs = new Date(isoString).getTime() - Date.now();
    if (diffMs <= 0) return 'Due now';
    const totalSecs = Math.floor(diffMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    if (mins === 0) return `in ${secs}s`;
    return `in ${mins}m ${secs.toString().padStart(2, '0')}s`;
  } catch {
    return 'Pending';
  }
}

export const SchedulerButton: React.FC<SchedulerButtonProps> = ({ onScanComplete }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isUpdatingSchedule, setIsUpdatingSchedule] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [nextCountdown, setNextCountdown] = useState<string>('...');
  const isMountedRef = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const status = await ringtraceApi.getSchedulerStatus();
      if (isMountedRef.current) {
        setScheduler(status);
        if (status.is_scan_active) {
          setIsScanning(true);
        }
      }
    } catch {
      // Gracefully ignore error
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchStatus();

    const statusInterval = setInterval(() => {
      void fetchStatus();
    }, 12000);

    return () => {
      isMountedRef.current = false;
      clearInterval(statusInterval);
    };
  }, [fetchStatus]);

  // Handle click outside to close popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Real-time second-by-second countdown
  useEffect(() => {
    const updateCountdown = () => {
      if (scheduler?.next_run_at) {
        setNextCountdown(formatCountdown(scheduler.next_run_at));
      } else if (scheduler && !scheduler.running) {
        setNextCountdown('Paused');
      } else {
        setNextCountdown('...');
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [scheduler?.next_run_at, scheduler?.running]);

  const handleManualRun = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanMessage('Initiating scan pass...');

    try {
      const receipt = await ringtraceApi.startScan();
      const targetScanId = receipt.active_scan_id || receipt.scan_id;

      if (receipt.status === 'skipped') {
        setScanMessage(`Scan in progress (${targetScanId.slice(0, 10)})...`);
      } else {
        setScanMessage('Running 9 fraud detectors...');
      }

      // Poll until completion
      const pollTimer = setInterval(async () => {
        try {
          const statusRes = await ringtraceApi.getScanStatus(targetScanId);
          if (['complete', 'completed', 'partial', 'failed', 'skipped'].includes(statusRes.status)) {
            clearInterval(pollTimer);
            if (isMountedRef.current) {
              setIsScanning(false);
              setScanMessage(null);
              void fetchStatus();
              onScanComplete?.();
            }
          }
        } catch {
          clearInterval(pollTimer);
          if (isMountedRef.current) {
            setIsScanning(false);
            setScanMessage(null);
          }
        }
      }, 1500);
    } catch (err: any) {
      if (isMountedRef.current) {
        setIsScanning(false);
        setScanMessage(err?.message || 'Scan trigger failed');
        setTimeout(() => setScanMessage(null), 4000);
      }
    }
  };

  const handleToggleScheduler = async () => {
    if (!scheduler || isUpdatingSchedule) return;
    setIsUpdatingSchedule(true);
    try {
      const status = scheduler.paused
        ? await ringtraceApi.resumeScheduler()
        : await ringtraceApi.pauseScheduler();
      setScheduler(status);
    } catch (err: any) {
      setScanMessage(err?.message || 'Could not update the scheduler');
    } finally {
      setIsUpdatingSchedule(false);
    }
  };

  const isRunning = scheduler?.running ?? false;
  const isPaused = scheduler?.paused ?? false;
  const lastScan = scheduler?.latest_scan;
  const lastRunIso = scheduler?.last_run_at || lastScan?.finished_at || null;
  const hitsFound = lastScan?.hit_count ?? lastScan?.hits_found ?? 0;
  const intervalMins = Math.round((scheduler?.interval_seconds ?? 300) / 60);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Trigger Button hidden in header */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="rt-button rt-button-sm"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.45rem',
          fontSize: '0.725rem',
          color: '#334155',
          borderColor: isOpen ? '#94A3B8' : '#E2E8F0',
          backgroundColor: isOpen ? '#F1F5F9' : '#FFFFFF',
          padding: '0.25rem 0.65rem',
        }}
        title="View automated scheduler status or trigger a manual scan"
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: isRunning && !isPaused ? '#10B981' : '#94A3B8',
            boxShadow: isRunning && !isPaused ? '0 0 5px rgba(16, 185, 129, 0.7)' : 'none',
          }}
          className={isRunning && !isPaused ? 'pulse-indicator' : ''}
        />
        <Clock size={13} color="#475569" />
        <span style={{ fontWeight: 600 }}>Scheduler</span>
        <span
          style={{
            fontSize: '0.675rem',
            color: '#64748B',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {isScanning ? 'scanning...' : nextCountdown}
        </span>
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '300px',
            maxWidth: 'calc(100vw - 32px)',
            boxSizing: 'border-box',
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
            padding: '1rem',
            zIndex: 60,
            color: '#0F172A',
            fontSize: '0.78rem',
            lineHeight: 1.5,
          }}
        >
          {/* Popover Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.75rem',
              borderBottom: '1px solid #F1F5F9',
              paddingBottom: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.85rem' }}>
              <Zap size={15} color="#0F172A" />
              <span>Detection Scheduler</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '2px' }}
              title="Close"
            >
              <X size={14} />
            </button>
          </div>

          {/* Details Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {/* Status & Interval */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748B', fontSize: '0.725rem' }}>Schedule:</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '0.1rem 0.45rem',
                  borderRadius: '4px',
                  backgroundColor: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  color: '#334155',
                }}
              >
                <span
                  style={{
                    width: '5px',
                    height: '5px',
                    borderRadius: '50%',
                    backgroundColor: isRunning ? '#10B981' : '#94A3B8',
                  }}
                />
                {isPaused ? 'Paused' : `Active (every ${intervalMins}m)`}
              </span>
            </div>

            {/* Next Run Countdown */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748B', fontSize: '0.725rem' }}>Next Run:</span>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700,
                  color: '#0F172A',
                  fontSize: '0.75rem',
                }}
              >
                  {isPaused ? 'Paused' : nextCountdown}
              </span>
            </div>

            {/* Last Runned */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748B', fontSize: '0.725rem' }}>Last Run:</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.75rem' }}>
                  {formatRelativeTime(lastRunIso)}
                </span>
                {lastScan && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.2rem',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      padding: '0.05rem 0.35rem',
                      borderRadius: '4px',
                      backgroundColor: lastScan.status === 'complete' || lastScan.status === 'partial' ? '#ECFDF5' : '#FEF2F2',
                      color: lastScan.status === 'complete' || lastScan.status === 'partial' ? '#065F46' : '#991B1B',
                    }}
                  >
                    {lastScan.status === 'complete' || lastScan.status === 'partial' ? (
                      <CheckCircle2 size={10} />
                    ) : (
                      <AlertCircle size={10} />
                    )}
                    <span style={{ textTransform: 'capitalize' }}>{lastScan.status}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Hits Summary if available */}
            {lastScan && hitsFound > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px dashed #E2E8F0', paddingTop: '0.45rem' }}>
                <span style={{ color: '#64748B', fontSize: '0.7rem' }}>Evidence Uncovered:</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.725rem', color: '#0F172A', fontWeight: 600 }}>
                  {hitsFound} hits • {lastScan.case_count || 0} cases
                </span>
              </div>
            )}

            {/* Scan Progress / Status Message */}
            {scanMessage && (
              <div
                style={{
                  fontSize: '0.7rem',
                  color: '#2563EB',
                  backgroundColor: '#EFF6FF',
                  padding: '0.35rem 0.5rem',
                  borderRadius: '4px',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {scanMessage}
              </div>
            )}

            {/* Manual Run Action Button */}
            <div style={{ marginTop: '0.45rem', paddingTop: '0.65rem', borderTop: '1px solid #F1F5F9' }}>
              <button
                onClick={() => void handleToggleScheduler()}
                disabled={!isRunning || isUpdatingSchedule}
                className="rt-button"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.45rem 0.75rem',
                  marginBottom: '0.45rem',
                }}
              >
                {isPaused ? <Play size={12} fill="currentColor" /> : <Pause size={12} />}
                <span>{isPaused ? 'Resume Automatic Scans' : 'Pause Automatic Scans'}</span>
              </button>
              <button
                onClick={handleManualRun}
                disabled={isScanning || scheduler?.is_scan_active}
                className="rt-button rt-button-primary"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.45rem 0.75rem',
                }}
                title="Execute manual detection pass across all 9 graph patterns immediately"
              >
                {isScanning || scheduler?.is_scan_active ? (
                  <>
                    <RotateCcw size={13} className="spin" />
                    <span>Executing 9 Detectors...</span>
                  </>
                ) : (
                  <>
                    <Play size={12} fill="currentColor" />
                    <span>Run Scan Now</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
