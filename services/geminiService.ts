import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from "@google/genai";

function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function audioBlobToPcmBase64(blob: Blob): Promise<string> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const targetSampleRate = 16000;

    if (decodedBuffer.sampleRate === targetSampleRate) {
        const pcmData = decodedBuffer.getChannelData(0);
        const int16 = new Int16Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
            int16[i] = pcmData[i] * 32768;
        }
        return encode(new Uint8Array(int16.buffer));
    }

    const offlineContext = new OfflineAudioContext(1, decodedBuffer.duration * targetSampleRate, targetSampleRate);
    const bufferSource = offlineContext.createBufferSource();
    bufferSource.buffer = decodedBuffer;
    bufferSource.connect(offlineContext.destination);
    bufferSource.start();
    const resampledBuffer = await offlineContext.startRendering();
    
    const pcmData = resampledBuffer.getChannelData(0);
    const int16 = new Int16Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
        int16[i] = pcmData[i] * 32768;
    }
    return encode(new Uint8Array(int16.buffer));
}


export const transcribeAudio = (audioBlob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (!process.env.API_KEY) {
            return reject(new Error("API_KEY environment variable not set."));
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        let fullTranscription = "";
        let session: LiveSession | null = null;
        let timeoutId: number | null = null;

        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (session) {
                session.close();
                session = null;
            }
        };

        timeoutId = window.setTimeout(() => {
            if (fullTranscription) {
                resolve(fullTranscription);
            } else {
                reject(new Error('Transcription timed out.'));
            }
            cleanup();
        }, 30000); // 30 second timeout

        const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: () => {
                    // Connection is open. Data will be sent once the promise resolves.
                },
                onmessage: (message: LiveServerMessage) => {
                    if (message.serverContent?.inputTranscription) {
                        fullTranscription += message.serverContent.inputTranscription.text;
                    }
                    if (message.serverContent?.turnComplete) {
                        resolve(fullTranscription);
                        cleanup();
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error('Live API Error:', e);
                    reject(new Error('Transcription service failed.'));
                    cleanup();
                },
                onclose: (e: CloseEvent) => {
                    // Connection closed. If we haven't resolved yet, the timeout will handle it.
                }
            },
            config: {
                responseModalities: [Modality.AUDIO], 
                inputAudioTranscription: {},
            }
        });

        sessionPromise.then(async (activeSession) => {
            session = activeSession;
            try {
                const base64Pcm = await audioBlobToPcmBase64(audioBlob);
                const pcmBlob = {
                    data: base64Pcm,
                    mimeType: 'audio/pcm;rate=16000',
                };
                session.sendRealtimeInput({ media: pcmBlob });
            } catch (error) {
                reject(error);
                cleanup();
            }
        }).catch(err => {
            reject(err);
            cleanup();
        });
    });
};