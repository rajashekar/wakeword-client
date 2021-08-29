const audioContext = new AudioContext();

// Buffer Size tells Meyda how often to check the audio feature, and is
// measured in Audio Samples. Usually there are 44100 Audio Samples in 1
// second, which means in this case Meyda will calculate the level about 86
// (44100/512) times per second.
const bufferSize = 512 
const sampleRate = 16000
const melBands = 40 // n_mels
const hopSize = 12.5 // in ms (half of offlineWindowSize)
const meydaHopSize = sampleRate / 1000 * hopSize; // 200
const window_size = 0.75 * sampleRate;  // in seconds
const mfccDataLength = Math.floor(window_size / meydaHopSize) + 1;

// with buffer size of 1024, we can capture 44032 features for original sample rate of 44100
// once audio of 44100 features is down sampled to 16000 features,
// resulting number of features is 15953
const srcBufferSize = 1024 
const browserSampleRate = audioContext.sampleRate;// 44100

number_of_samples = 5

mfccs = []

const downSampleNode = audioContext.createScriptProcessor(this.srcBufferSize, 1, 1);
const downSampledBufferSize = (sampleRate / browserSampleRate) * srcBufferSize;


const transposeFlatten2d = arr => {
  let row = arr.length;
  let col = arr[0].length;

  let flattened = [];

  for (var j = 0; j < col; j++) {
    for (var i = 0; i < row; i++) {
      flattened.push(arr[i][j]);
    }
  }
  return flattened;
}

let postProcessing = mfcc => {
    mfccs.push(mfcc);
}

const handleSuccess = (stream) => {
    console.log(stream)
    const audioSource = audioContext.createMediaStreamSource(stream);  
    audioContext.resume()

    const meyda = Meyda.createMeydaAnalyzer({
        bufferSize: 512,
        source: audioSource,
        audioContext: audioContext,
        hopSize: meydaHopSize,
        callback: postProcessing,
        sampleRate: sampleRate,
        melBands: melBands
      });
    meyda.start("mfcc");
}
navigator.mediaDevices.getUserMedia({audio: true}).then(handleSuccess)

