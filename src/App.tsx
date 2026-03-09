import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, Clock, History, TrendingUp, Zap, AlertCircle, RefreshCw } from 'lucide-react';

interface HistoryItem {
  period: string;
  number: number;
  size: 'BIG' | 'SMALL';
}

export default function App() {
  const [timeLeft, setTimeLeft] = useState(30);
  const [currentPeriod, setCurrentPeriod] = useState('');
  const [prediction, setPrediction] = useState<{ 
    size: 'BIG' | 'SMALL' | 'WAITING' | 'ANALYZING', 
    numbers: number[],
    confidence?: number,
    analysis?: string[]
  }>({
    size: 'WAITING',
    numbers: []
  });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isNewResult, setIsNewResult] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualId, setManualId] = useState('20260309100052425');
  const [isManualMode, setIsManualMode] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [manualHistory, setManualHistory] = useState<{id: string, size: string, number: number}[]>([]);
  
  const lastPeriodRef = useRef<string>('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (prediction.size === 'ANALYZING') {
      scrollToBottom();
    }
  }, [prediction.analysis]);

  const handleManualPredict = () => {
    if (manualId.length < 5) return;
    
    setPrediction({ size: 'ANALYZING', numbers: [], analysis: [] });
    setAnalysisStep(0);
    
    const eventSource = new EventSource(`/api/predict-stream?periodId=${manualId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        
        if (payload.type === 'log') {
          setPrediction(prev => ({
            ...prev,
            analysis: [...(prev.analysis || []), payload.message]
          }));
          setAnalysisStep(prev => prev + 1);
        } else if (payload.type === 'result') {
          setPrediction(prev => ({
            ...prev,
            ...payload.data
          }));
          
          // Add to manual history
          setManualHistory(prev => [{
            id: manualId,
            size: payload.data.size,
            number: payload.data.numbers[0]
          }, ...prev].slice(0, 10));
          
          eventSource.close();
        }
      } catch (e) {
        console.error("Failed to parse SSE data:", event.data);
      }
    };

    eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      setError("Analysis stream interrupted.");
      setPrediction({ size: 'WAITING', numbers: [] });
      eventSource.close();
    };
  };

  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    let socket: WebSocket;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      setConnectionStatus('connecting');
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log('[WS] Connected to server');
        setConnectionStatus('connected');
        setIsLoading(false);
        setError(null);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'GAME_STATE') {
            setTimeLeft(message.timeLeft);
            setCurrentPeriod(message.currentPeriod);
            
            if (message.currentPeriod !== lastPeriodRef.current) {
              if (lastPeriodRef.current !== '') {
                setIsNewResult(true);
                setTimeout(() => setIsNewResult(false), 3000);
              }
              lastPeriodRef.current = message.currentPeriod;
            }
          } else if (message.type === 'HISTORY') {
            setHistory(message.data);
          }
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };

      socket.onerror = (err) => {
        console.error('[WS] Error:', err);
        setConnectionStatus('disconnected');
        setError('Connection error. Retrying...');
      };

      socket.onclose = () => {
        console.log('[WS] Disconnected');
        setConnectionStatus('disconnected');
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (socket) socket.close();
      clearTimeout(reconnectTimeout);
    };
  }, []);

  // Generate prediction when 15 seconds remain using streaming logs
  useEffect(() => {
    const startAutomaticStream = () => {
      setPrediction({ size: 'ANALYZING', numbers: [], analysis: [] });
      
      const eventSource = new EventSource(`/api/predict-stream?periodId=${currentPeriod}`);
      
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload.type === 'log') {
            setPrediction(prev => ({
              ...prev,
              analysis: [...(prev.analysis || []), payload.message]
            }));
          } else if (payload.type === 'result') {
            setPrediction(prev => ({
              ...prev,
              ...payload.data
            }));
            eventSource.close();
          }
        } catch (e) {
          console.error("Failed to parse automatic SSE data:", event.data);
        }
      };

      eventSource.onerror = (err) => {
        console.error("Automatic EventSource failed:", err);
        eventSource.close();
      };
    };

    if (timeLeft === 15 && !isManualMode) {
      startAutomaticStream();
    } else if (timeLeft > 15 || timeLeft <= 1) {
      // Reset prediction state for next round
      if (timeLeft <= 1) {
        setPrediction({ size: 'ANALYZING', numbers: [] });
      } else if (timeLeft > 25) {
        setPrediction({ size: 'WAITING', numbers: [] });
      }
    }
  }, [timeLeft, currentPeriod, isManualMode]);

  const formatTime = (seconds: number) => {
    return `00:${seconds.toString().padStart(2, '0')}`;
  };

  if (isLoading && !error) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-[#00d2ff] animate-spin mx-auto mb-4" />
          <p className="text-[#8b949e] text-xs uppercase tracking-widest">Connecting to Live Server...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-white font-sans flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Error Banner */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-[#ff4d4d]/10 border border-[#ff4d4d]/20 rounded-xl p-3 mb-4 flex items-center gap-2 text-[#ff4d4d] text-xs"
            >
              <AlertCircle className="w-4 h-4" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Card */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6 shadow-2xl relative overflow-hidden">
          {/* Decorative background glow */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#00d2ff] opacity-5 blur-[100px] pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-[#3a7bd5] opacity-5 blur-[100px] pointer-events-none" />

          {/* Header */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#f0b90b]" fill="#f0b90b" />
                RAJA WAGER
              </h1>
              <p className="text-[#8b949e] text-xs mt-1 flex items-center gap-1">
                <Activity className="w-3 h-3 text-[#0ecb81]" />
                LIVE AI PREDICTOR 2026
              </p>
            </div>
            <div className="px-2 py-1 rounded-full border border-[#0ecb81]/30 bg-[#0ecb81]/10 text-[#0ecb81] text-[10px] font-bold flex items-center gap-1 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81]" />
              LIVE SERVER
            </div>
          </div>

          {/* Period & Timer */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${
                connectionStatus === 'connected' ? 'bg-[#0ecb81]/10 border-[#0ecb81]/20 text-[#0ecb81]' :
                connectionStatus === 'connecting' ? 'bg-[#f0b90b]/10 border-[#f0b90b]/20 text-[#f0b90b]' :
                'bg-[#ff4d4d]/10 border-[#ff4d4d]/20 text-[#ff4d4d]'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-[#0ecb81] animate-pulse' :
                  connectionStatus === 'connecting' ? 'bg-[#f0b90b] animate-bounce' :
                  'bg-[#ff4d4d]'
                }`} />
                <span className="text-[10px] font-black uppercase tracking-tighter">
                  {connectionStatus === 'connected' ? 'Live Server' : 
                   connectionStatus === 'connecting' ? 'Connecting...' : 'Offline'}
                </span>
              </div>
              <div className="h-3 w-[1px] bg-white/10" />
              <div className="flex items-center gap-1 text-[#8b949e] text-[10px] font-bold uppercase tracking-widest">
                <div className="w-1 h-1 bg-[#f0b90b] rounded-full" />
                30s Wingo
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 text-[#8b949e] text-sm mb-2">
              <Clock className="w-4 h-4" />
              <span>Period: <span className="text-white font-mono tracking-tight">{currentPeriod}</span></span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(currentPeriod);
                }}
                className="p-1 hover:bg-white/5 rounded transition-colors"
                title="Copy Period ID"
              >
                <History className="w-3 h-3" />
              </button>
            </div>
            <div className="relative inline-block">
              <motion.div 
                key={timeLeft}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ 
                  scale: 1, 
                  opacity: 1,
                  color: timeLeft <= 5 ? '#ff4d4d' : '#00d2ff',
                }}
                className="text-7xl font-black font-mono tracking-tighter drop-shadow-[0_0_10px_rgba(0,210,255,0.3)]"
                style={{
                  textShadow: timeLeft <= 5 ? '0 0 25px rgba(255, 77, 77, 0.6)' : '0 0 20px rgba(0, 210, 255, 0.2)'
                }}
              >
                {formatTime(timeLeft)}
              </motion.div>
              
              {timeLeft <= 5 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="absolute -inset-4 border-2 border-[#ff4d4d]/30 rounded-xl pointer-events-none"
                />
              )}
            </div>
            
            {timeLeft <= 5 && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[#ff4d4d] text-[10px] font-black uppercase tracking-[0.4em] mt-2 animate-pulse"
              >
                Time Over Soon
              </motion.div>
            )}
          </div>

          {/* Manual Input Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <button 
                onClick={() => setIsManualMode(!isManualMode)}
                className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full transition-colors ${
                  isManualMode ? 'bg-[#f0b90b] text-[#0d1117]' : 'bg-white/5 text-[#8b949e] border border-white/10'
                }`}
              >
                {isManualMode ? 'Manual Mode Active' : 'Switch to Manual Mode'}
              </button>
            </div>

            <AnimatePresence>
              {isManualMode && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex gap-2 mb-4">
                    <input 
                      type="text"
                      value={manualId}
                      onChange={(e) => setManualId(e.target.value)}
                      placeholder="Enter Period ID..."
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[#f0b90b] transition-colors font-mono"
                    />
                    <button 
                      onClick={handleManualPredict}
                      disabled={manualId.length < 5}
                      className="bg-[#f0b90b] text-[#0d1117] px-4 py-2 rounded-lg font-bold text-sm hover:bg-[#f0b90b]/90 disabled:opacity-50 transition-colors"
                    >
                      Predict
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Recent Manual Checks */}
          <AnimatePresence>
            {isManualMode && manualHistory.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-6 overflow-hidden bg-white/5 border border-white/10 rounded-xl p-4"
              >
                <div className="text-[10px] text-[#8b949e] uppercase tracking-widest font-bold mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-3 h-3" />
                    Manual Prediction History
                  </div>
                  <span className="text-[8px] opacity-50">{manualHistory.length}/10</span>
                </div>
                <div className="max-h-[120px] overflow-y-auto pr-2 space-y-2 scrollbar-thin scrollbar-thumb-white/10">
                  {manualHistory.map((item, i) => (
                    <motion.div 
                      initial={{ x: -10, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      key={i} 
                      className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 border border-white/5"
                    >
                      <div className="flex flex-col">
                        <span className="text-[9px] text-[#8b949e] font-mono">ID: {item.id}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-xs font-black ${item.size === 'BIG' ? 'text-[#ff4d4d]' : 'text-[#0ecb81]'}`}>
                          {item.size}
                        </span>
                        <div className="w-6 h-6 rounded-full bg-[#f0b90b]/10 border border-[#f0b90b]/20 flex items-center justify-center">
                          <span className="text-xs font-bold text-[#f0b90b]">{item.number}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Prediction Box */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-8 relative">
            <div className="text-[10px] text-[#8b949e] uppercase tracking-widest font-bold mb-4 flex items-center gap-2">
              <TrendingUp className="w-3 h-3" />
              AI Analysis Result
            </div>
            
            <AnimatePresence mode="wait">
              <motion.div
                key={prediction.size}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                className="flex flex-col items-center"
              >
                {prediction.size === 'ANALYZING' ? (
                  <div className="w-full h-32 overflow-y-auto space-y-2 mb-4 pr-2 scrollbar-thin scrollbar-thumb-white/10">
                    {prediction.analysis?.map((log, i) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        key={i} 
                        className="text-[10px] font-mono text-[#0ecb81] flex items-center gap-2"
                      >
                        <span className="w-1 h-1 bg-[#0ecb81] rounded-full" />
                        {log}
                      </motion.div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                ) : (
                  <>
                    <div className="relative w-full flex flex-col items-center justify-center mb-8 pt-6">
                      {/* Radial Numbers Orbit */}
                      {prediction.numbers.length > 0 && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          {prediction.numbers.map((num, idx) => {
                            // Position numbers in an arc at the top/sides
                            const angles = [-140, -90, -40];
                            const angle = angles[idx];
                            const radius = 85;
                            const x = Math.cos(angle * Math.PI / 180) * radius;
                            const y = Math.sin(angle * Math.PI / 180) * radius;
                            
                            return (
                              <motion.div
                                key={num}
                                initial={{ scale: 0, x: 0, y: 0, opacity: 0 }}
                                animate={{ 
                                  scale: 1, 
                                  x, 
                                  y, 
                                  opacity: 1,
                                  rotate: [0, 5, -5, 0]
                                }}
                                transition={{ 
                                  delay: 0.5 + (idx * 0.2), 
                                  type: 'spring',
                                  rotate: {
                                    repeat: Infinity,
                                    duration: 4,
                                    ease: "easeInOut"
                                  }
                                }}
                                className="absolute w-11 h-11 rounded-full bg-gradient-to-br from-[#f0b90b] to-[#d4a017] text-[#0d1117] flex items-center justify-center font-black text-xl shadow-[0_0_20px_rgba(240,185,11,0.3)] border-2 border-white/20"
                              >
                                {num}
                                <div className="absolute -inset-1 rounded-full border border-[#f0b90b]/30 animate-ping opacity-20" />
                              </motion.div>
                            );
                          })}
                        </div>
                      )}

                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className={`text-6xl font-black tracking-tighter mb-2 drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                          prediction.size === 'BIG' ? 'text-[#ff4d4d]' : 
                          prediction.size === 'SMALL' ? 'text-[#0ecb81]' : 
                          'text-[#8b949e]'
                        }`}
                      >
                        {prediction.size}
                      </motion.div>
                      
                      <div className="text-[10px] font-bold text-[#8b949e] uppercase tracking-[0.3em] mt-1">
                        Primary Trend
                      </div>
                    </div>

                    {prediction.confidence && (
                      <div className="w-full max-w-[240px] mb-6">
                        <div className="flex justify-between items-end mb-1.5">
                          <span className="text-[10px] font-bold text-[#8b949e] uppercase tracking-widest">AI Confidence Level</span>
                          <span className={`text-sm font-black tracking-tighter ${
                            prediction.confidence >= 90 ? 'text-[#0ecb81]' : 
                            prediction.confidence >= 80 ? 'text-[#f0b90b]' : 
                            'text-[#ff4d4d]'
                          }`}>
                            {prediction.confidence}%
                          </span>
                        </div>
                        <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/10 p-[1px]">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${prediction.confidence}%` }}
                            transition={{ duration: 1.5, ease: "circOut" }}
                            className={`h-full rounded-full relative ${
                              prediction.confidence >= 90 ? 'bg-gradient-to-r from-[#0ecb81]/50 to-[#0ecb81]' : 
                              prediction.confidence >= 80 ? 'bg-gradient-to-r from-[#f0b90b]/50 to-[#f0b90b]' : 
                              'bg-gradient-to-r from-[#ff4d4d]/50 to-[#ff4d4d]'
                            }`}
                          >
                            <div className="absolute inset-0 bg-white/20 animate-pulse" />
                          </motion.div>
                        </div>
                        <div className="flex justify-between mt-1 px-0.5">
                          <span className="text-[8px] text-[#8b949e] font-bold">LOW</span>
                          <span className="text-[8px] text-[#8b949e] font-bold">OPTIMAL</span>
                          <span className="text-[8px] text-[#8b949e] font-bold">HIGH</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                
                {prediction.size === 'WAITING' && (
                  <div className="flex items-center gap-2 text-[#8b949e] text-xs italic">
                    <Clock className="w-3 h-3 animate-spin" />
                    Calculating trend...
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* History Section */}
          <div>
            <div className="flex items-center gap-2 text-[#8b949e] text-xs font-bold uppercase tracking-wider mb-4">
              <History className="w-3 h-3" />
              Recent History
            </div>
            
            <div className="space-y-2">
              <div className="grid grid-cols-3 text-[10px] text-[#8b949e] px-2 mb-1">
                <span>PERIOD</span>
                <span className="text-center">NUMBER</span>
                <span className="text-right">RESULT</span>
              </div>
              
              <AnimatePresence initial={false}>
                {history.length === 0 ? (
                  <div className="text-center py-4 text-[#8b949e] text-xs border border-dashed border-[#30363d] rounded-lg">
                    Waiting for first result...
                  </div>
                ) : (
                  history.map((item, index) => (
                    <motion.div
                      initial={{ x: -20, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      key={item.period}
                      className={`grid grid-cols-3 items-center p-3 rounded-lg border border-[#30363d] bg-[#1c2128] ${index === 0 && isNewResult ? 'border-[#f0b90b] bg-[#f0b90b]/5' : ''}`}
                    >
                      <span className="text-xs font-mono text-[#8b949e]">{item.period.slice(-4)}</span>
                      <span className="text-center font-bold text-[#f0b90b]">{item.number}</span>
                      <span className={`text-right text-xs font-black ${item.size === 'BIG' ? 'text-[#ff4d4d]' : 'text-[#0ecb81]'}`}>
                        {item.size}
                      </span>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Footer Warning */}
          <div className="mt-8 flex items-start gap-2 p-3 rounded-lg bg-[#ff4d4d]/5 border border-[#ff4d4d]/10">
            <AlertCircle className="w-4 h-4 text-[#ff4d4d] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[#8b949e] leading-relaxed">
              AI predictions are based on statistical trends. Play responsibly. This tool does not guarantee 100% accuracy.
            </p>
          </div>
        </div>

        {/* Bottom Info */}
        <div className="mt-6 text-center">
          <p className="text-[#8b949e] text-[10px] uppercase tracking-[0.2em]">
            Powered by Raja Wager AI Engine v4.0
          </p>
        </div>
      </div>
    </div>
  );
}
