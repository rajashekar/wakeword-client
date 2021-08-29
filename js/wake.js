const melCount = 40;
const bufferLength = 512;
const hopLength = 200;
const streamEl = document.querySelector('#stream');
const playEl = document.querySelector('#play');
let arrayBuffer;

function analyzeAudioBuffer(audioBuffer) {
    analyzeArrayBuffer(audioBuffer.getChannelData(0));
}

function analyzeArrayBuffer(buffer) {
    arrayBuffer = buffer;
    var _stft = stft(arrayBuffer, bufferLength, hopLength);
    let stftEnergies = _stft.map(fft => fftEnergies(fft));
    console.log(stftEnergies)
    let logMel = melSpectrogram(stftEnergies, melCount)
    let shape = [logMel.length, logMel[0].length];
    console.log(`Generated log-mel spectrogram of shape ${logMel.length} x ${logMel[0].length}.`);
    console.log(logMel.toString());
    console.log(shape.toString());
}

const streamFeature = new StreamingFeatureExtractor({
    bufferLength: bufferLength,
    hopLength: hopLength,
    duration: 0.75,
    targetSr: 16000,
    melCount: melCount,
    isMfccEnabled: true,
});

streamEl.addEventListener('click', function(e) {
    if (streamFeature.isStreaming) {
        streamFeature.stop();
        var buffer = streamFeature.getLastPlaybackBuffer();
        console.log("Got a stream buffer of length " + buffer.length + ".");
        analyzeArrayBuffer(buffer);
        streamEl.innerHTML = 'Stream';
    } else {
        streamFeature.start();
        streamEl.innerHTML = 'Stop streaming';
    }
});

playEl.addEventListener('click', function (e) {
    playbackArrayBuffer(arrayBuffer);
});

/*

const wait = ms => {
    var start = Date.now(),
        now = start;
    while (now - start < ms) {
      now = Date.now();
    }
}

let base64data = 0

// https://stackoverflow.com/a/951057
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const analyze_audiobuffer = audioBuffer => {
    console.log(audioBuffer)
    console.log(audioBuffer.getChannelData(0))

    buffer = audioBuffer.getChannelData(0)

    //var resampler = new Resampler(audioBuffer.sampleRate, 16000,  1, buffer);
    //var resampled = resampler.resampler(buffer.length);
    //buffer = resampler.outputBuffer

    let _stft = stft(buffer, bufferLength, hopLength);
    console.log(_stft)
    let stftEnergies = _stft.map(fft => fftEnergies(fft));
    console.log(stftEnergies)
    let logMel = melSpectrogram(stftEnergies, melCount)
    let shape = [logMel.length, logMel[0].length];
    console.log(`Generated log-mel spectrogram of shape ${logMel.length} x ${logMel[0].length}.`);
    console.log(logMel.toString());
    console.log(shape.toString());
}

const export_media = buffer => {
    console.log(buffer)
    let audioContext = new AudioContext()
    let fileReader = new FileReader();
    let arrayBuffer;

    fileReader.onloadend = () => {
        arrayBuffer = fileReader.result;
        console.log(arrayBuffer)
        audioContext.decodeAudioData(arrayBuffer,analyze_audiobuffer)
    }

    fileReader.readAsArrayBuffer(buffer);
}

const handleSuccess = stream => {
    var options = {
        audioBitsPerSecond : 16000, //chrome seems to ignore, always 48k
        mimeType : 'audio/webm;codecs=opus'
        //mimeType : 'audio/webm;codecs=pcm'
      }; 
    const chunks = [];
    recorder = new MediaRecorder(stream, options);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = e => export_media(new Blob(chunks));

    recorder.start();
    wait(750); // wait 750 ms
    recorder.stop();
    stream.getAudioTracks()[0].stop();
}

navigator.mediaDevices.getUserMedia({audio: true}).then(handleSuccess);
*/