import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Layout,
  Menu,
  Input,
  Button,
  message as antdMessage,
  Spin,
  notification,
  Modal,
} from "antd";
import { motion } from "framer-motion";
import {
  DollarOutlined,
  PhoneOutlined,
  CameraOutlined,
  InfoCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import {
  MessageOutlined,
  PlusOutlined,
  SendOutlined,
  AudioOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

const { Header, Sider, Content } = Layout;

// Backend URLs
const NODE_BACKEND_URL = "http://localhost:4000"; // Node.js backend (user profile, chat history, saving results)
const GEMINI_BACKEND_URL = "http://localhost:8000"; // Gemini backend (chat, emotion, distress scoring)

const ChatPage = () => {
  // Connection state
  const [emotionDetectionEnabled, setEmotionDetectionEnabled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");

  // UI state
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isCameraTestVisible, setCameraTestVisible] = useState(false);

  // Chat state
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [input, setInput] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [listening, setListening] = useState(false);

  // Emotion and video refs
  const [emotion, setEmotion] = useState({ current: "", aggregated: "" });
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Messages and input
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: "system",
      content: "Welcome to Live API Chat Demo! Connect to the WebSocket server and start a session to begin chatting.",
      sender: "system",
      text: "Welcome to Live API Chat Demo! Connect to the WebSocket server and start a session to begin chatting.",
    },
  ]);
  const [messageInput, setMessageInput] = useState("");
  const [currentResponse, setCurrentResponse] = useState("");
  const currentResponseRef = useRef("");

  // Config
  const [systemInstruction, setSystemInstruction] = useState(
    "Reply in english by default, but change the language if the user queries in another language. Format your answer clearly and naturally, without using asterisks for emphasis. Do not include English translations or explanations in brackets. Only reply in the user's language. And if you receive a user emotion, respond in acknowledgement of that, and have emotionally supportive conversations"
  );
  const [wsUrl, setWsUrl] = useState("ws://localhost:8000");

  // Stats
  const [totalTokens, setTotalTokens] = useState(0);

  // Status messages
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Refs
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageIdRef = useRef(2);
  const navigate = useNavigate();

  // Session resumption handle
  const [sessionHandle, setSessionHandle] = useState(null);
  const [resumeHandle, setResumeHandle] = useState(null);
  const [shouldReconnect, setShouldReconnect] = useState(false);

  const [distressScore, setDistressScore] = useState(null);

  // Emotion detection effect (Webcam + Gemini emotion via WebSocket)
  useEffect(() => {
    if (!emotionDetectionEnabled) return;
    let ws;
    let interval;
    let stream;
    let isMounted = true;

    // Open a dedicated WebSocket for emotion detection
    ws = new WebSocket("ws://localhost:8000");

    ws.onopen = () => {
      console.log("[Emotion] WebSocket connected");
      ws.send(JSON.stringify({ setup: {} }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.emotion) {
        setEmotion(data.emotion);
        // console.log("[Emotion] Current:", data.emotion.current, "Aggregated:", data.emotion.aggregated);
      } else if (data.setupComplete) {
        console.log("[Emotion] Setup complete");
      } else {
        console.warn("[Emotion] Unknown message:", data);
      }
    };

    ws.onerror = (err) => console.error("[Emotion] WebSocket error:", err);
    ws.onclose = () => console.warn("[Emotion] WebSocket closed");

    // Start webcam
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((mediaStream) => {
        stream = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
        interval = setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN){
            console.log("WebSocket not open");
            return;
          }
          const canvas = canvasRef.current;
          const video = videoRef.current;
           if (!canvas) {
            console.log("Canvas not available");
            return;
          }
          if (!video) {
    console.log("Video not available");
    return;
  }
          if (canvas && video) {
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL("image/jpeg");
            const base64 = dataURL.split(",")[1];
            // console.log("Frame sent")
            ws.send(JSON.stringify({ frame: base64 }));
          }
        }, 1000);
      })
      .catch((err) => console.error("[Emotion] Error accessing webcam:", err));

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
      if (ws) ws.close();
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [emotionDetectionEnabled]);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, currentResponse]);

  // Auto-hide status messages
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    if (shouldReconnect && resumeHandle) {
      setShouldReconnect(false);
      setTimeout(() => {
        console.log("[Client] Triggering session reconnect with resume handle:", resumeHandle);
        connect(true);
      }, 500);
    }
  }, [shouldReconnect, resumeHandle]);

  // Initialize chat sessions on mount
  useEffect(() => {
    const initializeSessions = () => {
      // Mock chat sessions - replace with actual API call
      const mockSessions = [
        { _id: "session1", sessionName: "General Chat" },
        { _id: "session2", sessionName: "Support Chat" },
      ];
      setChatSessions(mockSessions);
      
      const savedActiveSession = localStorage.getItem("activeSession");
      if (savedActiveSession) {
        setActiveSession(savedActiveSession);
      } else if (mockSessions.length > 0) {
        setActiveSession(mockSessions[0]._id);
      }
    };

    initializeSessions();
  }, []);

  // WebSocket message handler
  const handleServerMessage = useCallback((data) => {
    if (data.type === "session_warning" && data.resume_handle) {
      setResumeHandle(data.resume_handle);
      setShouldReconnect(true);
      addSystemMessage("Session expiring, reconnecting to resume...");
    }
    
    if (data.emotion) {
      setEmotion(data.emotion);
      return;
    }
    
    if (data.error) {
      showError(data.error);
      return;
    }
    
    if (data.serverContent) {
      const modelTurn = data.serverContent.modelTurn;
      if (modelTurn && modelTurn.parts && modelTurn.parts.length > 0) {
        const text = modelTurn.parts[0].text;
        setCurrentResponse((prev) => {
          const updated = prev + text;
          currentResponseRef.current = updated;
          return updated;
        });
        setIsTyping(true);
      }
      if (data.serverContent.generationComplete) {
        if (currentResponseRef.current) {
          // Save user message before model message
          if (activeSession && messages.length > 0) {
            const lastUserMsg = messages[messages.length - 1];
            if (lastUserMsg.type === 'user') {
              saveMessage(activeSession, {
                sender: 'user',
                type: 'user',
                content: lastUserMsg.content,
                emotion: emotion.current,
                distress: distressScore,
                timestamp: lastUserMsg.timestamp,
              });
            }
          }
          addMessage("model", currentResponseRef.current);
          // Save model message to backend after each model response
          if (activeSession) {
            saveMessage(activeSession, {
              type: 'model',
              content: currentResponseRef.current,
              timestamp: new Date().toISOString(),
            });
          }
        }
        setCurrentResponse("");
        currentResponseRef.current = "";
        setIsTyping(false);
      }
      if (data.serverContent.turnComplete) {
        console.log("[Client] Turn complete");
      }
      return;
    }
    
    switch (data.type) {
      case "connection_established":
        showSuccess(data.message || "Connected to Live API Bridge");
        break;
      case "session_started":
        setHasActiveSession(true);
        showSuccess("Session started successfully");
        addSystemMessage("Session started - You can now send messages");
        break;
      case "setup_complete":
        console.log('setup complete!!!');
        setHasActiveSession(true);
        addSystemMessage("Session setup complete - You can now send messages");
        break;
      case "session_ended":
        setHasActiveSession(false);
        addSystemMessage("Session ended");
        break;
      case "text_chunk":
        if (!data.complete) {
          setIsTyping(true);
          setCurrentResponse((prev) => {
            const updated = prev + data.content;
            currentResponseRef.current = updated;
            return updated;
          });
        }
        break;
      case "generation_complete":
        setIsTyping(false);
        if (currentResponseRef.current) {
          // Save user message before model message
          if (activeSession && messages.length > 0) {
            const lastUserMsg = messages[messages.length - 1];
            if (lastUserMsg.type === 'user') {
              saveMessage(activeSession, {
                sender: 'user',
                type: 'user',
                content: lastUserMsg.content,
                emotion: emotion.current,
                distress: distressScore,
                timestamp: lastUserMsg.timestamp,
              });
            }
          }
          addMessage("model", currentResponseRef.current);
          // Save model message to backend after each model response
          if (activeSession) {
            saveMessage(activeSession, {
              type: 'model',
              content: currentResponseRef.current,
              timestamp: new Date().toISOString(),
            });
          }
        }
        setCurrentResponse("");
        currentResponseRef.current = "";
        break;
      case "message_sent":
        console.log("[Client] Message acknowledged by server");
        break;
      case "usage_update":
        if (data.total_tokens) {
          setTotalTokens(data.total_tokens);
        }
        break;
      case "tool_call":
        addSystemMessage(`Tool called: ${data.tool_call}`);
        break;
      case "interrupted":
        setIsTyping(false);
        setCurrentResponse("");
        currentResponseRef.current = "";
        addSystemMessage("Generation was interrupted");
        break;
      case "session_warning":
        showError(data.message || "Session warning");
        break;
      case "configuration_updated":
        showSuccess(data.message || "Configuration updated");
        break;
      case "error":
        setIsTyping(false);
        setCurrentResponse("");
        currentResponseRef.current = "";
        showError(data.message || "An error occurred");
        break;
      case "session_resumption_update":
        if (data.handle) {
          setSessionHandle(data.handle);
          addSystemMessage("Session can be resumed.");
        }
        break;
      default:
        console.log("[Client] Unhandled message type:", data.type, data);
    }
  }, []);

  // Simple text formatting function
  const formatText = (text) => {
    return text?.replace(/\n/g, '<br/>') || '';
  };

  // Helper functions
  const addMessage = (type, content) => {
    if (type !== "user" && type !== "model" && type !== "system") return;
    const newMessage = {
      id: messageIdRef.current++,
      type,
      content,
      sender: type === "user" ? "user" : type === "model" ? "bot" : "system",
      text: content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  const addSystemMessage = (content) => {
    addMessage("system", content);
  };

  const showError = (message) => {
    setErrorMessage(message);
    antdMessage.error(message);
    console.error("[Client] Error:", message);
  };

  const showSuccess = (message) => {
    setSuccessMessage(message);
    antdMessage.success(message);
  };

  const sendToServer = (message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const buildConversationTurns = (newUserMessage = null) => {
    const conversationMessages = messages.filter(
      (m) => m.type === "user" || m.type === "model"
    );
    const turns = [];
    conversationMessages.forEach((msg) => {
      if (msg.type === "user") {
        turns.push({ role: "user", parts: [{ text: msg.content.trim() }] });
      } else if (msg.type === "model") {
        turns.push({ role: "model", parts: [{ text: msg.content.trim() }] });
      }
    });
    if (newUserMessage) {
      turns.push({ role: "user", parts: [{ text: newUserMessage.trim() }] });
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

  const connect = async () => {
    const url = wsUrl.trim();
    if (!url) {
      showError("Please enter a WebSocket URL");
      return;
    }

    try {
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        setConnectionStatus("Connected");
        showSuccess("Connected to WebSocket server");
        const setupMsg = {
          setup: {
            model: "gemini-2.0-flash-live-001",
            generationConfig: {
              responseModalities: ["TEXT"],
            },
            systemInstruction: systemInstruction.trim() || undefined,
            tools: toolsEnabled ? [{}] : undefined,
            ...(resumeHandle ? { sessionResumption: { handle: resumeHandle } } : {}),
          },
        };
        wsRef.current.send(JSON.stringify(setupMsg));
        if (resumeHandle) {
          console.log("[Client] Reconnected and sent setup with resume handle:", resumeHandle);
        }
        setResumeHandle(null);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleServerMessage(data);
        } catch (error) {
          console.error("[Client] Error parsing server message:", error);
        }
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setHasActiveSession(false);
        setConnectionStatus("Disconnected");
        setIsTyping(false);
        setCurrentResponse("");
        currentResponseRef.current = "";
        addSystemMessage(`Disconnected from server (Code: ${event.code})`);
        if (resumeHandle) {
          console.log("[Client] Disconnected, will attempt to reconnect with resume handle:", resumeHandle);
          setTimeout(() => {
            connect(true);
          }, 500);
        }
      };

      wsRef.current.onerror = (error) => {
        showError("WebSocket connection error");
        console.error("[Client] WebSocket error:", error);
      };
    } catch (error) {
      showError("Failed to connect: " + error.message);
    }
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      console.log("[Client] Manually disconnected from WebSocket server");
    }
  };

  // Distress score analysis (Gemini backend)
  const analyzeDistressScore = async (inputText) => {
    if (!inputText || inputText.trim() === '') return;
    try {
      console.log('[Distress] Sending text for distress score:', inputText); // Log input
      const response = await fetch(`${GEMINI_BACKEND_URL}/api/distress-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText })
      });
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      setDistressScore(data.score);
      // Log distress score and emotion immediately after update
      setTimeout(() => {
        console.log('[Distress] API response:', data); // Log full API response
        console.log('[Distress] Distress score for message:', data.score);
        console.log('[Distress] Emotion for message:', emotion.current);
      }, 0);
    } catch (err) {
      console.error('[Distress] Distress score analysis failed', err);
    }
  };

  const sendMessage = async () => {
    const message = (messageInput || input).trim();
    if (!message || !hasActiveSession || isTyping) {
      console.log("[Client] Cannot send message:", {
        message: !!message,
        hasActiveSession,
        isTyping,
      });
      return;
    }

    const turns = buildConversationTurns(message);
    const payload = {
      clientContent: {
        turns: turns,
        turnComplete: true,
        emotion: emotion.current,
      },
    };

    console.log("[Client] Sending message with payload:", payload);
    sendToServer(payload);

    addMessage("user", message);
    analyzeDistressScore(message);
    setMessageInput("");
    setInput("");
    setIsTyping(true);
    setCurrentResponse("");
    currentResponseRef.current = "";
  };

  const startSession = async () => {
    if (!isConnected) {
      showError("Not connected to server");
      return;
    }

    const message = (messageInput || input).trim();
    if (!message) {
      showError("Please enter a message to start the session.");
      return;
    }
    const turns = buildConversationTurns(message);

    const payload = {
      clientContent: {
        turns: turns,
        turnComplete: true,
        emotion: emotion.current,
      },
    };

    // Only log for the very first session start
    if (!hasActiveSession) {
      console.log("[Client] Starting session with payload:", payload);
    }
    sendToServer(payload);

    addMessage("user", message);
    setMessageInput("");
    setInput("");
    setIsTyping(true);
    setCurrentResponse("");
    currentResponseRef.current = "";
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (hasActiveSession) {
        sendMessage();
      } else {
        startSession();
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (hasActiveSession) {
        sendMessage();
      } else {
        startSession();
      }
    }
  };

  const handleSendMessage = () => {
    if (hasActiveSession) {
      sendMessage();
    } else {
      startSession();
    }
  };

  // Helper to get auth headers
  const getAuthHeaders = () => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Fetch chat sessions from Node backend
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${NODE_BACKEND_URL}/api/chat/sessions`, {
        headers: {
          ...getAuthHeaders(),
        },
      });
      const data = await res.json();
      setChatSessions(data.sessions || []);
      if (data.sessions && data.sessions.length > 0) {
        const savedActiveSession = localStorage.getItem("activeSession");
        if (savedActiveSession && data.sessions.find(s => s._id === savedActiveSession)) {
          setActiveSession(savedActiveSession);
        } else {
          setActiveSession(data.sessions[0]._id);
        }
      }
    } catch (err) {
      showError("Failed to fetch sessions");
      setChatSessions([]);
    }
  }, []);

  // Create a new session in Node backend
  const createSession = async () => {
    try {
      const res = await fetch(`${NODE_BACKEND_URL}/api/chat/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ sessionName: `Chat ${chatSessions.length + 1}` })
      });
      const data = await res.json();
      if (data.session) {
        setChatSessions(prev => [...prev, data.session]);
        setActiveSession(data.session._id);
        localStorage.setItem("activeSession", data.session._id);
        setMessages([{
          id: 1,
          type: "system",
          content: "New chat session started!",
          sender: "system",
          text: "New chat session started!",
        }]);
        messageIdRef.current = 2;
      }
    } catch (err) {
      showError("Failed to create session");
    }
  };

  // Fetch conversation history for a session from Node backend
  const fetchMessages = async (sessionId) => {
    try {
      const res = await fetch(`${NODE_BACKEND_URL}/api/chat/sessions/${sessionId}`, {
        headers: {
          ...getAuthHeaders(),
        },
      });
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages.map((msg, idx) => ({
          ...msg,
          id: idx + 1,
          sender: msg.type === 'user' ? 'user' : msg.type === 'model' ? 'bot' : 'system',
          text: msg.content,
        })));
        messageIdRef.current = data.messages.length + 1;
      } else {
        setMessages([]);
        messageIdRef.current = 1;
      }
    } catch (err) {
      showError("Failed to fetch messages");
      setMessages([]);
      messageIdRef.current = 1;
    }
  };

  // Save a message to Node backend
  const saveMessage = async (sessionId, message) => {
    try {
      console.log('[saveMessage] Sending to backend:', message);
      const res = await fetch(`${NODE_BACKEND_URL}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(message)
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[saveMessage] Backend responded with status ${res.status}:`, errorText);
      }
    } catch (err) {
      console.error("Failed to save message", err);
    }
  };

  // On mount, fetch sessions from backend
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // When switching sessions, fetch messages from backend
  useEffect(() => {
    if (activeSession) {
      fetchMessages(activeSession);
    }
  }, [activeSession]);

  // Update handleNewSession to use backend
  const handleNewSession = () => {
    createSession();
  };

  // Save user and model messages to backend after each exchange
  useEffect(() => {
    // Only save if last two messages are user and model
    if (!activeSession || messages.length < 2) return;
    const last = messages[messages.length - 1];
    const secondLast = messages[messages.length - 2];
    if (secondLast.type === 'user' && last.type === 'model') {
      // Save user message
      saveMessage(activeSession, {
        sender:"user",
        type: 'user',
        content: secondLast.content,
        emotion: emotion.current,
        distress: distressScore,
        timestamp: secondLast.timestamp,
      });
      // Save model message
      saveMessage(activeSession, {
        type: 'model',
        content: last.content,
        timestamp: last.timestamp,
      });
    }
  }, [messages, activeSession, emotion.current, distressScore]);

  // Emotion detection settings modal
  const handleConfigSubmit = (values) => {
    console.log("Config values:", values);
    setSystemInstruction(values.systemInstruction);
    setToolsEnabled(values.toolsEnabled);
    setShowConfig(false);
    showSuccess("Settings updated");
  };

  // Gemini session setup with context
  const setupGeminiSession = useCallback(async (sessionId) => {
    try {
      // Mock implementation - replace with actual API calls
      const userProfile = { name: "User", preferences: "helpful assistant" };
      const conversationHistory = [];
      
      const systemContext = {
        user_profile: userProfile,
        conversation_history: conversationHistory
      };
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          setup: {
            model: "gemini-2.0-flash-live-001",
            systemContext,
            systemInstruction: systemInstruction.trim() || undefined,
            tools: toolsEnabled ? [{}] : undefined,
          }
        }));
      }
    } catch (err) {
      console.error("Failed to setup Gemini session with context:", err);
    }
  }, [systemInstruction, toolsEnabled]);

  // Connect and setup session when active session changes
  useEffect(() => {
    if (!activeSession) return;
    
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connect();
    }
    
    const timeout = setTimeout(() => {
      setupGeminiSession(activeSession);
    }, 500);
    return () => clearTimeout(timeout);
  }, [activeSession, setupGeminiSession]);

  // Mock CameraTest component
  const CameraTest = ({ isVisible, onClose }) => (
    <Modal
      title="Camera Test"
      visible={isVisible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
      ]}
    >
      <div style={{ textAlign: 'center', padding: '20px' }}>
        <video ref={videoRef} autoPlay muted style={{ width: '100%', maxWidth: '300px' }} />
        <p>Current Emotion: {emotion.current || 'None detected'}</p>
        <Button 
          onClick={() => setEmotionDetectionEnabled(!emotionDetectionEnabled)}
          type={emotionDetectionEnabled ? "danger" : "primary"}
        >
          {emotionDetectionEnabled ? "Stop Detection" : "Start Detection"}
        </Button>
      </div>
    </Modal>
  );

  // Mock Loader component
  const Loader = () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100px' }}>
      <Spin size="large" />
    </div>
  );

  return (
    <>
      {/* Always render the hidden video and canvas for emotion detection */}
      <video ref={videoRef} style={{ display: 'none' }} autoPlay muted width="640" height="480" />
      <canvas ref={canvasRef} style={{ display: 'none' }} width="640" height="480" />
      <Layout style={{ height: '100vh' }}>
        <Sider
          width={250}
          collapsible
          collapsed={collapsed}
          collapsedWidth={50}
          onCollapse={(collapsed) => setCollapsed(collapsed)}
          style={{
            height: "100vh",
            background: "#f9a8d4",
            color: "#fff",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <h3 style={{ color: '#fff', margin: 0 }}>
              {!collapsed ? 'Chat Sessions' : '💬'}
            </h3>
          </div>
          
          <Menu
            theme="light"
            mode="inline"
            selectedKeys={[activeSession]}
            onClick={({ key }) => {
              setActiveSession(key);
              localStorage.setItem("activeSession", key);
              fetchMessages(key);
            }}
            style={{ background: 'transparent', border: 'none' }}
            items={chatSessions.map((session) => ({
              key: session._id,
              icon: <MessageOutlined />,
              label: !collapsed ? session.sessionName : '',
            }))}
          />
          
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleNewSession}
              style={{
                backgroundColor: "#ff4caf",
                borderColor: "#d9363e",
                color: "white",
                fontWeight: "bold",
                borderRadius: "8px",
                height: "40px",
              }}
            >
              {!collapsed && <span>New Chat</span>}
            </Button>

            <Button
              type="primary"
              icon={<PhoneOutlined />}
              onClick={() => setIsModalVisible(true)}
              style={{
                backgroundColor: "#007AFF",
                borderColor: "#0056b3",
                color: "white",
                fontWeight: "bold",
                borderRadius: "8px",
                height: "40px",
              }}
            >
              {!collapsed && <span>Make a Call</span>}
            </Button>

            <Button
              type="primary"
              icon={<CameraOutlined />}
              onClick={() => setEmotionDetectionEnabled((prev) => !prev)}
              style={{
                backgroundColor: emotionDetectionEnabled ? "#d32f2f" : "#4CAF50",
                borderColor: emotionDetectionEnabled ? "#b71c1c" : "#388E3C",
                color: "white",
                fontWeight: "bold",
                borderRadius: "8px",
                height: "40px",
              }}
            >
              {!collapsed && (
                <span>{emotionDetectionEnabled ? "Stop Emotion Capture" : "Capture Emotion"}</span>
              )}
            </Button>
          </div>
        </Sider>

        <Layout>
          <Content style={{ 
            padding: '20px', 
            display: 'flex', 
            flexDirection: 'column',
            height: '100vh',
            background: '#fff'
          }}>
            <motion.div 
              style={{ 
                flex: 1, 
                overflowY: 'auto', 
                marginBottom: '20px',
                padding: '10px',
                border: '1px solid #e8e8e8',
                borderRadius: '8px'
              }}
            >
              {messages.map((msg, index) => (
                <motion.div 
                  key={msg.id || index} 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    marginBottom: '15px',
                    padding: '10px',
                    borderRadius: '8px',
                    backgroundColor: msg.sender === 'user' ? '#e6f7ff' : 
                                   msg.sender === 'bot' ? '#f6ffed' : '#f0f0f0',
                    alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    marginLeft: msg.sender === 'user' ? 'auto' : '0',
                    marginRight: msg.sender === 'user' ? '0' : 'auto'
                  }}
                >
                  <div>
                    <strong>{msg.sender === 'user' ? 'You' : msg.sender === 'bot' ? 'Assistant' : 'System'}:</strong>
                  </div>
                  {msg.jsx ? (
                    msg.jsx
                  ) : (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: formatText(msg.text || msg.content),
                      }}
                    />
                  )}
                </motion.div>
              ))}
              
              {isTyping && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{
                    padding: '10px',
                    backgroundColor: '#f6ffed',
                    borderRadius: '8px',
                    marginBottom: '10px'
                  }}
                >
                  <strong>Assistant:</strong> {currentResponse}
                  <Spin size="small" style={{ marginLeft: '10px' }} />
                </motion.div>
              )}
              
              {loading && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(255,255,255,0.8)',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  zIndex: 1000
                }}>
                  <Loader />
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </motion.div>

            <div style={{ 
              display: 'flex', 
              gap: '10px', 
              alignItems: 'center',
              padding: '10px',
              background: '#fafafa',
              borderRadius: '8px'
            }}>
              <Input
                value={input || messageInput}
                onChange={(e) => {
                  setInput(e.target.value);
                  setMessageInput(e.target.value);
                }}
                onKeyPress={handleKeyPress}
                placeholder="Ask what you want..."
                style={{ flex: 1 }}
              />

              <Button
                icon={<AudioOutlined />}
                onClick={() => {
                  if (listening) {
                    setListening(false);
                    console.log("Stopped listening");
                  } else {
                    resetTranscript();
                    setListening(true);
                    console.log("Started listening");
                  }
                }}
                type={listening ? "danger" : "default"}
              />

              <Button 
                icon={<SendOutlined />} 
                onClick={handleSendMessage}
                type="primary"
                disabled={isTyping}
              />
            </div>
            
            {audioUrl && (
              <Button 
                onClick={handlePlayAudio}
                style={{ marginTop: '10px', alignSelf: 'center' }}
              >
                🔊 Play Audio Response
              </Button>
            )}
          </Content>
        </Layout>
      </Layout>

      {/* <Modal
        title="Make a Call"
        visible={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setIsModalVisible(false)}>
            Cancel
          </Button>,
          <Button key="call" type="primary" onClick={handleCallUser}>
            Call Now
          </Button>,
        ]}
      > */}
        {/* <p>Enter your phone number and message to receive a call:</p>
        <Input
          type="tel"
          placeholder="Enter phone number"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
        />
        <Input
          type="text"
          placeholder="Enter message"
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
          style={{ marginTop: "10px" }}
        />
      </Modal> */}
  
  </>
  );
};

export default ChatPage;
