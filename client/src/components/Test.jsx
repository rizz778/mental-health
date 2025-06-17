import React, { useState, useEffect, useRef, useCallback } from 'react';

const Test = () => {
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  
  // UI state
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  
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
  const [wsUrl, setWsUrl] = useState('ws://localhost:8765');
  
  // Stats
  const [totalTokens, setTotalTokens] = useState(0);
  
  // Status messages
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  
  // Refs
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageIdRef = useRef(2);
  
  // Session resumption handle
  const [sessionHandle, setSessionHandle] = useState(null);
  
  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);
  
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
  
  // WebSocket message handler
  const handleServerMessage = useCallback((data) => {
    console.log('[Gemini] handleServerMessage received:', data);
    if (data.serverContent) {
      const modelTurn = data.serverContent.modelTurn;
      if (modelTurn && modelTurn.parts && modelTurn.parts.length > 0) {
        const text = modelTurn.parts[0].text;
        setIsTyping(false);
        addMessage('assistant', text); // Ensure assistant responses are always added
        setCurrentResponse('');
        console.log('[Gemini] Assistant/model response added:', text);
      }
      if (data.serverContent.generationComplete) {
        setIsTyping(false);
        console.log('[Gemini] Generation complete');
      }
      if (data.serverContent.turnComplete) {
        console.log('[Gemini] Turn complete');
      }
      return;
    }
    switch (data.type) {
      case 'connection_established':
        showSuccess(data.message || 'Connected to Live API Bridge');
        break;
        
      case 'session_started':
        setHasActiveSession(true);
        setSuccessMessage('Session started successfully');
        addSystemMessage('Session started - You can now send messages');
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
          console.log('[Gemini] Streaming text_chunk:', data.content);
        }
        break;
      case 'generation_complete':
        setIsTyping(false);
        if (currentResponseRef.current) {
          addMessage('assistant', currentResponseRef.current);
          console.log('[Gemini] Assistant response finalized:', currentResponseRef.current);
          setCurrentResponse('');
          currentResponseRef.current = '';
        }
        console.log('[Gemini] Generation complete');
        break;
        
      case 'message_sent':
        // Acknowledgment that message was sent to Live API
        console.log('Message sent to Live API');
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
        setErrorMessage(data.message || 'An error occurred');
        break;
        
      case 'session_resumption_update':
        if (data.handle) {
          setSessionHandle(data.handle);
          addSystemMessage('Session can be resumed.');
        }
        return;
        
      default:
        console.log('Unhandled message type:', data.type, data);
    }
  }, [currentResponse]);
  
  // Helper functions
  const addMessage = (type, content) => {
    const newMessage = {
      id: messageIdRef.current++,
      type,
      content,
      timestamp: new Date()
    };
    console.log('[Gemini] addMessage:', newMessage);
    setMessages(prev => [...prev, newMessage]);
  };
  
  const addSystemMessage = (content) => {
    addMessage('system', content);
  };
  
  const showError = (message) => {
    setErrorMessage(message);
  };
  
  const showSuccess = (message) => {
    setSuccessMessage(message);
  };
  
  const sendToServer = (message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };
  
  // Helper to build Gemini turns from chat history
  const buildGeminiTurns = (newUserMessage = null) => {
    // Only include user and assistant messages, in order
    const chatTurns = messages
      .filter(m => m.type === 'user' || m.type === 'assistant')
      .map(m => ({
        role: m.type === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));
    if (newUserMessage) {
      chatTurns.push({ role: 'user', parts: [{ text: newUserMessage }] });
    }
    console.log('[Gemini] buildGeminiTurns: messages:', messages, 'turns:', chatTurns);
    return chatTurns;
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
        // Send Gemini Live API setup message as the first message
        const setupMsg = {
          setup: {
            model: 'models/gemini-2.0-flash-live-001',
            generationConfig: {
              responseModalities: ['TEXT']
            },
            systemInstruction: systemInstruction.trim() || undefined,
            tools: toolsEnabled ? [{}] : undefined,
            ...(sessionHandle ? { sessionResumption: { handle: sessionHandle } } : {})
          }
        };
        wsRef.current.send(JSON.stringify(setupMsg));
        console.log('[Gemini] Setup message sent:', setupMsg);
      };

      wsRef.current.onmessage = (event) => {
        handleServerMessage(JSON.parse(event.data));
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        setHasActiveSession(false);
        setConnectionStatus('Disconnected');
        addSystemMessage('Disconnected from server');
        console.log('[Gemini] Connection closed');
      };

      wsRef.current.onerror = (error) => {
        showError('WebSocket connection error');
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      showError('Failed to connect: ' + error.message);
    }
  };
  
  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      console.log('[Gemini] Disconnected from WebSocket server');
    }
  };
  
  // Session handlers
  const startSession = async () => {
    if (!isConnected) {
      showError('Not connected to server');
      return;
    }
    const message = messageInput.trim() || 'Hello!';
    const payload = {
      clientContent: {
        turns: buildGeminiTurns(message),
        turnComplete: true
      }
    };
    console.log('[Gemini] Sending startSession payload:', payload);
    sendToServer(payload);
    setHasActiveSession(true);
    addSystemMessage('Session started - You can now send messages');
  };
  
  const endSession = async () => {
    if (!hasActiveSession) return;
    
    sendToServer({
      type: "end_session"
    });
    console.log('[Gemini] End session sent');
  };
  
  // Message handlers
  const sendMessage = async () => {
    const message = messageInput.trim();
    if (!message || !hasActiveSession || isTyping) return; // Prevent sending while waiting for model
    const turns = buildGeminiTurns(message);
    const payload = {
      clientContent: {
        turns,
        turnComplete: true
      }
    };
    console.log('[Gemini] Sending sendMessage payload:', payload);
    sendToServer(payload);
    addMessage('user', message);
    setMessageInput('');
    setIsTyping(true);
    setCurrentResponse('');
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
  
  // Control handlers
  const toggleTools = () => {
    setToolsEnabled(!toolsEnabled);
  };
  
  const toggleConfig = () => {
    setShowConfig(!showConfig);
  };
  
  const clearChat = () => {
    setMessages([{
      id: 1,
      type: 'system',
      content: 'Chat cleared. Welcome to Live API Chat Demo!'
    }]);
    messageIdRef.current = 2;
    setTotalTokens(0);
    setSessionHandle(null); // Clear session handle on chat clear
    console.log('[Gemini] Chat cleared');
  };
  
  const saveConfig = () => {
    showSuccess('Configuration saved');
    setShowConfig(false);
    console.log('[Gemini] Configuration saved:', { systemInstruction, wsUrl, toolsEnabled });
  };
  
  // Log state changes
  useEffect(() => {
    console.log('[Gemini] Messages state updated:', messages);
  }, [messages]);
  
  useEffect(() => {
    console.log('[Gemini] isTyping state:', isTyping);
  }, [isTyping]);
  
  useEffect(() => {
    console.log('[Gemini] hasActiveSession state:', hasActiveSession);
  }, [hasActiveSession]);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-400 via-purple-500 to-purple-700 flex items-center justify-center p-5">
      <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl w-full max-w-4xl h-[600px] flex flex-col overflow-hidden border border-white/20">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-cyan-400 text-white p-5 text-center">
          <h1 className="text-2xl font-bold mb-1">Live API Chat Demo</h1>
          <div className="flex items-center justify-center gap-2 text-sm opacity-90">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
            <span>{connectionStatus}</span>
          </div>
        </div>
        
        {/* Controls */}
        <div className="p-4 bg-black/5 border-b border-black/10 flex flex-wrap gap-3 items-center">
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
          
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600">Tools:</label>
            <button
              onClick={toggleTools}
              className={`relative w-10 h-5 rounded-full transition-colors ${toolsEnabled ? 'bg-blue-500' : 'bg-gray-300'}`}
            >
              <div className={`absolute w-4 h-4 bg-white rounded-full top-0.5 transition-transform ${toolsEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}></div>
            </button>
          </div>
          
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
        
        {/* Config Panel */}
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
              <button
                onClick={saveConfig}
                className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all"
              >
                Save Config
              </button>
            </div>
          </div>
        )}
        
        {/* Status Messages */}
        {errorMessage && (
          <div className="bg-red-500 text-white p-3 text-sm animate-in slide-in-from-top duration-300">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-500 text-white p-3 text-sm animate-in slide-in-from-top duration-300">
            {successMessage}
          </div>
        )}
        
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 bg-gray-50 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`animate-in slide-in-from-bottom duration-300 ${
                message.type === 'user' ? 'text-right' : 
                message.type === 'system' ? 'text-center' : 'text-left'
              }`}
            >
              <div
                className={`inline-block max-w-[70%] p-3 rounded-2xl text-sm leading-relaxed ${
                  message.type === 'user' 
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white' 
                    : message.type === 'system'
                    ? 'bg-black/10 text-gray-600 text-xs'
                    : 'bg-white border border-gray-200 text-gray-800'
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
          
          {/* Typing Indicator */}
          {isTyping && (
            <div className="text-left animate-in slide-in-from-bottom duration-300">
              <div className="inline-block bg-white border border-gray-200 p-3 rounded-2xl">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          )}
          
          {/* Current Response */}
          {currentResponse && (
            <div className="text-left animate-in slide-in-from-bottom duration-300">
              <div className="inline-block max-w-[70%] bg-white border border-gray-200 p-3 rounded-2xl text-sm leading-relaxed text-gray-800">
                {currentResponse}
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
        
        {/* Input Area */}
        <div className="p-5 bg-white border-t border-gray-200 flex gap-3 items-end">
          <div className="flex-1">
            <textarea
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message here..."
              disabled={!hasActiveSession || isTyping}
              className="w-full min-h-[44px] max-h-32 p-3 border-2 border-gray-200 rounded-3xl text-sm resize-none outline-none focus:border-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={!hasActiveSession || !messageInput.trim() || isTyping}
            className="w-11 h-11 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-full flex items-center justify-center text-lg hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            ➤
          </button>
        </div>
        
        {/* Stats */}
        <div className="p-3 bg-black/5 text-xs text-gray-600 flex justify-between items-center">
          <span>Tokens: {totalTokens}</span>
          <span>Session: {hasActiveSession ? 'Active' : 'Inactive'}</span>
        </div>
      </div>
    </div>
  );
};

export default Test;