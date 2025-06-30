import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Phone, PhoneOff } from 'lucide-react';

const GeminiAudioChat = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [logs, setLogs] = useState([]);
  const [audioQueueLength, setAudioQueueLength] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [emotionDetectionEnabled, setEmotionDetectionEnabled] = useState(false);
  const [cameraPermission, setCameraPermission] = useState(null); // null, true, false
  const [emotionWs, setEmotionWs] = useState(null);
  const [inputTranscript, setInputTranscript] = useState('');
  const [outputTranscript, setOutputTranscript] = useState('');
  // Accumulators for current turn (use refs for reliability)
  const currentInputTranscriptRef = useRef('');
  const currentOutputTranscriptRef = useRef('');

  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const streamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentAudioSourceRef = useRef(null);
  const recordingTimeoutRef = useRef(null);
  const audioContextReadyRef = useRef(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const [emotion, setEmotion] = useState({ current: '', aggregated: '' });

  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-50), { timestamp, message, type }]);
  }, []);

  const updateAudioQueueState = () => {
    setAudioQueueLength(audioQueueRef.current.length);
    setIsPlaying(isPlayingRef.current);
  };

  const initializeAudioContext = async () => {
    if (audioContextReadyRef.current) return;
    
    try {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000,
        latencyHint: 'interactive' // Optimize for low latency
      });
      
      // Resume immediately if suspended
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      audioContextReadyRef.current = true;
      addLog(`Audio context ready (${audioContextRef.current.sampleRate}Hz)`, 'success');
    } catch (error) {
      addLog(`Audio context error: ${error.message}`, 'error');
    }
  };

  // Optimized PCM conversion - removed logging overhead
  const convertPCMToBase64 = (pcmData) => {
    const int16Array = new Int16Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      int16Array[i] = Math.round(Math.max(-1, Math.min(1, pcmData[i])) * 32767);
    }
    
    const uint8Array = new Uint8Array(int16Array.buffer);
    let binary = '';
    const chunkSize = 8192;
    
    // Process in chunks for better performance
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    
    return btoa(binary);
  };

  const isPCMFormat = (mimeType) => {
    return mimeType && (mimeType.startsWith('audio/pcm') || mimeType.includes('pcm'));
  };

  const playAudioChunk = async (audioData, mimeType) => {
    console.log('[playAudioChunk] called', { audioDataLength: audioData ? audioData.length : 0, mimeType, isMuted });
    if (!audioContextRef.current || isMuted) {
      console.log('[playAudioChunk] Skipping playback: audioContextRef.current missing or muted');
      isPlayingRef.current = false;
      updateAudioQueueState();
      playNextAudio(); // Continue queue without delay
      return;
    }
    try {
      // Quick context resume if needed
      if (audioContextRef.current.state === 'suspended') {
        console.log('[playAudioChunk] AudioContext suspended, resuming...');
        await audioContextRef.current.resume();
      }
      console.log('[playAudioChunk] AudioContext state:', audioContextRef.current.state);
      let audioBuffer;
      if (isPCMFormat(mimeType)) {
        // Optimized PCM processing
        const binaryString = atob(audioData);
        const uint8Array = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          uint8Array[i] = binaryString.charCodeAt(i);
        }
        const int16Array = new Int16Array(uint8Array.buffer);
        const sampleCount = int16Array.length;
        const sampleRate = 24000;
        audioBuffer = audioContextRef.current.createBuffer(1, sampleCount, sampleRate);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16Array.length; i++) {
          channelData[i] = int16Array[i] / 32768.0;
        }
        console.log('[playAudioChunk] PCM buffer created', { sampleCount, sampleRate });
      } else {
        // Standard audio decoding
        const binaryString = atob(audioData);
        const arrayBuffer = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          arrayBuffer[i] = binaryString.charCodeAt(i);
        }
        audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer.buffer);
        console.log('[playAudioChunk] Decoded audioBuffer', { duration: audioBuffer.duration });
      }
      // Create source with minimal overhead
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      currentAudioSourceRef.current = source;
      source.onended = () => {
        console.log('[playAudioChunk] Playback ended');
        isPlayingRef.current = false;
        currentAudioSourceRef.current = null;
        updateAudioQueueState();
        playNextAudio(); // Continue immediately
      };
      // Start playback
      isPlayingRef.current = true;
      updateAudioQueueState();
      console.log('[playAudioChunk] Starting playback');
      source.start(0);
      addLog(`Playing audio (${audioBuffer.duration.toFixed(2)}s)`, 'success');
    } catch (error) {
      console.error('[playAudioChunk] Audio error:', error);
      addLog(`Audio error: ${error.message}`, 'error');
      isPlayingRef.current = false;
      currentAudioSourceRef.current = null;
      updateAudioQueueState();
      playNextAudio(); // Continue on error
    }
  };

  const playNextAudio = () => {
    if (audioQueueRef.current.length > 0 && !isPlayingRef.current) {
      const nextAudio = audioQueueRef.current.shift();
      updateAudioQueueState();
      playAudioChunk(nextAudio.data, nextAudio.mimeType);
    } else {
      updateAudioQueueState();
    }
  };

  const queueAudio = (audioData, mimeType) => {
    audioQueueRef.current.push({ data: audioData, mimeType });
    updateAudioQueueState();
    
    if (!isPlayingRef.current) {
      playNextAudio(); // Start immediately
    }
  };

  const stopCurrentAudio = () => {
    if (currentAudioSourceRef.current) {
      try {
        currentAudioSourceRef.current.stop();
      } catch (error) {
        // Ignore stop errors
      }
    }
    isPlayingRef.current = false;
    currentAudioSourceRef.current = null;
    updateAudioQueueState();
  };

  const clearAudioQueue = () => {
    audioQueueRef.current = [];
    stopCurrentAudio();
    addLog('Audio queue cleared', 'info');
    updateAudioQueueState();
  };

  const connectToBackend = async () => {
    try {
      setConnectionStatus('connecting');
      addLog('Connecting to backend...', 'info');
      
      // Ensure audio context is ready
      await initializeAudioContext();
      
      const wsUrl = 'ws://localhost:8000/audio';
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('connected');
        addLog('Connected successfully', 'success');
        
        const config = {
          type: 'setup',
          config: {
            model: 'models/gemini-2.5-flash-preview-native-audio-dialog',
            response_modalities: ['AUDIO'],
            voice_name: 'Puck'
          }
        };
        wsRef.current.send(JSON.stringify(config));
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WebSocket message]', data); // Log all incoming messages
          switch (data.type) {
            case 'audio':
              if (data.audio_data && !isMuted) {
                queueAudio(data.audio_data, data.mime_type || 'audio/pcm');
              }
              break;
            case 'transcript':
              console.log('[transcript] Gemini:', data.text);
              addLog(`Gemini: ${data.text}`, 'ai-response');
              break;
            case 'user_transcript':
              console.log('[user_transcript] You:', data.text);
              addLog(`You: ${data.text}`, 'user-input');
              break;
            case 'input_transcription':
              // Accumulate input transcription chunks
              currentInputTranscriptRef.current += (data.text || '');
              console.log('[input_transcription chunk]', data.text, '| Accumulated:', currentInputTranscriptRef.current);
              // If this is the last chunk (data.final or data.is_final), finalize
              if (data.final || data.is_final) {
                setInputTranscript(currentInputTranscriptRef.current);
                analyzeDistressScore(currentInputTranscriptRef.current); // Analyze in parallel
                currentInputTranscriptRef.current = '';
                console.log('[input_transcription] Finalized:', inputTranscript);
              }
              break;
            case 'output_transcription':
              // Accumulate output transcription chunks
              currentOutputTranscriptRef.current += (data.text || '');
              console.log('[output_transcription chunk]', data.text, '| Accumulated:', currentOutputTranscriptRef.current);
              // If this is the last chunk (data.final or data.is_final), finalize
              if (data.final || data.is_final) {
                setOutputTranscript(currentOutputTranscriptRef.current);
                currentOutputTranscriptRef.current = '';
                console.log('[output_transcription] Finalized:', outputTranscript);
              }
              break;
            case 'info':
              console.log('[info]', data.message);
              addLog(data.message, 'info');
              break;
            case 'turnComplete':
              // On turnComplete, finalize any remaining accumulated transcripts
              if (currentInputTranscriptRef.current) {
                setInputTranscript(currentInputTranscriptRef.current);
                analyzeDistressScore(currentInputTranscriptRef.current); // Analyze in parallel
                currentInputTranscriptRef.current = '';
                console.log('[turnComplete] Finalizing input transcript:', currentInputTranscriptRef.current);
              }
              if (currentOutputTranscriptRef.current) {
                setOutputTranscript(currentOutputTranscriptRef.current);
                console.log('[turnComplete] Finalizing output transcript:', currentOutputTranscriptRef.current);
                currentOutputTranscriptRef.current = '';
              }
              addLog(`[turnComplete event] Finalizing transcripts`, 'success');
              break;
            case 'error':
              console.error('[error]', data.message);
              addLog(`Error: ${data.message}`, 'error');
              break;
            default:
              console.log('[unhandled message type]', data);
              break;
          }
        } catch (error) {
          console.error('[Message parsing error]', error);
          addLog(`Message parsing error: ${error.message}`, 'error');
        }
      };
      
      wsRef.current.onerror = (error) => {
        addLog(`WebSocket error`, 'error');
        setConnectionStatus('error');
      };
      
      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setConnectionStatus('disconnected');
        addLog(`Disconnected: ${event.reason || 'Connection closed'}`, 'warning');
        clearAudioQueue();
      };
      
    } catch (error) {
      addLog(`Connection error: ${error.message}`, 'error');
      setConnectionStatus('error');
    }
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    if (isRecording) {
      stopRecording();
    }
    
    clearAudioQueue();
  };

  const startRecording = async () => {
    currentInputTranscriptRef.current = '';
    currentOutputTranscriptRef.current = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      streamRef.current = stream;
      
      const inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
      
      const source = inputAudioContext.createMediaStreamSource(stream);
      const processor = inputAudioContext.createScriptProcessor(4096, 1, 1);
      
      audioChunksRef.current = [];
      
      processor.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        audioChunksRef.current.push(new Float32Array(channelData));
      };
      
      source.connect(processor);
      processor.connect(inputAudioContext.destination);
      
      audioProcessorRef.current = {
        context: inputAudioContext,
        processor: processor,
        source: source
      };
      
      setIsRecording(true);
      addLog('Recording started (16kHz)', 'success');
      
      // Auto-stop after 5 seconds
      recordingTimeoutRef.current = setTimeout(() => {
        if (isRecording) {
          stopRecording();
        }
      }, 5000);
      
    } catch (error) {
      addLog(`Recording error: ${error.message}`, 'error');
    }
  };

  // --- Emotion capture logic (real backend integration) ---
  useEffect(() => {
    let interval = null;
    let ws = null;
    if (!emotionDetectionEnabled) {
      // Stop webcam if running
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(track => track.stop());
        webcamStreamRef.current = null;
      }
      setEmotion((prev) => ({ ...prev, aggregated: '' }));
      if (emotionWs) {
        emotionWs.close();
        setEmotionWs(null);
      }
      return;
    }
    // Start webcam
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        setCameraPermission(true);
        webcamStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        // Open emotion WebSocket
        ws = new WebSocket('ws://localhost:8000/');
        setEmotionWs(ws);
        ws.onopen = () => {
          // Send setup message if needed by backend
          ws.send(JSON.stringify({ setup: { mode: 'emotion' } }));
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.emotion) {
              setEmotion(data.emotion);
            }
          } catch (e) {}
        };
        ws.onerror = (e) => {
          setCameraPermission(false);
        };
        ws.onclose = () => {
          setEmotionWs(null);
        };
        interval = setInterval(() => {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (canvas && video && ws && ws.readyState === WebSocket.OPEN) {
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64data = reader.result.split(',')[1];
                ws.send(JSON.stringify({ frame: base64data }));
              };
              reader.readAsDataURL(blob);
            }, 'image/jpeg', 0.8);
          }
        }, 1000);
      })
      .catch((err) => {
        setCameraPermission(false);
        setEmotion((prev) => ({ ...prev, aggregated: '' }));
        if (ws) ws.close();
        console.error('Error accessing webcam:', err);
      });
    // Cleanup on unmount or disable
    return () => {
      if (interval) clearInterval(interval);
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(track => track.stop());
        webcamStreamRef.current = null;
      }
      if (ws) ws.close();
      setEmotionWs(null);
    };
  }, [emotionDetectionEnabled]);

  // --- TTS to PCM using Web Audio API ---
  const synthesizeEmotionPCM = async (emotionText) => {
    return new Promise((resolve, reject) => {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const utter = new window.SpeechSynthesisUtterance(emotionText);
        utter.lang = 'en-US';
        let dest = audioCtx.createMediaStreamDestination();
        utter.onend = async () => {
          // Record the TTS output
          const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
          let chunks = [];
          recorder.ondataavailable = (e) => chunks.push(e.data);
          recorder.onstop = async () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            // Decode to PCM
            let audioBuffer;
            try {
              audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            } catch (e) {
              resolve(null); // decoding failed
              return;
            }
            // Resample to 16kHz mono if needed
            let pcm = audioBuffer.getChannelData(0);
            if (audioBuffer.sampleRate !== 16000) {
              // Simple resample (linear interpolation)
              const ratio = audioBuffer.sampleRate / 16000;
              const newLength = Math.floor(pcm.length / ratio);
              const resampled = new Float32Array(newLength);
              for (let i = 0; i < newLength; i++) {
                const idx = i * ratio;
                const idxLow = Math.floor(idx);
                const idxHigh = Math.min(Math.ceil(idx), pcm.length - 1);
                const weight = idx - idxLow;
                resampled[i] = (1 - weight) * pcm[idxLow] + weight * pcm[idxHigh];
              }
              pcm = resampled;
            }
            resolve(new Float32Array(pcm));
          };
          recorder.start();
          setTimeout(() => recorder.stop(), 1000); // Record for 1s (adjust as needed)
        };
        window.speechSynthesis.speak(utter);
      } catch (err) {
        reject(err);
      }
    });
  };

  const stopRecording = async () => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.processor.disconnect();
        audioProcessorRef.current.source.disconnect();
        audioProcessorRef.current.context.close();
      } catch (error) {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    if (audioChunksRef.current.length > 0) {
      let totalSamples = 0;
      audioChunksRef.current.forEach(chunk => { totalSamples += chunk.length; });
      const combinedPCM = new Float32Array(totalSamples);
      let offset = 0;
      audioChunksRef.current.forEach(chunk => { combinedPCM.set(chunk, offset); offset += chunk.length; });
      // Synthesize emotion TTS to PCM and prepend
      let emotionText = '';
      if (emotionDetectionEnabled && emotion.aggregated) {
        emotionText = `The user's emotion is: ${emotion.aggregated}`;
      }
      let ttsPCM = null;
      try {
        if (emotionText) {
          ttsPCM = await synthesizeEmotionPCM(emotionText);
        }
      } catch (err) {
        addLog('TTS error, sending only user audio', 'error');
      }
      let finalPCM;
      if (ttsPCM && ttsPCM.length > 0 && !isNaN(ttsPCM[0])) {
        finalPCM = new Float32Array(ttsPCM.length + combinedPCM.length);
        finalPCM.set(ttsPCM, 0);
        finalPCM.set(combinedPCM, ttsPCM.length);
      } else {
        finalPCM = combinedPCM;
      }
      const base64Data = convertPCMToBase64(finalPCM);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const message = {
          type: 'audio_input',
          audio_data: base64Data,
          emotion: emotionDetectionEnabled ? emotion.aggregated : '',
          format: 'pcm',
          sample_rate: 16000,
          channels: 1,
          bits_per_sample: 16
        };
        wsRef.current.send(JSON.stringify(message));
        addLog(`Audio sent (${(finalPCM.length / 16000).toFixed(2)}s) with emotion: ${emotionDetectionEnabled ? emotion.aggregated : 'none'}`, 'user-input');
      }
    }
    audioChunksRef.current = [];
    audioProcessorRef.current = null;
  };

  // Analyze distress score using Gemini API (runs in parallel)
  const analyzeDistressScore = async (inputText) => {
    if (!inputText || inputText.trim() === '') return;
    try {
      addLog('Analyzing distress score...', 'info');
      // Replace this URL with your actual Gemini text API endpoint
      const response = await fetch('/api/distress-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText })
      });
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      addLog(`Distress score: ${data.score}`, 'warning');
    } catch (err) {
      addLog('Distress score analysis failed', 'error');
    }
  };

  const toggleMute = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    addLog(`Audio ${newMutedState ? 'muted' : 'unmuted'}`, 'info');
    
    if (newMutedState && isPlayingRef.current) {
      stopCurrentAudio();
    }
  };

  const handleUserInteraction = async () => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  };

  useEffect(() => {
    initializeAudioContext();
    
    document.addEventListener('click', handleUserInteraction);
    document.addEventListener('keydown', handleUserInteraction);
    
    return () => {
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
      
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      
      if (audioProcessorRef.current) {
        try {
          audioProcessorRef.current.processor.disconnect();
          audioProcessorRef.current.source.disconnect();
          audioProcessorRef.current.context.close();
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      if (wsRef.current) {
        wsRef.current.close();
      }
      
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      
      clearAudioQueue();
    };
  }, []);

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-600';
      case 'connecting': return 'text-yellow-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getLogTypeColor = (type) => {
    switch (type) {
      case 'success': return 'text-green-600';
      case 'error': return 'text-red-600';
      case 'warning': return 'text-yellow-600';
      case 'ai-response': return 'text-blue-600 font-medium';
      case 'user-input': return 'text-purple-600 font-medium';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white shadow-lg rounded-lg">
      {/* Display input/output transcriptions */}
      <div className="mb-4">
        {inputTranscript && (
          <div className="text-purple-700 text-sm mb-1">
            <b>Your last input (transcribed):</b> {inputTranscript}
          </div>
        )}
        {outputTranscript && (
          <div className="text-blue-700 text-sm mb-1">
            <b>Gemini's last output (transcribed):</b> {outputTranscript}
          </div>
        )}
      </div>

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Gemini Audio Chat</h1>
        <div className="flex items-center gap-4 mb-4">
          <div className={`text-sm font-medium ${getStatusColor()}`}>
            Status: {connectionStatus}
          </div>
          {audioQueueLength > 0 && (
            <div className="text-sm text-blue-600">
              Queue: {audioQueueLength} audio chunks
            </div>
          )}
          {isPlaying && (
            <div className="text-sm text-green-600 animate-pulse">
              ♪ Playing audio
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3 mb-6 flex-wrap">
        {!isConnected ? (
          <button
            onClick={connectToBackend}
            disabled={connectionStatus === 'connecting'}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Phone size={20} />
            {connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <PhoneOff size={20} />
            Disconnect
          </button>
        )}

        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!isConnected}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isRecording
              ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>

        <button
          onClick={toggleMute}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            isMuted
              ? 'bg-gray-600 text-white hover:bg-gray-700'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
        >
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          {isMuted ? 'Unmute' : 'Mute'}
        </button>

        <button
          onClick={() => setEmotionDetectionEnabled((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${emotionDetectionEnabled ? 'bg-yellow-600 text-white hover:bg-yellow-700' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
        >
          {emotionDetectionEnabled ? 'Disable Emotion Detection' : 'Enable Emotion Detection'}
        </button>
        {emotionDetectionEnabled && cameraPermission === false && (
          <span className="text-red-600 text-sm ml-2">Camera permission denied</span>
        )}
        {emotionDetectionEnabled && cameraPermission === true && (
          <span className="text-green-600 text-sm ml-2">Emotion detection active</span>
        )}

        {audioQueueLength > 0 && (
          <button
            onClick={clearAudioQueue}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
          >
            Clear Queue
          </button>
        )}
      </div>

      <div className="bg-gray-50 border rounded-lg p-4 h-96 overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-700 mb-3">Activity Log</h2>
        <div className="space-y-1">
          {logs.map((log, index) => (
            <div key={index} className="text-sm">
              <span className="text-gray-500">[{log.timestamp}]</span>
              <span className={`ml-2 ${getLogTypeColor(log.type)}`}>
                {log.message}
              </span>
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-gray-500 text-sm italic">
              No activity yet. Connect to start chatting!
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        <p>• Audio plays automatically when received from Gemini</p>
        <p>• Recording automatically stops after 5 seconds</p>
        <p>• Queue shows pending audio chunks for smooth playback</p>
      </div>

      <video ref={videoRef} autoPlay playsInline className="w-32 rounded shadow" style={{ display: emotionDetectionEnabled ? 'block' : 'none' }} />
      <canvas ref={canvasRef} width="224" height="224" style={{ display: 'none' }} />
    </div>
  );
};

export default GeminiAudioChat;