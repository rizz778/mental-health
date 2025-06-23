import React, { useState, useEffect, useRef, useCallback } from 'react'; 

const AudioTest = () => {
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  
  // UI state
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  
  // Audio state
  const [isRecording, setIsRecording] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [vadThreshold, setVadThreshold] = useState(0.01);


  // Add this state variable
const [isProcessingAudio, setIsProcessingAudio] = useState(false);
   const [isManualRecording, setIsManualRecording] = useState(false);

  // Messages and input
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'system',
      content: 'Welcome to Live API Chat Demo! Connect to the WebSocket server and start a session to begin chatting.'
    }
  ]);
  const [messageInput, setMessageInput] = useState('');
  const [currentResponse, setCurrentResponse] = useState('');
  const currentResponseRef = useRef('');
  
  // Config
  const [systemInstruction, setSystemInstruction] = useState('');
  const [wsUrl, setWsUrl] = useState('ws://localhost:8000');
  
  // Stats
  const [totalTokens, setTotalTokens] = useState(0);
  
  // Status messages
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  
  // Audio refs
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const processorRef = useRef(null);
  const silenceTimeoutRef = useRef(null);
  const audioBufferRef = useRef([]);
  
const [audioChunks, setAudioChunks] = useState([]);
const mediaRecorderRef = useRef(null);
const streamRef = useRef(null);

  // Refs
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageIdRef = useRef(2);
  
  // Session resumption handle
  const [sessionHandle, setSessionHandle] = useState(null);
  const [resumeHandle, setResumeHandle] = useState(null);
  const [shouldReconnect, setShouldReconnect] = useState(false);
  const [isPlayingResponse,setIsPlayingResponse]=useState(false)
  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  // Add this useEffect to monitor audio state
useEffect(() => {
  console.log('[Client] Audio State:', {
    audioEnabled,
    isSpeaking,
    isRecording,
    hasActiveSession,
    pushToTalk,
    bufferLength: audioBufferRef.current?.length || 0
  });
}, [audioEnabled, isSpeaking, isRecording, hasActiveSession, pushToTalk]);
useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, currentResponse]);
  
  // Auto-hide status messages
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);
  
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);
  
  useEffect(() => {
    if (shouldReconnect && resumeHandle) {
      setShouldReconnect(false);
      setTimeout(() => {
        console.log('[Client] Triggering session reconnect with resume handle:', resumeHandle);
        connect(true);
      }, 500);
    }
  }, [shouldReconnect, resumeHandle]);
// Add this useEffect to monitor audio buffer during manual recording:
useEffect(() => {
  let intervalId;
  
  if (isManualRecording) {
    intervalId = setInterval(() => {
      console.log('[Client] Manual recording buffer status:', {
        bufferLength: audioBufferRef.current?.length || 0,
        audioEnabled,
        hasActiveSession,
        mediaStreamActive: mediaStreamRef.current?.active || false
      });
    }, 1000); // Log every second during recording
  }
  
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
    }
  };
}, [isManualRecording, audioEnabled, hasActiveSession]);
  // Voice Activity Detection
  const analyzeAudio = useCallback((audioData) => {
  // Calculate RMS (Root Mean Square) for better voice detection
  const rms = Math.sqrt(audioData.reduce((acc, val) => acc + val * val, 0) / audioData.length);
  
  // Also check for consistent energy over multiple samples
  const sum = audioData.reduce((acc, val) => acc + Math.abs(val), 0);
  const average = sum / audioData.length;
  
  // Use both RMS and average with your threshold
  const isVoice = rms > vadThreshold || average > vadThreshold * 0.5;
  
  if (isVoice) {
    console.log('[Client] Voice detected - RMS:', rms.toFixed(4), 'Avg:', average.toFixed(4));
  }
  
  return isVoice;
}, [vadThreshold]);

// Manual start recording function
// Replace your startRecording function with this:
// Replace your startRecording function with this simpler version:
const startRecording = async () => {
  try {
    console.log('[Client] Starting manual recording');
    
    // Clear any existing buffer
    audioBufferRef.current = [];
    
    // If audio is not enabled, initialize it first
    if (!audioEnabled) {
      await initializeAudio();
    }
    
    setIsManualRecording(true);
    console.log('[Client] Manual recording started - audio will be buffered');
    
  } catch (error) {
    console.error('Error starting recording:', error);
    showError('Failed to start recording: ' + error.message);
  }
};
// Manual stop recording function
// Replace your stopRecording function with this:
const stopRecording = () => {
  if (!isManualRecording) {
    console.log('[Client] Not in manual recording mode');
    return;
  }
  
  console.log('[Client] Stopping manual recording');
  console.log('[Client] Audio buffer length:', audioBufferRef.current.length);
  
  setIsManualRecording(false);
  setIsProcessingAudio(true);
  
  if (audioBufferRef.current.length > 0) {
    console.log('[Client] Sending audio chunks to server - buffer size:', audioBufferRef.current.length);
    sendAudioToServer();
  } else {
    console.log('[Client] No audio recorded - buffer is empty');
    showError('No audio recorded');
    setIsProcessingAudio(false);
  }
};


  // Audio processing
  // Replace your processAudioData function with this:
// Replace your processAudioData function with this complete version:
const processAudioData = useCallback((audioData) => {
  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !hasActiveSession) {
    return;
  }
  
  // For manual recording, always buffer the audio
  if (isManualRecording) {
    audioBufferRef.current.push(...audioData);
    console.log('[Client] Manual recording: buffered', audioData.length, 'samples. Total:', audioBufferRef.current.length);
    return;
  }
  
  // For push-to-talk mode, only process when recording
  if (pushToTalk && !isRecording) {
    return;
  }
  
  // For regular audio mode, only process when audio is enabled
  if (!audioEnabled) {
    return;
  }
  
  // For automatic VAD detection
  const isCurrentlySpeaking = analyzeAudio(audioData);
  
  if (isCurrentlySpeaking) {
    // Only buffer audio when speech is detected
    if (!isSpeaking) {
      console.log('[Client] Speech detected, starting to buffer audio');
      setIsSpeaking(true);
    }
    audioBufferRef.current.push(...audioData);
    
    // Clear silence timeout
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  } else if (isSpeaking) {
    // Start silence timeout only if we were speaking
    if (!silenceTimeoutRef.current) {
      silenceTimeoutRef.current = setTimeout(() => {
        console.log('[Client] Silence detected, sending audio');
        sendAudioToServer();
        setIsSpeaking(false);
        silenceTimeoutRef.current = null;
      }, 800);
    }
  }
}, [analyzeAudio, hasActiveSession, isSpeaking, isManualRecording, pushToTalk, isRecording, audioEnabled]);

  const sendAudioToServer = useCallback(() => {
  if (audioBufferRef.current.length === 0) return;
  
  console.log('[Client] Sending audio buffer length:', audioBufferRef.current.length);
  
  // Convert float32 to int16
  const int16Array = new Int16Array(audioBufferRef.current.length);
  for (let i = 0; i < audioBufferRef.current.length; i++) {
    int16Array[i] = Math.max(-32768, Math.min(32767, audioBufferRef.current[i] * 32768));
  }
  
  // Convert to base64
  const bytes = new Uint8Array(int16Array.buffer);
  const base64Audio = btoa(String.fromCharCode.apply(null, bytes));
  
  const audioMessage = {
    clientContent: {
      turns: [{
        role: 'user',
        parts: [{
          inlineData: {
            mimeType: 'audio/pcm;rate=16000;channels=1', // Fixed format
            data: base64Audio
          }
        }]
      }],
      turnComplete: true
    }
  };
  
  console.log('[Client] Sending audio message to Gemini');
  wsRef.current.send(JSON.stringify(audioMessage));
  
  // Clear buffer
  audioBufferRef.current = [];
  setIsTyping(true);
}, []);

  // Initialize audio
  // Replace your initializeAudio function with this:
const initializeAudio = useCallback(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    
    mediaStreamRef.current = stream;
    
    // Create audio context
    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000
    });
    
    const source = audioContextRef.current.createMediaStreamSource(stream);
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 2048;
    
    // Create script processor for audio data
    processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
    
    processorRef.current.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const audioData = new Float32Array(inputData);
      
      // Always process audio data - let processAudioData handle the logic
      processAudioData(audioData);
    };
    
    source.connect(analyserRef.current);
    analyserRef.current.connect(processorRef.current);
    processorRef.current.connect(audioContextRef.current.destination);
    
    showSuccess('Audio initialized successfully');
    setAudioEnabled(true);
    
  } catch (error) {
    showError('Failed to initialize audio: ' + error.message);
    console.error('[Client] Audio initialization error:', error);
  }
}, [processAudioData]);
  // Cleanup audio
  const cleanupAudio = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setAudioEnabled(false);
    setIsRecording(false);
    setIsSpeaking(false);
  }, []);
  const playAudioResponse = useCallback(async (base64Audio) => {
  try {
    setIsPlayingResponse(true);
    
    // Decode base64 to binary
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Create audio context if not exists or if closed
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Resume context if suspended
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    
    // Decode and play audio
    const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    
    source.onended = () => {
      setIsPlayingResponse(false);
      console.log('[Client] Audio response playback finished');
    };
    
    source.start();
    console.log('[Client] Playing audio response');
    
  } catch (error) {
    console.error('[Client] Error playing audio response:', error);
    setIsPlayingResponse(false);
    showError('Failed to play audio response: ' + error.message);
  }
}, []);
  // WebSocket message handler
  const handleServerMessage = useCallback((data) => {
    if (data.type === 'session_warning' && data.resume_handle) {
      setResumeHandle(data.resume_handle);
      setShouldReconnect(true);
      addSystemMessage('Session expiring, reconnecting to resume...');
    }
    
    // Handle serverContent from Gemini Live API
    if (data.serverContent) {
      const modelTurn = data.serverContent.modelTurn;
      if (modelTurn && modelTurn.parts && modelTurn.parts.length > 0) {
        const part = modelTurn.parts[0];
        
        // Handle text response
        if (part.text) {
          setCurrentResponse(prev => {
            const updated = prev + part.text;
            currentResponseRef.current = updated;
            return updated;
          });
          setIsTyping(true);
        }
        
        // Handle audio response (if supported)
        if (part.inlineData && part.inlineData.mimeType.startsWith('audio/')) {
          console.log('[Client] Received audio response');
          playAudioResponse(part.inlineData.data);
        }
      }
      
      if (data.serverContent.generationComplete) {
        setIsProcessingAudio(false);
        if(currentResponseRef.current){
          addMessage('model',currentResponseRef.current);
        }
        setCurrentResponse('');
        currentResponseRef.current = '';
        setIsTyping(false);
      }
      
      if (data.serverContent.turnComplete) {
        console.log('[Client] Turn complete');
      }
      return;
    }
    
    // Handle setupComplete to mark session as active
    if (data.setupComplete !== undefined) {
      setHasActiveSession(true);
      addSystemMessage('Session setup complete - You can now send messages or speak');
      return;
    }
    
    // Handle other message types
    switch (data.type) {
      case 'connection_established':
        showSuccess(data.message || 'Connected to Live API Bridge');
        break;
        
      case 'audio_response':
        if (data.audio_data) {
          console.log('[Client] Received audio response from server');
          playAudioResponse(data.content);
  }
  break;  
      case 'session_started':
        setHasActiveSession(true);
        showSuccess('Session started successfully');
        addSystemMessage('Session started - You can now send messages or speak');
        break;
        
      case 'session_ended':
        setHasActiveSession(false);
        addSystemMessage('Session ended');
        break;
        
      case 'text_chunk':
        if (!data.complete) {
          setIsTyping(true);
          setCurrentResponse(prev => {
            const updated = prev + data.content;
            currentResponseRef.current = updated;
            return updated;
          });
        }
        break;
        
      case 'generation_complete':
        setIsTyping(false);
        if (currentResponseRef.current) {
          addMessage('model', currentResponseRef.current);
        }
        setCurrentResponse('');
        currentResponseRef.current = '';
        break;
        
      case 'message_sent':
        console.log('[Client] Message acknowledged by server');
        break;
        
      case 'usage_update':
        if (data.total_tokens) {
          setTotalTokens(data.total_tokens);
        }
        break;
        
      case 'tool_call':
        addSystemMessage(`Tool called: ${data.tool_call}`);
        break;
        
      case 'interrupted':
        setIsTyping(false);
        setCurrentResponse('');
        currentResponseRef.current = '';
        addSystemMessage('Generation was interrupted');
        break;
        
      case 'session_warning':
        showError(data.message || 'Session warning');
        break;
        
      case 'configuration_updated':
        showSuccess(data.message || 'Configuration updated');
        break;
        
      case 'error':
        setIsTyping(false);
        setCurrentResponse('');
        currentResponseRef.current = '';
        showError(data.message || 'An error occurred');
        break;
        
      case 'session_resumption_update':
        if (data.handle) {
          setSessionHandle(data.handle);
          addSystemMessage('Session can be resumed.');
        }
        break;
        
      default:
        console.log('[Client] Unhandled message type:', data.type, data);
    }
  }, []);
  
  // Helper functions
  const addMessage = (type, content) => {
    if (type !== 'user' && type !== 'model' && type !== 'system') return;
    const newMessage = {
      id: messageIdRef.current++,
      type,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  };
  
  const addSystemMessage = (content) => {
    addMessage('system', content);
  };
  
  const showError = (message) => {
    setErrorMessage(message);
    console.error('[Client] Error:', message);
  };
  
  const showSuccess = (message) => {
    setSuccessMessage(message);
  };
  
  const sendToServer = (message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };
  
  // Build conversation turns for Gemini
  const buildConversationTurns = (newUserMessage = null) => {
    const conversationMessages = messages.filter(m => m.type === 'user' || m.type === 'model');
    const turns = [];
    conversationMessages.forEach(msg => {
      if (msg.type === 'user') {
        turns.push({ role: 'user', parts: [{ text: msg.content.trim() }] });
      } else if (msg.type === 'model') {
        turns.push({ role: 'model', parts: [{ text: msg.content.trim() }] });
      }
    });
    if (newUserMessage) {
      turns.push({ role: 'user', parts: [{ text: newUserMessage.trim() }] });
    }
    
    let lastRole = null;
    const filteredTurns = [];
    for (const turn of turns) {
      if (turn.role !== lastRole) {
        filteredTurns.push(turn);
        lastRole = turn.role;
      }
    }

    return filteredTurns;
  };
  
  // Connection handlers
  const connect = async () => {
    const url = wsUrl.trim();
    if (!url) {
      showError('Please enter a WebSocket URL');
      return;
    }

    try {
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('Connected');
        showSuccess('Connected to WebSocket server');
        
        // Send initial setup message with audio support
       // In your connect function, replace the setupMsg:
const setupMsg = {
  setup: {
    model: 'gemini-2.0-flash-live-001',
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig:  {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Aoede"
          }
        }
      }
    },
    systemInstruction: systemInstruction.trim() || undefined,
    tools: toolsEnabled ? [
      {
        functionDeclarations: []
      }
    ] : undefined
  }
};
        wsRef.current.send(JSON.stringify(setupMsg));
        if (resumeHandle) {
          console.log('[Client] Reconnected and sent setup with resume handle:', resumeHandle);
        }
        setResumeHandle(null);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleServerMessage(data);
        } catch (error) {
          console.error('[Client] Error parsing server message:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setHasActiveSession(false);
        setConnectionStatus('Disconnected');
        setIsTyping(false);
        setCurrentResponse('');
        currentResponseRef.current = '';
        addSystemMessage(`Disconnected from server (Code: ${event.code})`);
        if (resumeHandle) {
          console.log('[Client] Disconnected, will attempt to reconnect with resume handle:', resumeHandle);
          setTimeout(() => {
            connect(true);
          }, 500);
        }
      };

      wsRef.current.onerror = (error) => {
        showError('WebSocket connection error');
        console.error('[Client] WebSocket error:', error);
      };

    } catch (error) {
      showError('Failed to connect: ' + error.message);
    }
  };
  
  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      console.log('[Client] Manually disconnected from WebSocket server');
    }
  };
  
  // Session handlers
  const startSession = async () => {
    if (!isConnected) {
      showError('Not connected to server');
      return;
    }
    
    const message = messageInput.trim();
    if (!message) {
      showError('Please enter a message to start the session.');
      return;
    }
    const turns = buildConversationTurns(message);
    
    const payload = {
      clientContent: {
        turns: turns,
        turnComplete: true
      }
    };
    
    console.log('[Client] Starting session with payload:', payload);
    sendToServer(payload);
    
    addMessage('user', message);
    setMessageInput('');
    setIsTyping(true);
    setCurrentResponse('');
    currentResponseRef.current = '';
  };
  
  const endSession = async () => {
    if (!hasActiveSession) return;
    
    sendToServer({
      type: "end_session"
    });
    console.log('[Client] End session request sent');
  };
  
  // Message handlers
  const sendMessage = async () => {
    const message = messageInput.trim();
    if (!message || !hasActiveSession || isTyping) {
      console.log('[Client] Cannot send message:', { message: !!message, hasActiveSession, isTyping });
      return;
    }
    
    const turns = buildConversationTurns(message);
    const payload = {
      clientContent: {
        turns: turns,
        turnComplete: true
      }
    };
    
    console.log('[Client] Sending message with payload:', payload);
    sendToServer(payload);
    
    addMessage('user', message);
    setMessageInput('');
    setIsTyping(true);
    setCurrentResponse('');
    currentResponseRef.current = '';
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (hasActiveSession) {
        sendMessage();
      } else {
        startSession();
      }
    }
  };

  // Control handlers
  const toggleTools = () => {
    setToolsEnabled(!toolsEnabled);
  };
  
  const toggleConfig = () => {
    setShowConfig(!showConfig);
  };
  
  const toggleAudio = () => {
    if (audioEnabled) {
      cleanupAudio();
    } else {
      initializeAudio();
    }
  };
  
  const togglePushToTalk = () => {
    setPushToTalk(!pushToTalk);
    
  };
  
  const handlePushToTalkMouseDown = () => {
    if (pushToTalk && audioEnabled && hasActiveSession) {
      setIsRecording(true);
    }
  };
  
  const handlePushToTalkMouseUp = () => {
    if (pushToTalk && isRecording) {
      setIsRecording(false);
      if (audioBufferRef.current.length > 0) {
        sendAudioToServer();
      }
    }
  };
  // Also add these event handlers to prevent context menu and improve UX:
const handlePushToTalkMouseLeave = () => {
  if (pushToTalk && isRecording) {
    console.log('[Client] Push-to-talk: Mouse left button, stopping recording');
    setIsRecording(false);
    if (audioBufferRef.current.length > 0) {
      sendAudioToServer();
    }
  }
};
  const clearChat = () => {
    setMessages([{
      id: 1,
      type: 'system',
      content: 'Chat cleared. Welcome to Live API Chat Demo!'
    }]);
    messageIdRef.current = 2;
    setTotalTokens(0);
    setSessionHandle(null);
    setCurrentResponse('');
    currentResponseRef.current = '';
    setIsTyping(false);
    console.log('[Client] Chat cleared');
  };
  
  const saveConfig = () => {
    showSuccess('Configuration saved');
    setShowConfig(false);
    console.log('[Client] Configuration saved:', { systemInstruction, wsUrl, toolsEnabled, vadThreshold });
  };
  
return (
  <div className="min-h-screen bg-gradient-to-br from-blue-400 via-purple-500 to-purple-700 flex items-center justify-center p-5">
    <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl w-full max-w-4xl h-[600px] flex flex-col overflow-hidden border border-white/20">
      
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-cyan-400 text-white p-5 text-center">
        <h1 className="text-2xl font-bold mb-1">Live API Audio Chat Demo</h1>
        <div className="flex items-center justify-center gap-2 text-sm opacity-90">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
          <span>{connectionStatus}</span>
          {audioEnabled && (
            <>
              <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-red-400' : 'bg-gray-400'} animate-pulse`}></div>
              <span>{isSpeaking ? 'Speaking' : 'Listening'}</span>
            </>
          )}
        </div>
      </div>
      
      {/* Controls Section */}
      <div className="p-4 bg-black/5 border-b border-black/10 flex flex-wrap gap-3 items-center">
        
        {/* Connection Controls */}
        <div className="flex gap-2">
          <button
            onClick={connect}
            disabled={isConnected}
            className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            Connect
          </button>
          <button
            onClick={disconnect}
            disabled={!isConnected}
            className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            Disconnect
          </button>
        </div>
        
        {/* Session Controls */}
        <div className="flex gap-2">
          <button
            onClick={startSession}
            disabled={!isConnected || hasActiveSession}
            className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            Start Session
          </button>
          <button
            onClick={endSession}
            disabled={!hasActiveSession}
            className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            End Session
          </button>
        </div>
        
        {/* Manual Recording Controls */}
        <div className="flex gap-2">
          <button
            onClick={startRecording}
            disabled={!audioEnabled || !hasActiveSession || isManualRecording}
            className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            🎤 Start Recording
          </button>
          <button
            onClick={stopRecording}
            disabled={!isManualRecording}
            className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            ⏹️ Stop & Send
          </button>
        </div>
        
        {/* Audio Controls */}
        <div className="flex gap-2">
          <button
            onClick={toggleAudio}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              audioEnabled 
                ? 'bg-green-500 text-white hover:bg-green-600' 
                : 'bg-gray-500 text-white hover:bg-gray-600'
            }`}
          >
            {audioEnabled ? '🎤 Audio On' : '🎤 Audio Off'}
          </button>
          
          <button
            onClick={togglePushToTalk}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              pushToTalk 
                ? 'bg-blue-500 text-white hover:bg-blue-600' 
                : 'bg-gray-500 text-white hover:bg-gray-600'
            }`}
          >
            {pushToTalk ? 'Push-to-Talk On' : 'Push-to-Talk Off'}
          </button>
        </div>
        
        {/* Push-to-Talk Control (conditional) */}
        {pushToTalk && audioEnabled && hasActiveSession && (
          <div className="flex gap-2">
            <button
              onMouseDown={handlePushToTalkMouseDown}
              onMouseUp={handlePushToTalkMouseUp}
              onMouseLeave={handlePushToTalkMouseLeave}
              onContextMenu={(e) => e.preventDefault()}
              className={`px-6 py-3 rounded-lg text-sm font-semibold transition-all select-none ${
                isRecording 
                  ? 'bg-red-500 text-white shadow-lg' 
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {isRecording ? '🔴 Recording...' : '🎤 Hold to Talk'}
            </button>
          </div>
        )}
        
        {/* Status Indicators */}
        {isManualRecording && (
          <div className="flex items-center gap-2 text-red-600">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-semibold">Recording...</span>
          </div>
        )}
        
        {isProcessingAudio && (
          <div className="flex items-center gap-2 text-blue-600">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-semibold">Processing...</span>
          </div>
        )}
        
        {isPlayingResponse && (
          <div className="flex items-center gap-2 text-green-600">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-semibold">Playing Response...</span>
          </div>
        )}
        
        {/* Tools Toggle */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-600">Tools:</label>
          <button
            onClick={toggleTools}
            className={`relative w-10 h-5 rounded-full transition-colors ${toolsEnabled ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <div className={`absolute w-4 h-4 bg-white rounded-full top-0.5 transition-transform ${toolsEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}></div>
          </button>
        </div>
        
        {/* Utility Controls */}
        <div className="flex gap-2">
          <button
            onClick={toggleConfig}
            className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all"
          >
            Config
          </button>
          <button
            onClick={clearChat}
            className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all"
          >
            Clear
          </button>
        </div>
      </div>
      
      {/* Configuration Panel (conditional) */}
      {showConfig && (
        <div className="p-4 bg-black/5 border-b border-black/10 animate-in slide-in-from-top duration-300">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">System Instruction:</label>
              <textarea
                value={systemInstruction}
                onChange={(e) => setSystemInstruction(e.target.value)}
                placeholder="You are a helpful assistant..."
                className="w-full p-2 border border-gray-300 rounded-lg text-xs resize-none h-16"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">WebSocket URL:</label>
              <input
                type="text"
                value={wsUrl}
                onChange={(e) => setWsUrl(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">VAD Threshold:</label>
              <input
                type="range"
                min="0.001"
                max="0.1"
                step="0.001"
                value={vadThreshold}
                onChange={(e) => setVadThreshold(parseFloat(e.target.value))}
                className="w-full"
              />
              <span className="text-xs text-gray-500">{vadThreshold.toFixed(3)}</span>
            </div>
            <button
              onClick={saveConfig}
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all"
            >
              Save Config
            </button>
          </div>
        </div>
      )}
    </div>
  </div>
);     
}


export default AudioTest;