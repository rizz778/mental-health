// src/App.js
import React, { useState, useEffect, useRef } from "react";

function Test() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = new WebSocket("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent");

    socketRef.current.onmessage = (event) => {
      setMessages((prev) => [...prev, { sender: "bot", text: event.data }]);
    };

    return () => socketRef.current.close();
  }, []);

  const sendMessage = () => {
    if (input.trim()) {
      socketRef.current.send(input);
      setMessages((prev) => [...prev, { sender: "user", text: input }]);
      setInput("");
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "Arial" }}>
      <h2>Mental Health Chat</h2>
      <div style={{ height: 400, overflowY: "auto", border: "1px solid #ccc", padding: 10 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ textAlign: msg.sender === "user" ? "right" : "left" }}>
            <b>{msg.sender === "user" ? "You" : "Bot"}:</b> {msg.text}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type your message..."
          style={{ width: "80%", padding: 8 }}
        />
        <button onClick={sendMessage} style={{ padding: "8px 16px", marginLeft: 5 }}>Send</button>
      </div>
    </div>
  );
}

export default Test;
