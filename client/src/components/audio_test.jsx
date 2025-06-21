import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Activity, Brain, Heart } from 'lucide-react';

const AudioTest = () => {
  
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [messages, setMessages] = useState([]);
  const [volume, setVolume] = useState(0.8);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  
  const SILENCE_THRESHOLD = 0.01;
  const SILENCE_TIMEOUT = 1500; // 1.5 seconds
  const WS_URL = 'ws://localhost:8000/ws'; 
  
  // Initialize audio context and analyzer
  const initializeAudio = useCallback(async () => {
    try {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });
      
      audioStreamRef.current = stream;
      
      // Set up audio analysis for voice activity detection
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      
      // Set up MediaRecorder
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          // Convert blob to base64 and send
          const reader = new FileReader();
          reader.onload = () => {
            const base64Audio = reader.result.split(',')[1];
            wsRef.current.send(JSON.stringify({
              type: 'audio_chunk',
              data: base64Audio
            }));
          };
          reader.readAsDataURL(event.data);
        }
      };
      
      return true;
    } catch (error) {
      console.error('Error initializing audio:', error);
      return false;
    }
  }, []);
  
    // Voice Activity Detection
  const detectVoiceActivity = useCallback(() => {
    if (!analyserRef.current) return;
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    // Calculate RMS (Root Mean Square) for audio level
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += (dataArray[i] / 255) ** 2;
    }
    const rms = Math.sqrt(sum / bufferLength);
    setAudioLevel(rms);
    
    // Voice activity detection
    if (rms > SILENCE_THRESHOLD) {
      // Voice detected, clear silence timer
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      
      // Start recording if not already recording
      if (!isRecording && !isBotSpeaking) {
        startRecording();
      }
    } else if (isRecording) {
      // Silence detected while recording
      if (!silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => {
          stopRecording();
        }, SILENCE_TIMEOUT);
      }
    }
  }, [isRecording, isBotSpeaking]);

  // Start recording
  const startRecording = useCallback(() => {
    if (mediaRecorderRef.current && !isRecording && !isBotSpeaking) {
      setIsRecording(true);
      mediaRecorderRef.current.start(250); // Send chunks every 250ms
      
      // Send start recording signal
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'start_recording'
        }));
      }
      
      addMessage('user', 'Speaking...', 'audio');
    }
  }, [isRecording, isBotSpeaking]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      setIsRecording(false);
      mediaRecorderRef.current.stop();
      
      // Clear silence timer
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      
      // Send stop recording signal
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'stop_recording'
        }));
      }
    }
  }, [isRecording]);

    // Play audio from base64
  const playAudio = useCallback(async (base64Audio) => {
    try {
      if (!audioContextRef.current) return;
      
      const audioData = atob(base64Audio);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const view = new Uint8Array(arrayBuffer);
      
      for (let i = 0; i < audioData.length; i++) {
        view[i] = audioData.charCodeAt(i);
      }
      
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
      const source = audioContextRef.current.createBufferSource();
      const gainNode = audioContextRef.current.createGain();
      
      source.buffer = audioBuffer;
      gainNode.gain.value = volume;
      
      source.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);
      
      source.onended = () => {
        setIsBotSpeaking(false);
        isPlayingRef.current = false;
        playNextAudio();
      };
      
      setIsBotSpeaking(true);
      isPlayingRef.current = true;
      source.start();
      
    } catch (error) {
      console.error('Error playing audio:', error);
      setIsBotSpeaking(false);
      isPlayingRef.current = false;
    }
  }, [volume]);
   // Play next audio in queue
  const playNextAudio = useCallback(() => {
    if (audioQueueRef.current.length > 0 && !isPlayingRef.current) {
      const nextAudio = audioQueueRef.current.shift();
      playAudio(nextAudio);
    }
  }, [playAudio]);

  // Add message to chat
  const addMessage = useCallback((sender, content, type = 'text') => {
    setMessages(prev => [...prev, {
      id: Date.now(),
      sender,
      content,
      type,
      timestamp: new Date().toLocaleTimeString()
    }]);
  }, []);

  // Connect to WebSocket
  const connect = useCallback(async () => {
    const audioInitialized = await initializeAudio();
    if (!audioInitialized) {
      alert('Failed to initialize audio. Please check your microphone permissions.');
      return;
    }

    wsRef.current = new WebSocket(WS_URL);
    
    wsRef.current.onopen = () => {
      setIsConnected(true);
      addMessage('system', 'Connected! Start speaking when you\'re ready.');
      
      // Start voice activity detection
      const vadInterval = setInterval(detectVoiceActivity, 100);
      wsRef.current.vadInterval = vadInterval;
    };
    
    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'text_response':
          addMessage('bot', data.content, 'text');
          break;
          
        case 'audio_response':
          // Queue audio for playback
          audioQueueRef.current.push(data.content);
          if (!isPlayingRef.current) {
            playNextAudio();
          }
          break;
          
        case 'transcription':
          // Update the last user message with transcription
          setMessages(prev => {
            const newMessages = [...prev];
            const lastUserMessage = newMessages.reverse().find(m => m.sender === 'user');
            if (lastUserMessage) {
              lastUserMessage.content = data.content;
              lastUserMessage.type = 'text';
            }
            return newMessages.reverse();
          });
          break;
          
        case 'error':
          console.error('WebSocket error:', data.message);
          addMessage('system', `Error: ${data.message}`);
          break;
      }
    };
    
    wsRef.current.onclose = () => {
      setIsConnected(false);
      setIsRecording(false);
      setIsBotSpeaking(false);
      
      if (wsRef.current?.vadInterval) {
        clearInterval(wsRef.current.vadInterval);
      }
      
      addMessage('system', 'Disconnected from server.');
    };
    
    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      addMessage('system', 'Connection error occurred.');
    };
  }, [initializeAudio, detectVoiceActivity, playNextAudio, addMessage]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
  }, []);

    // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Brain className="w-8 h-8" />
              <h1 className="text-2xl font-bold">Mental Health Support Bot</h1>
            </div>
            <div className={`px-4 py-2 rounded-full text-sm font-medium ${
              isConnected 
                ? 'bg-green-500 bg-opacity-30 border border-green-300' 
                : 'bg-red-500 bg-opacity-30 border border-red-300'
            }`}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="h-96 overflow-y-auto p-6 bg-gray-50">
          {messages.length === 0 ? (
            <div className="text-center text-gray-600 mt-8">
              <Heart className="w-12 h-12 mx-auto mb-4 text-pink-400" />
              <p className="text-lg mb-2">Welcome to your mental health support space</p>
              <p className="text-sm">Connect and start speaking when you're ready. I'm here to listen.</p>
              <p className="text-xs mt-4 text-gray-500">⚠️ This is a support tool, not a replacement for professional care</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.sender === 'user'
                        ? 'bg-blue-500 text-white'
                        : message.sender === 'bot'
                        ? 'bg-green-100 text-gray-800'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    <p className="text-sm">{message.content}</p>
                    <p className="text-xs opacity-70 mt-1">{message.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="p-6 bg-white border-t">
          <div className="flex items-center justify-between mb-4">
            <div className="flex space-x-3">
              <button
                onClick={connect}
                disabled={isConnected}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg disabled:bg-gray-400 hover:bg-blue-700 transition-colors"
              >
                Connect
              </button>
              <button
                onClick={disconnect}
                disabled={!isConnected}
                className="px-6 py-2 bg-red-600 text-white rounded-lg disabled:bg-gray-400 hover:bg-red-700 transition-colors"
              >
                Disconnect
              </button>
            </div>

            {/* Status Indicators */}
            <div className="flex items-center space-x-4">
              <div className={`flex items-center space-x-2 ${isRecording ? 'text-red-600' : 'text-gray-400'}`}>
                {isRecording ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                <span className="text-sm">Listening</span>
              </div>
              
              <div className={`flex items-center space-x-2 ${isBotSpeaking ? 'text-green-600' : 'text-gray-400'}`}>
                {isBotSpeaking ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                <span className="text-sm">Speaking</span>
              </div>
              
              {/* Audio Level Indicator */}
              <div className="flex items-center space-x-2">
                <Activity className="w-5 h-5 text-blue-600" />
                <div className="w-20 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-100"
                    style={{ width: `${Math.min(audioLevel * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Volume Control */}
          <div className="flex items-center space-x-3">
            <VolumeX className="w-4 h-4 text-gray-600" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="flex-1"
            />
            <Volume2 className="w-4 h-4 text-gray-600" />
            <span className="text-sm text-gray-600 w-12">{Math.round(volume * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AudioTest;