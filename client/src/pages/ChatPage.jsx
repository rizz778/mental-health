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
import SpeechRecognition, {
  useSpeechRecognition,
} from "react-speech-recognition";
import axios from "axios";
import "./ChatPage.css";
import { useNavigate } from "react-router-dom";
import Loader from "../components/Loader.jsx";
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

  const [emotion, setEmotion] = useState({ current: "", aggregated: "" });
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!emotionDetectionEnabled) return;
    let interval;
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        interval = setInterval(() => {
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (canvas && video) {
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL("image/jpeg");
            const base64 = dataURL.split(",")[1];
            ws.send(JSON.stringify({ frame: base64 }));
          }
        }, 1000);
      })
      .catch((err) => console.error("Error accessing webcam:", err));

    return () => {
      if (interval) clearInterval(interval);
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
    };
  }, [emotionDetectionEnabled]);

  // Messages and input
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: "system",
      content: "Welcome to Live API Chat Demo! Connect to the WebSocket server and start a session to begin chatting.",
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

  // Session resumption handle
  const [sessionHandle, setSessionHandle] = useState(null);
  const [resumeHandle, setResumeHandle] = useState(null);
  const [shouldReconnect, setShouldReconnect] = useState(false);

  const [distressScore, setDistressScore] = useState(null);

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
          addMessage("model", currentResponseRef.current);
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
    
    if (data.setupComplete !== undefined) {
      setHasActiveSession(true);
      addSystemMessage("Session setup complete - You can now send messages");
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
          addMessage("model", currentResponseRef.current);
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

  // Helper functions
  const addMessage = (type, content) => {
    if (type !== "user" && type !== "model" && type !== "system") return;
    const newMessage = {
      id: messageIdRef.current++,
      type,
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  const addSystemMessage = (content) => {
    addMessage("system", content);
  };

  const showError = (message) => {
    setErrorMessage(message);
    console.error("[Client] Error:", message);
  };

  const showSuccess = (message) => {
    setSuccessMessage(message);
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
      const response = await fetch(`${GEMINI_BACKEND_URL}/api/distress-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText })
      });
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      setDistressScore(data.score);
      console.log(data.score);
    } catch (err) {
      console.error('Distress score analysis failed', err);
    }
  };

  const startSession = async () => {
    if (!isConnected) {
      showError("Not connected to server");
      return;
    }

    const message = messageInput.trim();
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

    console.log("[Client] Starting session with payload:", payload);
    sendToServer(payload);

    addMessage("user", message);
    setMessageInput("");
    setIsTyping(true);
    setCurrentResponse("");
    currentResponseRef.current = "";
  };

  const endSession = async () => {
    if (!hasActiveSession) return;

    sendToServer({
      type: "end_session",
    });
    console.log("[Client] End session request sent");
  };

  const sendMessage = async () => {
    const message = messageInput.trim();
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
    setIsTyping(true);
    setCurrentResponse("");
    currentResponseRef.current = "";
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

  const toggleTools = () => {
    setToolsEnabled(!toolsEnabled);
  };

  const toggleConfig = () => {
    setShowConfig(!showConfig);
  };

  const clearChat = () => {
    setMessages([
      {
        id: 1,
        type: "system",
        content: "Chat cleared. Welcome to Live API Chat Demo!",
      },
    ]);
    messageIdRef.current = 2;
    setTotalTokens(0);
    setSessionHandle(null);
    setCurrentResponse("");
    currentResponseRef.current = "";
    setIsTyping(false);
    console.log("[Client] Chat cleared");
  };

  const saveConfig = () => {
    showSuccess("Configuration saved");
    setShowConfig(false);
    console.log("[Client] Configuration saved:", {
      systemInstruction,
      wsUrl,
      toolsEnabled,
    });
  };

  // Fetch user profile and conversation history, then send as system instruction/context to Gemini backend via WebSocket
  const setupGeminiSession = useCallback(async (sessionId) => {
    try {
      // Fetch user profile
      const token = localStorage.getItem("token");
      const userProfileRes = await axios.get(`${NODE_BACKEND_URL}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { profilePicture, ...userProfile } = userProfileRes.data;
      // Fetch conversation history
      const historyRes = await axios.get(`${NODE_BACKEND_URL}/api/chat/sessions/${sessionId}`,
        { headers: { Authorization: `Bearer ${token}` } });
      const conversationHistory = (historyRes.data.messages || []).filter(
        (m) => m.sender === "user" || m.sender === "bot"
      );
      // Build system instruction/context
      const systemContext = {
        user_profile: userProfile,
        conversation_history: conversationHistory.map(msg => ({
          role: msg.sender === "user" ? "user" : "model",
          text: msg.text,
          timestamp: msg.timestamp
        }))
      };
      // Send to Gemini backend via WebSocket
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

  // On mount or when a new session is created, connect and send context
  useEffect(() => {
    if (!activeSession) return;
    // Connect WebSocket if not connected
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connect();
    }
    // After a short delay to ensure connection, send context
    const timeout = setTimeout(() => {
      setupGeminiSession(activeSession);
    }, 500);
    return () => clearTimeout(timeout);
  }, [activeSession, connect, setupGeminiSession]);

  return (
    <>
    <Layout>
      <Sider
  width={250}
  collapsible
  collapsedWidth={50}
  onCollapse={(collapsed) => setCollapsed(collapsed)}
  style={{
    height: "90vh",
    background: "#f9a8d4",
    color: "#fff",
    overflow: "hidden",
  }}
>
  <div
    style={{ marginBottom: "16px", fontSize: "16px", fontWeight: "bold" }}
  ></div>
  <Menu
    theme="light"
    mode="inline"
    selectedKeys={[activeSession]}
    onClick={({ key }) => {
      setActiveSession(key);
      localStorage.setItem("activeSession", key);
      fetchMessages(key);
    }}
    items={chatSessions.map((session) => ({
      key: session._id,
      icon: <MessageOutlined />,
      label: session.sessionName,
    }))}
  />
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
      padding: "10px 16px",
      height: "2.5rem",
      marginBottom: "10px",
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
      padding: "10px 16px",
      height: "2.5rem",
      width: "100%",
    }}
  >
    {!collapsed && <span>Make a Call</span>}
  </Button>

  <Button
    type="primary"
    icon={<CameraOutlined />}
    onClick={() => setCameraTestVisible(true)} // Open the CameraTest modal
    style={{
      backgroundColor: "#4CAF50",
      borderColor: "#388E3C",
      color: "white",
      fontWeight: "bold",
      borderRadius: "8px",
      padding: "10px 16px",
      height: "2.5rem",
      width: "100%",
      marginTop: "10px",
    }}
  >
    {!collapsed && <span>Capture Emotion</span>}
  </Button>

  {/* <Button onClick={handleCapture} disabled={loading}>
    {loading ? "Detecting..." : "Capture Emotion"}
  </Button> */}
</Sider>
      <Layout>
        <Content className="chat-content">
          <motion.div className="chat-messages">
            {messages.map((msg, index) => (
              <motion.div key={index} className={`chat-message ${msg.sender}`}>
                {msg.jsx ? (
                  msg.jsx // Render JSX directly if present (for distress message)
                ) : (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: formatText(msg.text), // Otherwise, format & render text
                    }}
                  />
                )}
              </motion.div>
            ))}
            {loading && (
              <div className="full-screen-loader">
                <Loader />
              </div>
            )}
          </motion.div>

          <div className="chat-input-container">
            {/* <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask what you want..."
            /> */}
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask what you want..."
            />

            {/* <Button
              icon={<AudioOutlined />}
              onClick={() => {
                listening
                  ? SpeechRecognition.stopListening()
                  : SpeechRecognition.startListening();
              }}
            /> */}

            <Button
              icon={<AudioOutlined />}
              onClick={() => {
                if (listening) {
                  SpeechRecognition.stopListening();
                } else {
                  resetTranscript(); // reset before new listening
                  SpeechRecognition.startListening({ continuous: false });
                }
              }}
            />

            <Button icon={<SendOutlined />} onClick={handleSendMessage} />
          </div>
          {audioUrl && (
            <Button className="btn" onClick={handlePlayAudio}>
              Audio Response
            </Button>
          )}
        </Content>
      </Layout>
      {/* Call Form Modal */}

      <Modal
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
      >
        <p>Enter your phone number and message to receive a call:</p>
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
      </Modal>
    </Layout>
    <CameraTest
    isVisible={isCameraTestVisible}
    onClose={() => setCameraTestVisible(false)} // Close the modal
  />
  </>
  );
};

export default ChatPage;
