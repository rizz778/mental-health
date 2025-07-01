import { useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";
import Test from "./components/Test";
import EmotionTester from "./components/emo_test";
import AudioRecorder from "./components/audio_test";
import GeminiAudioChat from "./components/audio-test2";
function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      {/* <GeminiAudioChat/> */}
      <Test />
    </>
  );
}

export default App;
