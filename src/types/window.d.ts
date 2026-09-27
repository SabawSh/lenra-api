declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export {};
