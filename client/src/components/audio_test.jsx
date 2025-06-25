import React, { useState, useRef, useEffect, useCallback } from "react";

const AudioRecorder = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Not Connected");
  const [responses, setResponses] = useState([]);
  const [debugLogs, setDebugLogs] = useState([]);

  const websocketRef = useRef(null);
  const audioContextRef = useRef(null);
  const workletNodeRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);
  const isProcessingRef = useRef(false);
  // Add a ref to track recording state for use in callbacks
  const isRecordingRef = useRef(false);
  // Add a ref to track if component is mounting for the first time
  const isMountingRef = useRef(true);
  // Add throttling ref
  const lastSendTimeRef = useRef(0);

  // Add connection persistence
  const connectionIdRef = useRef(Math.random().toString(36).substr(2, 9));

  // Prevent cleanup during development double-mounting
  useEffect(() => {
    if (isMountingRef.current) {
      isMountingRef.current = false;
      console.log(
        `[AudioRecorder] Initial component mount - Connection ID: ${connectionIdRef.current}`
      );
    } else {
      console.log(
        `[AudioRecorder] Component remount detected (likely React StrictMode) - Connection ID: ${connectionIdRef.current}`
      );
    }
  }, []);

  // Update the ref whenever the state changes
  useEffect(() => {
    isRecordingRef.current = isRecording;
    console.log(`[AudioRecorder] Updated isRecordingRef to: ${isRecording}`);
  }, [isRecording]);

  // Utility function to add debug logs
  const addLog = useCallback((message) => {
    console.log(`[AudioRecorder] ${message}`);
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs((prev) => {
      const newLogs = [...prev, `${timestamp}: ${message}`];
      return newLogs.slice(-50); // Keep only last 50 logs to prevent memory issues
    });
  }, []);

  // Add response to the UI
  const addResponse = useCallback((type, content) => {
    console.log(
      `[AudioRecorder] Adding response - Type: ${type}, Content: ${content}`
    );
    setResponses((prev) => {
      const newResponses = [
        ...prev,
        { type, content, timestamp: new Date().toLocaleTimeString() },
      ];
      return newResponses.slice(-20); // Keep only last 20 responses
    });
  }, []);

  // Convert Float32Array to 16-bit PCM
  const float32To16BitPCM = useCallback((float32Array) => {
    console.log(
      `[AudioRecorder] Converting Float32Array to PCM - Length: ${float32Array.length}`
    );
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    console.log(
      `[AudioRecorder] PCM conversion complete - Buffer size: ${buffer.byteLength} bytes`
    );
    return buffer;
  }, []);

  // Convert ArrayBuffer to base64
  const arrayBufferToBase64 = useCallback((buffer) => {
    console.log(
      `[AudioRecorder] Converting ArrayBuffer to base64 - Size: ${buffer.byteLength} bytes`
    );
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    console.log(
      `[AudioRecorder] Base64 conversion complete - Length: ${base64.length} chars`
    );
    return base64;
  }, []);

  // Send audio data with throttling
  const sendAudioData = useCallback(
    (audioData) => {
      const now = Date.now();
      const timeSinceLastSend = now - lastSendTimeRef.current;

      console.log(
        `[AudioRecorder] sendAudioData called - Time since last send: ${timeSinceLastSend}ms`
      );

      if (timeSinceLastSend < 100) {
        // Throttle to max 10 chunks per second
        console.log(
          `[AudioRecorder] Throttling audio data - too soon (${timeSinceLastSend}ms < 100ms)`
        );
        return;
      }

      if (
        websocketRef.current &&
        websocketRef.current.readyState === WebSocket.OPEN &&
        !isProcessingRef.current
      ) {
        try {
          isProcessingRef.current = true;
          console.log(
            `[AudioRecorder] Sending audio chunk - Data length: ${audioData.length} chars`
          );

          const message = {
            type: "audio_chunk",
            data: audioData,
          };

          websocketRef.current.send(JSON.stringify(message));
          lastSendTimeRef.current = now;
          console.log(`[AudioRecorder] Audio chunk sent successfully`);
        } catch (error) {
          console.error(`[AudioRecorder] Error sending audio:`, error);
          addLog(`Error sending audio: ${error.message}`);
        } finally {
          isProcessingRef.current = false;
        }
      } else {
        console.log(
          `[AudioRecorder] Cannot send audio data - WebSocket state:`,
          websocketRef.current?.readyState,
          "isProcessing:",
          isProcessingRef.current
        );
      }
    },
    [addLog]
  );

  // WebSocket connection with improved error handling
  const connect = useCallback(async () => {
    console.log(`[AudioRecorder] Connect function called`);
    console.log(
      `[AudioRecorder] Current WebSocket state:`,
      websocketRef.current?.readyState
    );

    try {
      if (
        websocketRef.current &&
        websocketRef.current.readyState === WebSocket.OPEN
      ) {
        console.log(
          `[AudioRecorder] Already connected, skipping connection attempt`
        );
        addLog("Already connected");
        return;
      }

      console.log(
        `[AudioRecorder] Initiating WebSocket connection to ws://localhost:8000/`
      );
      addLog("Connecting to WebSocket...");
      websocketRef.current = new WebSocket("ws://localhost:8000/");

      // Set up connection timeout
      const connectionTimeout = setTimeout(() => {
        console.log(`[AudioRecorder] Connection timeout triggered`);
        if (
          websocketRef.current &&
          websocketRef.current.readyState === WebSocket.CONNECTING
        ) {
          websocketRef.current.close();
          addLog("Connection timeout");
        }
      }, 10000);

      websocketRef.current.onopen = async () => {
        console.log(`[AudioRecorder] WebSocket onopen event triggered`);
        clearTimeout(connectionTimeout);
        addLog("WebSocket connected");
        setStatus("Connected");
        setIsConnected(true);

        // Send setup message
        const setupMessage = {
          setup: {
            model: "gemini-2.0-flash-live-001",
            generationConfig: {
              responseModalities: ["AUDIO"],
            },
            systemInstruction:
              "You are a helpful AI assistant. Provide clear and concise responses.",
          },
        };

        console.log(`[AudioRecorder] Sending setup message:`, setupMessage);

        try {
          websocketRef.current.send(JSON.stringify(setupMessage));
          console.log(`[AudioRecorder] Setup message sent successfully`);
          addLog("Setup message sent");
        } catch (error) {
          console.error(`[AudioRecorder] Error sending setup:`, error);
          addLog(`Error sending setup: ${error.message}`);
        }
      };

      websocketRef.current.onmessage = (event) => {
        console.log(`[AudioRecorder] WebSocket onmessage event triggered`);
        console.log(`[AudioRecorder] Raw message data:`, event.data);

        try {
          const data = JSON.parse(event.data);
          console.log(`[AudioRecorder] Parsed message data:`, data);
          addLog(`Received: ${data.type || "unknown"}`);

          if (data.setupComplete) {
            console.log(`[AudioRecorder] Setup completed successfully`);
            addLog("Setup completed successfully");
            setStatus("Ready");
          } else if (data.type === "text_response") {
            console.log(
              `[AudioRecorder] Received text response:`,
              data.content
            );
            addResponse("Text Response", data.content);
          } else if (data.type === "audio_response") {
            console.log(
              `[AudioRecorder] Received audio response - Data length:`,
              data.content?.length || 0
            );
            addResponse("Audio Response", `Received audio data`);
            playAudioResponse(data.content);
          } else if (data.type === "recording_started") {
            console.log(`[AudioRecorder] Server confirmed recording started`);
            addLog("Recording started on server");
          } else if (data.type === "recording_stopped") {
            console.log(`[AudioRecorder] Server confirmed recording stopped`);
            addLog("Recording stopped on server");
          } else if (data.error) {
            console.error(`[AudioRecorder] Server error:`, data.error);
            addLog(`Server Error: ${data.error}`);
            addResponse("Error", data.error);
          } else {
            console.log(`[AudioRecorder] Unknown message type:`, data);
          }
        } catch (e) {
          console.error(`[AudioRecorder] Error parsing message:`, e);
          console.log(
            `[AudioRecorder] Raw message that failed to parse:`,
            event.data
          );
          addLog(`Error parsing message: ${e.message}`);
        }
      };

      websocketRef.current.onerror = (error) => {
        console.error(`[AudioRecorder] WebSocket error event:`, error);
        clearTimeout(connectionTimeout);
        addLog(`WebSocket error: ${error.type || "Unknown error"}`);
        setStatus("Error");
      };

      websocketRef.current.onclose = (event) => {
        console.log(
          `[AudioRecorder] WebSocket onclose event - Code: ${event.code}, Reason: ${event.reason} - Connection ID: ${connectionIdRef.current}`
        );
        clearTimeout(connectionTimeout);
        addLog(
          `WebSocket closed: ${event.code} - ${event.reason || "No reason"}`
        );

        // Only update state if this is not due to component remounting
        if (!isMountingRef.current) {
          setStatus("Disconnected");
          setIsConnected(false);
          setIsRecording(false);

          // Clean up audio resources on disconnect
          cleanupAudioResources();
        } else {
          console.log(
            `[AudioRecorder] Ignoring close event during component remount`
          );
        }
      };
    } catch (error) {
      console.error(`[AudioRecorder] Connection error:`, error);
      addLog(`Connection error: ${error.message}`);
      setStatus("Error");
    }
  }, [addLog, addResponse]);

  // Play audio response with better error handling
  const playAudioResponse = useCallback(
    async (base64Audio) => {
      console.log(
        `[AudioRecorder] playAudioResponse called with data length:`,
        base64Audio?.length || 0
      );

      try {
        if (!base64Audio) {
          console.log(
            `[AudioRecorder] No audio data provided to playAudioResponse`
          );
          addLog("No audio data to play");
          return;
        }

        console.log(`[AudioRecorder] Decoding base64 audio data...`);
        const audioData = atob(base64Audio);
        console.log(
          `[AudioRecorder] Decoded audio data length:`,
          audioData.length
        );

        const audioBuffer = new ArrayBuffer(audioData.length);
        const audioView = new Uint8Array(audioBuffer);
        for (let i = 0; i < audioData.length; i++) {
          audioView[i] = audioData.charCodeAt(i);
        }

        console.log(`[AudioRecorder] Creating AudioContext for playback...`);
        const audioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
        console.log(
          `[AudioRecorder] AudioContext created - Sample rate:`,
          audioContext.sampleRate
        );

        console.log(`[AudioRecorder] Decoding audio data...`);
        const decodedBuffer = await audioContext.decodeAudioData(audioBuffer);
        console.log(
          `[AudioRecorder] Audio decoded - Duration:`,
          decodedBuffer.duration,
          "seconds"
        );

        const source = audioContext.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(audioContext.destination);

        console.log(`[AudioRecorder] Starting audio playback...`);
        source.start();
        addLog("Playing audio response");

        // Clean up audio context after playback
        source.onended = () => {
          console.log(`[AudioRecorder] Audio playback ended, closing context`);
          audioContext.close();
        };
      } catch (error) {
        console.error(`[AudioRecorder] Error playing audio:`, error);
        addLog(`Error playing audio: ${error.message}`);
      }
    },
    [addLog]
  );

  // Clean up audio resources
  const cleanupAudioResources = useCallback(() => {
    console.log(`[AudioRecorder] cleanupAudioResources called`);

    try {
      isProcessingRef.current = false;
      console.log(`[AudioRecorder] Set isProcessingRef to false`);

      if (workletNodeRef.current) {
        console.log(`[AudioRecorder] Disconnecting worklet node`);
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }

      if (sourceRef.current) {
        console.log(`[AudioRecorder] Disconnecting source node`);
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }

      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        console.log(
          `[AudioRecorder] Closing audio context - Current state:`,
          audioContextRef.current.state
        );
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      if (streamRef.current) {
        console.log(`[AudioRecorder] Stopping media stream tracks`);
        streamRef.current.getTracks().forEach((track, index) => {
          console.log(
            `[AudioRecorder] Stopping track ${index}:`,
            track.kind,
            track.label
          );
          track.stop();
        });
        streamRef.current = null;
      }

      console.log(`[AudioRecorder] Audio resources cleanup completed`);
      addLog("Audio resources cleaned up");
    } catch (error) {
      console.error(`[AudioRecorder] Error cleaning up audio:`, error);
      addLog(`Error cleaning up audio: ${error.message}`);
    }
  }, [addLog]);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    console.log(
      `[AudioRecorder] disconnect called - isRecording:`,
      isRecording
    );

    try {
      if (isRecording) {
        console.log(`[AudioRecorder] Stopping recording before disconnect`);
        stopRecording();
      }

      if (websocketRef.current) {
        console.log(`[AudioRecorder] Closing WebSocket connection`);
        websocketRef.current.close(1000, "Client disconnect");
        websocketRef.current = null;
      }

      setIsConnected(false);
      setStatus("Disconnected");
      console.log(`[AudioRecorder] Disconnect completed`);
      addLog("Disconnected");
    } catch (error) {
      console.error(`[AudioRecorder] Error disconnecting:`, error);
      addLog(`Error disconnecting: ${error.message}`);
    }
  }, [isRecording, addLog]);

  // Start recording with modern Web Audio API
  const startRecording = useCallback(async () => {
    console.log(
      `[AudioRecorder] startRecording called - Current state: isRecording=${isRecording}, isConnected=${isConnected}`
    );

    try {
      if (isRecording) {
        console.log(`[AudioRecorder] Already recording, skipping start`);
        addLog("Already recording");
        return;
      }

      console.log(`[AudioRecorder] Requesting microphone access...`);
      addLog("Requesting microphone access...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log(
        `[AudioRecorder] Microphone access granted - Stream tracks:`,
        stream.getTracks().length
      );
      stream.getTracks().forEach((track, index) => {
        console.log(
          `[AudioRecorder] Track ${index}:`,
          track.kind,
          track.label,
          `enabled=${track.enabled}`
        );
      });

      streamRef.current = stream;

      console.log(`[AudioRecorder] Creating AudioContext...`);
      audioContextRef.current = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 16000,
      });

      console.log(
        `[AudioRecorder] AudioContext created - State:`,
        audioContextRef.current.state,
        "Sample rate:",
        audioContextRef.current.sampleRate
      );

      // Resume audio context if suspended
      if (audioContextRef.current.state === "suspended") {
        console.log(`[AudioRecorder] AudioContext suspended, resuming...`);
        await audioContextRef.current.resume();
        console.log(
          `[AudioRecorder] AudioContext resumed - New state:`,
          audioContextRef.current.state
        );
      }

      console.log(`[AudioRecorder] Creating MediaStreamSource...`);
      sourceRef.current =
        audioContextRef.current.createMediaStreamSource(stream);

      // Use AudioWorklet if available, fallback to ScriptProcessor
      if (audioContextRef.current.audioWorklet) {
        console.log(
          `[AudioRecorder] AudioWorklet available, attempting to use...`
        );

        try {
          // Create a simple processor inline
          const processorCode = `
            class AudioProcessor extends AudioWorkletProcessor {
              process(inputs, outputs, parameters) {
                const input = inputs[0];
                if (input.length > 0) {
                  const inputChannel = input[0];
                  this.port.postMessage(inputChannel);
                }
                return true;
              }
            }
            registerProcessor('audio-processor', AudioProcessor);
          `;

          console.log(`[AudioRecorder] Creating AudioWorklet processor...`);
          const blob = new Blob([processorCode], {
            type: "application/javascript",
          });
          const processorUrl = URL.createObjectURL(blob);

          await audioContextRef.current.audioWorklet.addModule(processorUrl);
          console.log(`[AudioRecorder] AudioWorklet module added successfully`);

          workletNodeRef.current = new AudioWorkletNode(
            audioContextRef.current,
            "audio-processor"
          );
          console.log(`[AudioRecorder] AudioWorkletNode created`);

          workletNodeRef.current.port.onmessage = (event) => {
            // Use the ref instead of the state variable
            if (!isRecordingRef.current) {
              console.log(
                `[AudioRecorder] AudioWorklet received data but not recording (ref=${isRecordingRef.current}), ignoring`
              );
              return;
            }

            const inputBuffer = event.data;
            console.log(
              `[AudioRecorder] AudioWorklet received buffer - Length:`,
              inputBuffer.length
            );

            const pcmData = float32To16BitPCM(inputBuffer);
            const base64Data = arrayBufferToBase64(pcmData);
            sendAudioData(base64Data);
          };

          sourceRef.current.connect(workletNodeRef.current);
          console.log(`[AudioRecorder] AudioWorklet setup completed`);
        } catch (workletError) {
          console.error(`[AudioRecorder] AudioWorklet failed:`, workletError);
          addLog(
            `AudioWorklet failed, using ScriptProcessor: ${workletError.message}`
          );

          // Fallback to ScriptProcessor
          console.log(`[AudioRecorder] Falling back to ScriptProcessor...`);
          workletNodeRef.current =
            audioContextRef.current.createScriptProcessor(4096, 1, 1);
          console.log(
            `[AudioRecorder] ScriptProcessor created with buffer size 4096`
          );

          workletNodeRef.current.onaudioprocess = (event) => {
            // Use the ref instead of the state variable
            if (!isRecordingRef.current) {
              console.log(
                `[AudioRecorder] ScriptProcessor received data but not recording (ref=${isRecordingRef.current}), ignoring`
              );
              return;
            }

            const inputBuffer = event.inputBuffer.getChannelData(0);
            console.log(
              `[AudioRecorder] ScriptProcessor received buffer - Length:`,
              inputBuffer.length
            );

            const pcmData = float32To16BitPCM(inputBuffer);
            const base64Data = arrayBufferToBase64(pcmData);
            sendAudioData(base64Data);
          };

          sourceRef.current.connect(workletNodeRef.current);
          workletNodeRef.current.connect(audioContextRef.current.destination);
          console.log(`[AudioRecorder] ScriptProcessor setup completed`);
        }
      } else {
        console.log(
          `[AudioRecorder] AudioWorklet not available, using ScriptProcessor`
        );
        // Direct ScriptProcessor fallback
        workletNodeRef.current = audioContextRef.current.createScriptProcessor(
          4096,
          1,
          1
        );

        workletNodeRef.current.onaudioprocess = (event) => {
          // Use the ref instead of the state variable
          if (!isRecordingRef.current) return;

          const inputBuffer = event.inputBuffer.getChannelData(0);
          const pcmData = float32To16BitPCM(inputBuffer);
          const base64Data = arrayBufferToBase64(pcmData);
          sendAudioData(base64Data);
        };

        sourceRef.current.connect(workletNodeRef.current);
        workletNodeRef.current.connect(audioContextRef.current.destination);
      }

      // Send start recording message
      if (
        websocketRef.current &&
        websocketRef.current.readyState === WebSocket.OPEN
      ) {
        console.log(
          `[AudioRecorder] Sending start_recording message to server...`
        );
        websocketRef.current.send(
          JSON.stringify({
            type: "start_recording",
          })
        );
        console.log(`[AudioRecorder] start_recording message sent`);
      } else {
        console.log(
          `[AudioRecorder] Cannot send start_recording - WebSocket not ready`
        );
      }

      setIsRecording(true);
      console.log(`[AudioRecorder] Recording started successfully`);
      addLog("Recording started");
    } catch (error) {
      console.error(`[AudioRecorder] Error starting recording:`, error);
      addLog(`Error starting recording: ${error.message}`);
      cleanupAudioResources();
    }
  }, [
    isRecording,
    isConnected,
    float32To16BitPCM,
    arrayBufferToBase64,
    addLog,
    sendAudioData,
    cleanupAudioResources,
  ]);

  // Stop recording
  const stopRecording = useCallback(() => {
    console.log(
      `[AudioRecorder] stopRecording called - Current state: isRecording=${isRecording}`
    );

    if (!isRecording) {
      console.log(`[AudioRecorder] Not currently recording, skipping stop`);
      addLog("Not currently recording");
      return;
    }

    setIsRecording(false);
    console.log(`[AudioRecorder] Set isRecording to false`);

    // Send stop recording message
    if (
      websocketRef.current &&
      websocketRef.current.readyState === WebSocket.OPEN
    ) {
      try {
        console.log(
          `[AudioRecorder] Sending stop_recording message to server...`
        );
        websocketRef.current.send(
          JSON.stringify({
            type: "stop_recording",
          })
        );
        console.log(`[AudioRecorder] stop_recording message sent`);
      } catch (error) {
        console.error(`[AudioRecorder] Error sending stop message:`, error);
        addLog(`Error sending stop message: ${error.message}`);
      }
    } else {
      console.log(
        `[AudioRecorder] Cannot send stop_recording - WebSocket not ready`
      );
    }

    cleanupAudioResources();
    console.log(`[AudioRecorder] Recording stopped successfully`);
    addLog("Recording stopped");
  }, [isRecording, addLog, cleanupAudioResources]);

  // Cleanup on unmount - Remove dependencies to prevent unnecessary cleanups
  useEffect(() => {
    console.log(`[AudioRecorder] Component mounted, setting up cleanup effect`);

    return () => {
      console.log(`[AudioRecorder] Component unmounting, cleaning up...`);

      // Only cleanup if we actually have active resources
      if (isRecording) {
        console.log(`[AudioRecorder] Stopping recording during unmount`);
        setIsRecording(false);
      }

      if (
        websocketRef.current &&
        websocketRef.current.readyState === WebSocket.OPEN
      ) {
        console.log(`[AudioRecorder] Closing WebSocket during unmount`);
        websocketRef.current.close(1000, "Component unmount");
      }

      // Clean up audio resources
      if (
        audioContextRef.current ||
        streamRef.current ||
        workletNodeRef.current ||
        sourceRef.current
      ) {
        console.log(
          `[AudioRecorder] Cleaning up audio resources during unmount`
        );

        try {
          if (workletNodeRef.current) {
            workletNodeRef.current.disconnect();
            workletNodeRef.current = null;
          }

          if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
          }

          if (
            audioContextRef.current &&
            audioContextRef.current.state !== "closed"
          ) {
            audioContextRef.current.close();
            audioContextRef.current = null;
          }

          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }
        } catch (error) {
          console.error(`[AudioRecorder] Error during unmount cleanup:`, error);
        }
      }

      console.log(`[AudioRecorder] Component cleanup completed`);
    };
  }, []); // Empty dependency array to prevent re-running

  // Debug effect to log state changes
  useEffect(() => {
    console.log(
      `[AudioRecorder] State change - Status: ${status}, Connected: ${isConnected}, Recording: ${isRecording}`
    );
  }, [status, isConnected, isRecording]);
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Voice Chat with Gemini</h1>

      <div className="flex flex-wrap gap-4 mb-6">
        <button
          onClick={() => {
            console.log(`[AudioRecorder] Connect button clicked`);
            connect();
          }}
          disabled={isConnected}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300 hover:bg-blue-600"
        >
          Connect
        </button>
        <button
          onClick={() => {
            console.log(`[AudioRecorder] Disconnect button clicked`);
            disconnect();
          }}
          disabled={!isConnected}
          className="px-4 py-2 bg-gray-500 text-white rounded disabled:bg-gray-300 hover:bg-gray-600"
        >
          Disconnect
        </button>
        <button
          onClick={() => {
            console.log(`[AudioRecorder] Start Recording button clicked`);
            startRecording();
          }}
          disabled={!isConnected || isRecording}
          className="px-4 py-2 bg-green-500 text-white rounded disabled:bg-gray-300 hover:bg-green-600"
        >
          Start Recording
        </button>
        <button
          onClick={() => {
            console.log(`[AudioRecorder] Stop Recording button clicked`);
            stopRecording();
          }}
          disabled={!isRecording}
          className="px-4 py-2 bg-red-500 text-white rounded disabled:bg-gray-300 hover:bg-red-600"
        >
          Stop Recording
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-100 p-4 rounded">
          <p>
            <strong>Status:</strong>{" "}
            <span
              className={`font-semibold ${
                status === "Ready"
                  ? "text-green-600"
                  : status === "Error"
                  ? "text-red-600"
                  : "text-yellow-600"
              }`}
            >
              {status}
            </span>
          </p>
          <p>
            <strong>Recording:</strong>{" "}
            <span
              className={`font-semibold ${
                isRecording ? "text-red-600" : "text-gray-600"
              }`}
            >
              {isRecording ? "Recording..." : "Not Recording"}
            </span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="text-xl font-semibold mb-3">Gemini Responses:</h3>
          <div className="border border-gray-300 p-4 h-64 overflow-y-auto bg-gray-50 rounded">
            {responses.length === 0 ? (
              <p className="text-gray-500 italic">No responses yet...</p>
            ) : (
              responses.map((response, index) => (
                <div
                  key={index}
                  className="mb-3 p-2 bg-white rounded shadow-sm"
                >
                  <strong className="text-blue-600">{response.type}:</strong>{" "}
                  {response.content}
                  <br />
                  <small className="text-gray-500">{response.timestamp}</small>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xl font-semibold mb-3">Debug Log:</h3>
          <div className="border border-gray-300 p-4 h-64 overflow-y-auto bg-gray-900 text-green-400 rounded font-mono text-sm">
            {debugLogs.length === 0 ? (
              <p className="text-gray-500 italic">No logs yet...</p>
            ) : (
              debugLogs.map((log, index) => (
                <div key={index} className="mb-1">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioRecorder;
