import React, { useState, useRef, useEffect } from 'react';
import { RecordingStatus } from './types';
// import { transcribeAudio } from './services/geminiService'; // not used in audio-only mode


const WEBHOOK_URL = 'https://raia.app.n8n.cloud/webhook/c07fdd47-b33c-4a59-82fd-58e76214f5d1';

const MicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line>
  </svg>
);

const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="12" height="12"></rect>
  </svg>
);

const LoaderIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line>
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
    <line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line>
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
  </svg>
);

const SendIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
);

function App() {
  const [status, setStatus] = useState<RecordingStatus>(RecordingStatus.IDLE);
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [transcription, setTranscription] = useState('');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [consent, setConsent] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);

  const resetState = () => {
    setStatus(RecordingStatus.IDLE);
    setName('');
    setClientName('');
    setCompanyName('');
    setTranscription('');
    setAudioBlob(null);
    setIsSending(false);
    setError(null);
    setRecordingTime(0);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // pick a supported MIME (better cross-browser)
      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')  ? 'audio/ogg;codecs=opus'  :
        '';

      mediaRecorderRef.current = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const chunks = audioChunksRef.current;
        const detected = chunks[0]?.type || 'audio/webm';
        const blob = new Blob(chunks, { type: detected });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setStatus(RecordingStatus.RECORDING);
      setError(null);
      setRecordingTime(0);
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Error starting recording:", err);
      setError("Could not start recording. Please grant microphone permissions.");
      setStatus(RecordingStatus.ERROR);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && status === RecordingStatus.RECORDING) {
      mediaRecorderRef.current.stop();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
      // audio-only: mark ready ASAP fr
      setStatus(RecordingStatus.SUCCESS);
    }
  };

  // Audio-only 
  useEffect(() => {
    if (!audioBlob) return;
    setTranscription('');               // keep empty
    setStatus(RecordingStatus.SUCCESS); // allow submit path
  }, [audioBlob]);

  const handleSendToWebhook = async () => {
    if (!audioBlob) {
      setError('Please record something before submitting.');
      return;
    }

    setIsSending(true);
    setError(null);
    try {
      const form = new FormData();
      const mime = audioBlob.type || 'audio/webm';
      form.append('file', audioBlob, `recording.${mime.includes('ogg') ? 'ogg' : 'webm'}`);
      form.append('mimeType', mime);
      form.append('name', name);
      form.append('clientName', clientName);
      form.append('companyName', companyName);
      form.append('recordedAt', new Date().toISOString());
      if (transcription) form.append('transcript', transcription); // optional

      const res = await fetch(WEBHOOK_URL, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Webhook failed: ${res.status} ${res.statusText}`);

      resetState();
    } catch (e) {
      console.error('Failed to send to webhook:', e);
      setError(e instanceof Error ? e.message : 'An unknown error occurred.');
    } finally {
      setIsSending(false);
    }
  };

  const isFormDisabled =
    status !== RecordingStatus.IDLE &&
    status !== RecordingStatus.SUCCESS &&
    status !== RecordingStatus.ERROR;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 font-sans">
      <div className="w-full max-w-lg mx-auto space-y-6">
        <header className="text-center">
          <h1 className="text-3xl font-bold text-cyan-400">Voice Note Transcriber</h1>
          <p className="text-gray-400">Record and Send (audio-only for now).</p>
        </header>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg relative" role="alert">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        {/*  Metadata  */}
        <div className="bg-gray-800 p-6 rounded-xl shadow-lg space-y-4">
          <h2 className="text-xl font-semibold text-gray-200 border-b border-gray-700 pb-2">Metadata</h2>
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-400 mb-1">Your Name</label>
            <input type="text" id="name" value={name} onChange={e => setName(e.target.value)} disabled={isFormDisabled}
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition" />
          </div>
          <div>
            <label htmlFor="clientName" className="block text-sm font-medium text-gray-400 mb-1">Client Name</label>
            <input type="text" id="clientName" value={clientName} onChange={e => setClientName(e.target.value)} disabled={isFormDisabled}
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition" />
          </div>
          <div>
            <label htmlFor="companyName" className="block text-sm font-medium text-gray-400 mb-1">Company Name</label>
            <input type="text" id="companyName" value={companyName} onChange={e => setCompanyName(e.target.value)} disabled={isFormDisabled}
              className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition" />
          </div>

         
        </div>

        {/*  Recorder Controls */}
        <div className="flex flex-col items-center justify-center bg-gray-800 p-6 rounded-xl shadow-lg">
          <div className="relative flex items-center justify-center w-32 h-32">
            {status === RecordingStatus.RECORDING && <div className="absolute inset-0 bg-red-500 rounded-full animate-pulse"></div>}
            <button
              onClick={status === RecordingStatus.RECORDING ? stopRecording : startRecording}
              disabled={status === RecordingStatus.TRANSCRIBING}
              className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300
                ${status === RecordingStatus.IDLE || status === RecordingStatus.SUCCESS || status === RecordingStatus.ERROR ? 'bg-cyan-500 hover:bg-cyan-400' : ''}
                ${status === RecordingStatus.RECORDING ? 'bg-red-600 hover:bg-red-500' : ''}
                ${status === RecordingStatus.TRANSCRIBING ? 'bg-gray-600 cursor-not-allowed' : ''}
              `}
            >
              {status === RecordingStatus.TRANSCRIBING ? <LoaderIcon className="w-10 h-10 text-white" /> :
               status === RecordingStatus.RECORDING ? <StopIcon className="w-8 h-8 text-white" /> :
               <MicIcon className="w-8 h-8 text-white" />}
            </button>
          </div>
          <div className="mt-4 text-center">
            <p className="text-lg font-mono">{formatTime(recordingTime)}</p>
            <p className="text-gray-400 text-sm capitalize">
              {status === RecordingStatus.TRANSCRIBING ? "Transcribing... Please wait." : status.replace('_', ' ')}
            </p>
          </div>
        </div>

        {/* --- Results --- */}
        {(transcription || audioBlob) && (
          <div className="bg-gray-800 p-6 rounded-xl shadow-lg space-y-4">
            <h2 className="text-xl font-semibold text-gray-200 border-b border-gray-700 pb-2">Result</h2>
            {audioBlob && <audio src={URL.createObjectURL(audioBlob)} controls className="w-full" />}
            {/* <textarea
              value={transcription}
              readOnly
              placeholder="(Audio-only mode: no transcription)"
              className="w-full h-48 bg-gray-900/50 border border-gray-700 rounded-md p-3 text-gray-300 resize-none focus:outline-none"
            />
            */}
            <div className="flex items-start gap-3"> 
      <input
        id="consent"
        type="radio"
        name="consent"
        checked={consent}
        onChange={() => setConsent(true)}
        className="mt-1 h-4 w-4 text-cyan-500 focus:ring-cyan-500 border-gray-600 bg-gray-700"
      />
      <label htmlFor="consent" className="text-sm text-gray-300 leading-5">
        I confirm that I have obtained consent from all participants in this recording, as required by applicable laws in my state.
      </label>
    </div>

            <button
              onClick={handleSendToWebhook}
              disabled={!audioBlob || isSending || !consent}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition"
            >
              {isSending ? <LoaderIcon className="w-5 h-5"/> : <SendIcon className="w-5 h-5"/>}
              {isSending ? 'Sending...' : 'Submit'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
