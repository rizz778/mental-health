import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Volume2, VolumeX, Phone, PhoneOff } from "lucide-react";
import { Modal, Button, Alert } from "antd";

const GeminiAudioChatModal = ({
  visible,
  onClose,
  userProfile,
  conversationHistory,
}) => {
  const [isCalling, setIsCalling] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [logs, setLogs] = useState([]);
  const [audioQueueLength, setAudioQueueLength] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [emotionDetectionEnabled, setEmotionDetectionEnabled] = useState(false);
  const [cameraPermission, setCameraPermission] = useState(null);
  const [emotionWs, setEmotionWs] = useState(null);
  const [inputTranscript, setInputTranscript] = useState("");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [distress, setDistress] = useState(0);
  const [log, setLog] = useState("");

  // Refs for audio management
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const streamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimeoutRef = useRef(null);
  const audioContextReadyRef = useRef(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const [emotion, setEmotion] = useState({ current: "", aggregated: "" });

  // Enhanced audio system refs
  const audioBufferRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef(null);
  const nextSourceRef = useRef(null);
  const audioSchedulerRef = useRef(null);
  const playbackStartTimeRef = useRef(0);
  const bufferDurationRef = useRef(0);
  const crossfadeGainRef = useRef(null);
  const masterGainRef = useRef(null);

  // Transcript accumulators
  const currentInputTranscriptRef = useRef("");
  const currentOutputTranscriptRef = useRef("");

  // Audio configuration
  const AUDIO_CONFIG = {
    sampleRate: 24000, // Match backend sample rate
    bufferSize: 4096,
    minBufferChunks: 5, // Buffer more chunks before playback
    maxBufferChunks: 10,
    crossfadeDuration: 0.05, // 50ms crossfade
    lookAheadTime: 0.1, // 100ms lookahead
    targetLatency: 0.05, // 50ms target latency
  };

  const addLog = useCallback((message, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-50), { timestamp, message, type }]);
  }, []);

  // Enhanced audio context initialization
  const initializeAudioContext = async () => {
    if (
      audioContextReadyRef.current &&
      audioContextRef.current?.state !== "closed"
    ) {
      return;
    }
    try {
      audioContextRef.current = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: AUDIO_CONFIG.sampleRate,
        latencyHint: "interactive",
      });

      // Create master gain node for volume control
      masterGainRef.current = audioContextRef.current.createGain();
      masterGainRef.current.connect(audioContextRef.current.destination);

      // Create crossfade gain node for smooth transitions
      crossfadeGainRef.current = audioContextRef.current.createGain();
      crossfadeGainRef.current.connect(masterGainRef.current);

      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }

      audioContextReadyRef.current = true;
      addLog(
        `Enhanced audio context ready (${audioContextRef.current.sampleRate}Hz)`,
        "success"
      );
    } catch (error) {
      addLog(`Audio context error: ${error.message}`, "error");
    }
  };

  // Optimized PCM conversion with better performance
  const convertPCMToBase64 = (pcmData) => {
    const int16Array = new Int16Array(pcmData.length);

    // Vectorized conversion
    for (let i = 0; i < pcmData.length; i++) {
      int16Array[i] = Math.round(Math.max(-1, Math.min(1, pcmData[i])) * 32767);
    }

    const uint8Array = new Uint8Array(int16Array.buffer);

    // Use larger chunks for better performance
    const chunkSize = 65536; // 64KB chunks
    let binary = "";

    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }

    return btoa(binary);
  };

  const isPCMFormat = (mimeType) => {
    return (
      mimeType && (mimeType.startsWith("audio/pcm") || mimeType.includes("pcm"))
    );
  };

  // Simplified audio buffer creation with detailed logging
  const createAudioBuffer = async (audioData, mimeType) => {
    if (!audioContextRef.current) {
      addLog("Audio context not initialized", "error");
      return null;
    }
    let audioBuffer;
    try {
      if (isPCMFormat(mimeType)) {
        const binaryString = atob(audioData);
        const uint8Array = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          uint8Array[i] = binaryString.charCodeAt(i);
        }
        if (uint8Array.length % 2 !== 0) {
          addLog("PCM data length is not even, possible corruption", "error");
          return null;
        }
        const int16Array = new Int16Array(uint8Array.buffer);
        addLog(
          "PCM first 10 samples: " +
            Array.from(int16Array.slice(0, 10)).join(", "),
          "info"
        );
        addLog(
          `PCM chunk length: ${int16Array.length}, expected sampleRate: ${AUDIO_CONFIG.sampleRate}`,
          "info"
        );
        audioBuffer = audioContextRef.current.createBuffer(
          1,
          int16Array.length,
          AUDIO_CONFIG.sampleRate
        );
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16Array.length; i++) {
          channelData[i] = int16Array[i] / 32768.0;
        }
      } else {
        const binaryString = atob(audioData);
        const arrayBuffer = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          arrayBuffer[i] = binaryString.charCodeAt(i);
        }
        audioBuffer = await audioContextRef.current.decodeAudioData(
          arrayBuffer.buffer
        );
      }
      addLog(
        `AudioBuffer created: duration=${audioBuffer.duration.toFixed(
          3
        )}s, sampleRate=${audioBuffer.sampleRate}, length=${
          audioBuffer.length
        }`,
        "info"
      );
      return audioBuffer;
    } catch (err) {
      addLog("createAudioBuffer error: " + err.message, "error");
      return null;
    }
  };

  // Simplified audio playback with crossfade and lookahead scheduling
  const processAudioQueue = async () => {
    if (isPlayingRef.current) return;
    if (audioBufferRef.current.length === 0) return;
    if (
      !isPlaying &&
      audioBufferRef.current.length < AUDIO_CONFIG.minBufferChunks
    ) {
      setTimeout(processAudioQueue, 30);
      return;
    }
    try {
      isPlayingRef.current = true;
      setIsPlaying(true);
      const chunk = audioBufferRef.current.shift();
      setAudioQueueLength(audioBufferRef.current.length);
      addLog(
        `Dequeued audio chunk. Remaining queue: ${audioBufferRef.current.length}`,
        "info"
      );
      const audioBuffer = await createAudioBuffer(chunk.data, chunk.mimeType);
      if (!audioBuffer) {
        addLog("Failed to create audio buffer, skipping chunk", "error");
        isPlayingRef.current = false;
        setIsPlaying(false);
        if (audioBufferRef.current.length > 0)
          setTimeout(processAudioQueue, 100);
        return;
      }
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      // Use crossfade gain for smooth transitions
      source.connect(crossfadeGainRef.current);
      // Crossfade logic
      const now = audioContextRef.current.currentTime;
      let startTime = now;
      if (playbackStartTimeRef.current > now) {
        startTime = playbackStartTimeRef.current;
      }
      // Schedule crossfade in
      crossfadeGainRef.current.gain.cancelScheduledValues(startTime);
      crossfadeGainRef.current.gain.setValueAtTime(0, startTime);
      crossfadeGainRef.current.gain.linearRampToValueAtTime(
        1,
        startTime + AUDIO_CONFIG.crossfadeDuration
      );
      // Schedule crossfade out for next chunk
      source.onended = () => {
        addLog("Audio chunk playback ended", "info");
        isPlayingRef.current = false;
        setIsPlaying(false);
        setAudioQueueLength(audioBufferRef.current.length);
        // Crossfade out
        const endTime = audioContextRef.current.currentTime;
        crossfadeGainRef.current.gain.cancelScheduledValues(endTime);
        crossfadeGainRef.current.gain.setValueAtTime(1, endTime);
        crossfadeGainRef.current.gain.linearRampToValueAtTime(
          0,
          endTime + AUDIO_CONFIG.crossfadeDuration
        );
        if (audioBufferRef.current.length > 0) processAudioQueue();
      };
      addLog(
        `Starting playback: duration=${audioBuffer.duration.toFixed(
          3
        )}s (crossfade)`,
        "success"
      );
      source.start(startTime);
      // Schedule next chunk slightly before this one ends (lookahead)
      playbackStartTimeRef.current =
        startTime + audioBuffer.duration - AUDIO_CONFIG.crossfadeDuration;
      if (audioBufferRef.current.length > 0) {
        setTimeout(
          processAudioQueue,
          (audioBuffer.duration - AUDIO_CONFIG.crossfadeDuration) * 1000
        );
      }
    } catch (error) {
      addLog("Audio processing/playback error: " + error.message, "error");
      isPlayingRef.current = false;
      setIsPlaying(false);
      if (audioBufferRef.current.length > 0) setTimeout(processAudioQueue, 100);
    }
  };

  // Enhanced audio queueing with intelligent buffering
  const queueAudio = (audioData, mimeType) => {
    if (!audioData || isMuted) return;
    audioBufferRef.current.push({
      data: audioData,
      mimeType: mimeType || "audio/pcm",
      timestamp: Date.now(),
    });
    setAudioQueueLength(audioBufferRef.current.length);
    processAudioQueue();
  };

  // Enhanced audio stopping with fade-out
  const stopCurrentAudio = () => {
    if (currentSourceRef.current) {
      try {
        // Fade out quickly to avoid clicks
        const currentTime = audioContextRef.current.currentTime;
        const fadeOutDuration = 0.01; // 10ms fade out

        if (crossfadeGainRef.current) {
          crossfadeGainRef.current.gain.cancelScheduledValues(currentTime);
          crossfadeGainRef.current.gain.setValueAtTime(
            crossfadeGainRef.current.gain.value,
            currentTime
          );
          crossfadeGainRef.current.gain.linearRampToValueAtTime(
            0,
            currentTime + fadeOutDuration
          );
        }

        setTimeout(() => {
          if (currentSourceRef.current) {
            currentSourceRef.current.stop();
            currentSourceRef.current = null;
          }
        }, fadeOutDuration * 1000);
      } catch (error) {
        // Ignore stop errors
      }
    }

    isPlayingRef.current = false;
    setIsPlaying(false);
  };

  const clearAudioQueue = () => {
    audioBufferRef.current = [];
    stopCurrentAudio();
    setAudioQueueLength(0);
    addLog("Audio queue cleared", "info");
  };

  // Enhanced connection with better error handling
  const connectToBackend = async () => {
    try {
      setConnectionStatus("connecting");
      addLog("Connecting to backend...", "info");

      await initializeAudioContext();

      const wsUrl = "ws://localhost:8000/audio";
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        setConnectionStatus("connected");
        addLog("Connected successfully", "success");

        const config = {
          type: "setup",
          config: {
            model: "models/gemini-2.5-flash-preview-native-audio-dialog",
            response_modalities: ["AUDIO"],
            voice_name: "Puck",
            audio_config: {
              sample_rate: AUDIO_CONFIG.sampleRate,
              chunk_size: AUDIO_CONFIG.bufferSize,
              enable_streaming: true,
            },
          },
        };
        wsRef.current.send(JSON.stringify(config));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "audio":
              if (data.audio_data && !isMuted) {
                queueAudio(data.audio_data, data.mime_type || "audio/pcm");
              }
              break;

            case "transcript":
              addLog(`Gemini: ${data.text}`, "ai-response");
              break;

            case "user_transcript":
              addLog(`You: ${data.text}`, "user-input");
              break;

            case "input_transcription":
              currentInputTranscriptRef.current += data.text || "";
              if (data.final || data.is_final) {
                setInputTranscript(currentInputTranscriptRef.current);
                analyzeDistressScore(currentInputTranscriptRef.current);
                currentInputTranscriptRef.current = "";
              }
              break;

            case "output_transcription":
              currentOutputTranscriptRef.current += data.text || "";
              if (data.final || data.is_final) {
                setOutputTranscript(currentOutputTranscriptRef.current);
                currentOutputTranscriptRef.current = "";
              }
              break;

            case "info":
              addLog(data.message, "info");
              break;

            case "turnComplete":
              if (currentInputTranscriptRef.current) {
                setInputTranscript(currentInputTranscriptRef.current);
                analyzeDistressScore(currentInputTranscriptRef.current);
                currentInputTranscriptRef.current = "";
              }
              if (currentOutputTranscriptRef.current) {
                setOutputTranscript(currentOutputTranscriptRef.current);
                currentOutputTranscriptRef.current = "";
              }
              addLog("Turn completed", "success");
              break;

            case "error":
              addLog(`Error: ${data.message}`, "error");
              break;

            default:
              console.log("[unhandled message type]", data);
              break;
          }
        } catch (error) {
          addLog(`Message parsing error: ${error.message}`, "error");
        }
      };

      wsRef.current.onerror = (error) => {
        addLog("WebSocket error", "error");
        setConnectionStatus("error");
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setConnectionStatus("disconnected");
        addLog(
          `Disconnected: ${event.reason || "Connection closed"}`,
          "warning"
        );
        clearAudioQueue();
      };
    } catch (error) {
      addLog(`Connection error: ${error.message}`, "error");
      setConnectionStatus("error");
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

  // Enhanced recording with better audio processing
  const startRecording = async () => {
    currentInputTranscriptRef.current = "";
    currentOutputTranscriptRef.current = "";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          latency: 0.01, // Low latency
        },
      });

      streamRef.current = stream;

      const inputAudioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 16000,
        latencyHint: "interactive",
      });

      const source = inputAudioContext.createMediaStreamSource(stream);
      const processor = inputAudioContext.createScriptProcessor(2048, 1, 1); // Smaller buffer for lower latency

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
        source: source,
      };

      setIsRecording(true);
      addLog("Recording started (16kHz, low latency)", "success");

      // Auto-stop after 5 seconds
      recordingTimeoutRef.current = setTimeout(() => {
        if (isRecording) {
          stopRecording();
        }
      }, 5000);
    } catch (error) {
      addLog(`Recording error: ${error.message}`, "error");
    }
  };

  // Rest of the emotion detection logic remains the same...
  useEffect(() => {
    let interval = null;
    let ws = null;

    if (!emotionDetectionEnabled) {
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((track) => track.stop());
        webcamStreamRef.current = null;
      }
      setEmotion((prev) => ({ ...prev, aggregated: "" }));
      if (emotionWs) {
        emotionWs.close();
        setEmotionWs(null);
      }
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        setCameraPermission(true);
        webcamStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        ws = new WebSocket("ws://localhost:8000/");
        setEmotionWs(ws);

        ws.onopen = () => {
          ws.send(JSON.stringify({ setup: { mode: "emotion" } }));
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
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
              (blob) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const base64data = reader.result.split(",")[1];
                  ws.send(JSON.stringify({ frame: base64data }));
                };
                reader.readAsDataURL(blob);
              },
              "image/jpeg",
              0.8
            );
          }
        }, 1000);
      })
      .catch((err) => {
        setCameraPermission(false);
        setEmotion((prev) => ({ ...prev, aggregated: "" }));
        if (ws) ws.close();
        console.error("Error accessing webcam:", err);
      });

    return () => {
      if (interval) clearInterval(interval);
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((track) => track.stop());
        webcamStreamRef.current = null;
      }
      if (ws) ws.close();
      setEmotionWs(null);
    };
  }, [emotionDetectionEnabled]);

  const synthesizeEmotionPCM = async (emotionText) => {
    return new Promise((resolve, reject) => {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)(
          { sampleRate: 16000 }
        );
        const utter = new window.SpeechSynthesisUtterance(emotionText);
        utter.lang = "en-US";
        let dest = audioCtx.createMediaStreamDestination();

        utter.onend = async () => {
          const recorder = new MediaRecorder(dest.stream, {
            mimeType: "audio/webm",
          });
          let chunks = [];

          recorder.ondataavailable = (e) => chunks.push(e.data);
          recorder.onstop = async () => {
            const blob = new Blob(chunks, { type: "audio/webm" });
            const arrayBuffer = await blob.arrayBuffer();

            let audioBuffer;
            try {
              audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            } catch (e) {
              resolve(null);
              return;
            }

            let pcm = audioBuffer.getChannelData(0);
            if (audioBuffer.sampleRate !== 16000) {
              const ratio = audioBuffer.sampleRate / 16000;
              const newLength = Math.floor(pcm.length / ratio);
              const resampled = new Float32Array(newLength);
              for (let i = 0; i < newLength; i++) {
                const idx = i * ratio;
                const idxLow = Math.floor(idx);
                const idxHigh = Math.min(Math.ceil(idx), pcm.length - 1);
                const weight = idx - idxLow;
                resampled[i] =
                  (1 - weight) * pcm[idxLow] + weight * pcm[idxHigh];
              }
              pcm = resampled;
            }
            resolve(new Float32Array(pcm));
          };

          recorder.start();
          setTimeout(() => recorder.stop(), 1000);
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
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);

    if (audioChunksRef.current.length > 0) {
      let totalSamples = 0;
      audioChunksRef.current.forEach((chunk) => {
        totalSamples += chunk.length;
      });

      const combinedPCM = new Float32Array(totalSamples);
      let offset = 0;
      audioChunksRef.current.forEach((chunk) => {
        combinedPCM.set(chunk, offset);
        offset += chunk.length;
      });

      let emotionText = "";
      if (emotionDetectionEnabled && emotion.aggregated) {
        emotionText = `The user's emotion is: ${emotion.aggregated}`;
      }

      let ttsPCM = null;
      try {
        if (emotionText) {
          ttsPCM = await synthesizeEmotionPCM(emotionText);
        }
      } catch (err) {
        addLog("TTS error, sending only user audio", "error");
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
          type: "audio_input",
          audio_data: base64Data,
          emotion: emotionDetectionEnabled ? emotion.aggregated : "",
          format: "pcm",
          sample_rate: 16000,
          channels: 1,
          bits_per_sample: 16,
        };
        wsRef.current.send(JSON.stringify(message));
        addLog(
          `Audio sent (${(finalPCM.length / 16000).toFixed(
            2
          )}s) with emotion: ${
            emotionDetectionEnabled ? emotion.aggregated : "none"
          }`,
          "user-input"
        );
      }
    }

    audioChunksRef.current = [];
    audioProcessorRef.current = null;
  };

  const analyzeDistressScore = async (inputText) => {
    if (!inputText || inputText.trim() === "") return;

    try {
      addLog("Analyzing distress score...", "info");
      const response = await fetch("http://localhost:8000/api/distress-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });

      if (!response.ok) throw new Error("API error");

      const data = await response.json();
      setDistress(data.score);
    } catch (err) {
      addLog("Distress score analysis failed", "error");
    }
  };

  const toggleMute = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    addLog(`Audio ${newMutedState ? "muted" : "unmuted"}`, "info");

    if (masterGainRef.current) {
      const currentTime = audioContextRef.current.currentTime;
      masterGainRef.current.gain.cancelScheduledValues(currentTime);
      masterGainRef.current.gain.setValueAtTime(
        masterGainRef.current.gain.value,
        currentTime
      );
      masterGainRef.current.gain.linearRampToValueAtTime(
        newMutedState ? 0 : 1,
        currentTime + 0.05
      );
    }

    if (newMutedState) {
      clearAudioQueue();
    }
  };

  const handleUserInteraction = async () => {
    if (
      audioContextRef.current &&
      audioContextRef.current.state === "suspended"
    ) {
      await audioContextRef.current.resume();
    }
  };

  useEffect(() => {
    initializeAudioContext();

    document.addEventListener("click", handleUserInteraction);
    document.addEventListener("keydown", handleUserInteraction);

    return () => {
      document.removeEventListener("click", handleUserInteraction);
      document.removeEventListener("keydown", handleUserInteraction);

      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }

      if (audioProcessorRef.current) {
        try {
          audioProcessorRef.current.processor.disconnect();
          audioProcessorRef.current.source.disconnect();
          audioProcessorRef.current.context.close();
        } catch (error) {}
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
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
      case "connected":
        return "text-green-600";
      case "connecting":
        return "text-yellow-600";
      case "error":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  const getLogTypeColor = (type) => {
    switch (type) {
      case "success":
        return "text-green-600";
      case "error":
        return "text-red-600";
      case "warning":
        return "text-yellow-600";
      case "ai-response":
        return "text-blue-600 font-medium";
      case "user-input":
        return "text-purple-600 font-medium";
      default:
        return "text-gray-600";
    }
  };

  const handleStartCall = async () => {
    setIsCalling(true);
    setLog("");
    setConnectionStatus("connecting");
    // if (!userProfile || Object.keys(userProfile).length === 0) {
    //   setLog('User profile is missing or empty. Cannot start audio call.');
    //   setConnectionStatus('error');
    //   setIsCalling(false);
    //   console.warn('GeminiAudioChatModal: userProfile is missing or empty', userProfile);
    //   return;
    // }
    if (!conversationHistory) {
      setLog(
        "Conversation history is missing or empty. Cannot start audio call."
      );
      setConnectionStatus("error");
      setIsCalling(false);
      console.warn(
        "GeminiAudioChatModal: conversationHistory is missing or empty",
        conversationHistory
      );
      return;
    }
    try {
      wsRef.current = new window.WebSocket("ws://localhost:8000/audio");
      wsRef.current.onopen = () => {
        setConnectionStatus("connected");
        setLog("Connected to audio backend. Sending setup...");
        wsRef.current.send(
          JSON.stringify({
            type: "setup",
            config: {
              model: "models/gemini-2.5-flash-preview-native-audio-dialog",
              response_modalities: ["AUDIO"],
              voice_name: "Puck",
              systemContext: {
                user_profile: userProfile,
                conversation_history: conversationHistory,
              },
            },
          })
        );
      };
      wsRef.current.onerror = (e) => {
        setConnectionStatus("error");
        setLog("WebSocket error: " + e.message);
        setIsCalling(false);
      };
      wsRef.current.onclose = () => {
        setConnectionStatus("disconnected");
        setLog("Disconnected from audio backend.");
        setIsCalling(false);
      };
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "setup_complete") {
            setLog("Audio session setup complete. You can now talk!");
          } else if (data.type === "error") {
            setLog("Backend error: " + data.message);
            setConnectionStatus("error");
            setIsCalling(false);
          } else if (data.type === "info") {
            setLog((prev) => prev + "\n" + data.message);
          } else if (data.type === "audio") {
            setLog((prev) => prev + "\n[Audio data received]");
            // Use queueAudio for new audio system
            if (data.audio_data && !isMuted) {
              queueAudio(data.audio_data, data.mime_type || "audio/pcm");
            }
          } else {
            setLog((prev) => prev + "\n[Backend] " + JSON.stringify(data));
          }
        } catch (err) {
          setLog("Message parse error: " + err.message);
        }
      };
    } catch (err) {
      setConnectionStatus("error");
      setLog("Connection error: " + err.message);
      setIsCalling(false);
    }
  };

  return (
    <Modal
      title="Gemini Audio Chat"
      visible={visible}
      onCancel={onClose}
      footer={[
        <Button
          key="close"
          onClick={onClose}
          disabled={isCalling || isRecording}
        >
          Close
        </Button>,
        <Button
          key="start"
          type="primary"
          onClick={handleStartCall}
          disabled={isCalling || connectionStatus === "connected"}
        >
          {isCalling
            ? "Connecting..."
            : connectionStatus === "connected"
            ? "Connected"
            : "Start Audio Call"}
        </Button>,
        <Button
          key="record"
          type="primary"
          onClick={startRecording}
          disabled={isRecording || connectionStatus !== "connected"}
        >
          Start Recording
        </Button>,
        <Button
          key="stop"
          danger
          onClick={stopRecording}
          disabled={!isRecording}
        >
          Stop Recording
        </Button>,
        <Button
          key="emotion"
          onClick={() => setEmotionDetectionEnabled((v) => !v)}
          type={emotionDetectionEnabled ? "primary" : "default"}
        >
          {emotionDetectionEnabled
            ? "Disable Emotion Detection"
            : "Enable Emotion Detection"}
        </Button>,
      ]}
      width={600}
    >
      <div style={{ textAlign: "center", padding: 20 }}>
        <p>Start a real-time audio conversation with the assistant.</p>
        {log && (
          <Alert
            message={log}
            type={connectionStatus === "error" ? "error" : "info"}
            showIcon
            style={{ marginTop: 10 }}
          />
        )}
        {emotionDetectionEnabled && (
          <div style={{ marginTop: 20, textAlign: "left" }}>
            <b>Detected Emotion:</b>{" "}
            <span>{emotion.aggregated || <i>Detecting...</i>}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default GeminiAudioChatModal;
