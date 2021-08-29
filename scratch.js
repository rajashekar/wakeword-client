const SAMPLE_RATE = 16000;
const offlineCtx = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
const SPEC_HOP_LENGTH = 200;
const MEL_SPEC_BINS = 40;
const NUM_FFTS = 512;

async function loadAudioFromUrl(url) {
    return fetch(url)
        .then((body) => body.arrayBuffer())
        .then((buffer) => offlineCtx.decodeAudioData(buffer));
}

function getMonoAudio(audioBuffer) {
    if (audioBuffer.numberOfChannels === 1) {
        return audioBuffer.getChannelData(0);
    }
    if (audioBuffer.numberOfChannels !== 2) {
        throw Error(
            `${audioBuffer.numberOfChannels} channel audio is not supported.`);
    }
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.getChannelData(1);

    const mono = new Float32Array(audioBuffer.length);
    for (let i = 0; i < audioBuffer.length; ++i) {
        mono[i] = (ch0[i] + ch1[i]) / 2;
    }
    return mono;
}

async function resampleAndMakeMono(audioBuffer, targetSr = SAMPLE_RATE) {
    if (audioBuffer.sampleRate === targetSr) {
        return getMonoAudio(audioBuffer);
    }
    const sourceSr = audioBuffer.sampleRate;
    const lengthRes = (audioBuffer.length * targetSr) / sourceSr;
    if (!isSafari) {
        const _offlineCtx = new OfflineAudioContext(
            audioBuffer.numberOfChannels, audioBuffer.duration * targetSr,
            targetSr);
        const bufferSource = _offlineCtx.createBufferSource();
        bufferSource.buffer = audioBuffer;
        bufferSource.connect(_offlineCtx.destination);
        bufferSource.start();
        return _offlineCtx.startRendering().then(
            (buffer) => buffer.getChannelData(0));
    } else {
        // Safari does not support resampling with WebAudio.
        console.log(
            'Safari does not support WebAudio resampling, so this may be slow.',
            'O&F', logging.Level.WARN);

        const originalAudio = getMonoAudio(audioBuffer);
        const resampledAudio = new Float32Array(lengthRes);
        resample(
            ndarray(resampledAudio, [lengthRes]),
            ndarray(originalAudio, [originalAudio.length]));
        return resampledAudio;
    }
}

function applyWindow(buffer, win) {
    if (buffer.length !== win.length) {
        console.error(
            `Buffer length ${buffer.length} != window length ${win.length}.`);
        return null;
    }
    const out = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        out[i] = win[i] * buffer[i];
    }
    return out;
}


/**
 * Given a timeseries, returns an array of timeseries that are windowed
 * according to the params specified.
 */
function frame(data, frameLength, hopLength) {
    const bufferCount = Math.floor((data.length - frameLength) / hopLength) + 1;
    const buffers = Array.from(
        { length: bufferCount }, (x, i) => new Float32Array(frameLength));
    for (let i = 0; i < bufferCount; i++) {
        const ind = i * hopLength;
        const buffer = data.slice(ind, ind + frameLength);
        buffers[i].set(buffer);
        // In the end, we will likely have an incomplete buffer, which we should
        // just ignore.
        if (buffer.length !== frameLength) {
            continue;
        }
    }
    return buffers;
}

function padReflect(data, padding) {
    const out = padConstant(data, padding);
    for (let i = 0; i < padding; i++) {
        // Pad the beginning with reflected values.
        out[i] = out[2 * padding - i];
        // Pad the end with reflected values.
        out[out.length - i - 1] = out[out.length - 2 * padding + i - 1];
    }
    return out;
}

function padConstant(data, padding) {
    let padLeft, padRight;
    if (typeof padding === 'object') {
        [padLeft, padRight] = padding;
    } else {
        padLeft = padRight = padding;
    }
    const out = new Float32Array(data.length + padLeft + padRight);
    out.set(data, padLeft);
    return out;
}

function padCenterToLength(data, length) {
    // If data is longer than length, error!
    if (data.length > length) {
        throw new Error('Data is longer than length.');
    }
    const paddingLeft = Math.floor((length - data.length) / 2);
    const paddingRight = length - data.length - paddingLeft;
    return padConstant(data, [paddingLeft, paddingRight]);
}

function hannWindow(length) {
    const win = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
    }
    return win;
}

function hzToMel(hz) {
    return 1125.0 * Math.log(1 + hz / 700.0);
  }

function melToHz(mel) {
    return 700.0 * (Math.exp(mel / 1125.0) - 1);
} 

function fft(y) {
    const fft = new FFTJS(y.length);
    const out = fft.createComplexArray();
    const data = fft.toComplexArray(y);
    fft.transform(out, data);
    return out;
}

function stft(y, params) {
    const nFft = params.nFft || 2048;
    const winLength = params.winLength || nFft;
    const hopLength = params.hopLength || Math.floor(winLength / 4);

    let fftWindow = hannWindow(winLength);

    // Pad the window to be the size of nFft.
    fftWindow = padCenterToLength(fftWindow, nFft);

    // Pad the time series so that the frames are centered.
    y = padReflect(y, Math.floor(nFft / 2));

    // Window the time series.
    const yFrames = frame(y, nFft, hopLength);
    // Pre-allocate the STFT matrix.
    const stftMatrix = [];

    const width = yFrames.length;
    const height = nFft + 2;
    for (let i = 0; i < width; i++) {
        // Each column is a Float32Array of size height.
        const col = new Float32Array(height);
        stftMatrix[i] = col;
    }

    for (let i = 0; i < width; i++) {
        // Populate the STFT matrix.
        const winBuffer = applyWindow(yFrames[i], fftWindow);
        const col = fft(winBuffer);
        stftMatrix[i].set(col.slice(0, height));
    }

    return stftMatrix;
}

/**
* Given an interlaced complex array (y_i is real, y_(i+1) is imaginary),
* calculates the energies. Output is half the size.
*/
function mag(y) {
    const out = new Float32Array(y.length / 2);
    for (let i = 0; i < y.length / 2; i++) {
        out[i] = Math.sqrt(y[i * 2] * y[i * 2] + y[i * 2 + 1] * y[i * 2 + 1]);
    }
    return out;
}

function pow(arr, power) {
    return arr.map((v) => Math.pow(v, power));
}

function magSpectrogram(stft, power) {
    const spec = stft.map((fft) => pow(mag(fft), power));
    const nFft = stft[0].length - 1;
    return [spec, nFft];
}

function linearSpace(start, end, count) {
    // Include start and endpoints.
    const delta = (end - start) / (count - 1);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        out[i] = start + delta * i;
    }
    return out;
}


function calculateFftFreqs(sampleRate, nFft) {
    return linearSpace(0, sampleRate / 2, Math.floor(1 + nFft / 2));
}

function calculateMelFreqs(nMels, fMin, fMax) {
    const melMin = hzToMel(fMin);
    const melMax = hzToMel(fMax);

    // Construct linearly spaced array of nMel intervals, between melMin and
    // melMax.
    const mels = linearSpace(melMin, melMax, nMels);
    const hzs = mels.map((mel) => melToHz(mel));
    return hzs;
}

function internalDiff(arr) {
    const out = new Float32Array(arr.length - 1);
    for (let i = 0; i < arr.length; i++) {
        out[i] = arr[i + 1] - arr[i];
    }
    return out;
}

function outerSubtract(arr, arr2) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
        out[i] = new Float32Array(arr2.length);
    }
    for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr2.length; j++) {
            out[i][j] = arr[i] - arr2[j];
        }
    }
    return out;
}


function applyFilterbank(mags, filterbank) {
    if (mags.length !== filterbank[0].length) {
        throw new Error(
            `Each entry in filterbank should have dimensions ` +
            `matching FFT. |mags| = ${mags.length}, ` +
            `|filterbank[0]| = ${filterbank[0].length}.`);
    }

    // Apply each filter to the whole FFT signal to get one value.
    const out = new Float32Array(filterbank.length);
    for (let i = 0; i < filterbank.length; i++) {
        // To calculate filterbank energies we multiply each filterbank with the
        // power spectrum.
        const win = applyWindow(mags, filterbank[i]);
        // Then add up the coefficents.
        out[i] = win.reduce((a, b) => a + b);
    }
    return out;
}




function applyWholeFilterbank(spec, filterbank) {
    // Apply a point-wise dot product between the array of arrays.
    const out = [];
    console.log("spectogram length", spec.length)
    for (let i = 0; i < spec.length; i++) {
        out[i] = applyFilterbank(spec[i], filterbank);
    }
    return out;
}

function createMelFilterbank(params) {
    const fMin = params.fMin || 0;
    const fMax = params.fMax || params.sampleRate / 2;
    const nMels = params.nMels || 128;
    const nFft = params.nFft || 2048;

    // Center freqs of each FFT band.
    const fftFreqs = calculateFftFreqs(params.sampleRate, nFft);
    // (Pseudo) center freqs of each Mel band.
    const melFreqs = calculateMelFreqs(nMels + 2, fMin, fMax);

    const melDiff = internalDiff(melFreqs);
    const ramps = outerSubtract(melFreqs, fftFreqs);
    const filterSize = ramps[0].length;

    const weights = [];
    for (let i = 0; i < nMels; i++) {
        weights[i] = new Float32Array(filterSize);
        for (let j = 0; j < ramps[i].length; j++) {
            const lower = -ramps[i][j] / melDiff[i];
            const upper = ramps[i + 2][j] / melDiff[i + 1];
            const weight = Math.max(0, Math.min(lower, upper));
            weights[i][j] = weight;
        }
    }

    // Slaney-style mel is scaled to be approx constant energy per channel.
    for (let i = 0; i < weights.length; i++) {
        // How much energy per channel.
        const enorm = 2.0 / (melFreqs[2 + i] - melFreqs[i]);
        // Normalize by that amount.
        weights[i] = weights[i].map((val) => val * enorm);
    }

    return weights;
}

function melSpectrogram(y, params) {
    if (!params.power) {
        params.power = 2.0;
    }
    const stftMatrix = stft(y, params);
    const [spec, nFft] = magSpectrogram(stftMatrix, params.power);

    params.nFft = nFft;
    const melBasis = createMelFilterbank(params);
    return applyWholeFilterbank(spec, melBasis);
}

url = "output.wav"
const audioBuffer = await loadAudioFromUrl(url);
const resampledMonoAudio = await resampleAndMakeMono(audioBuffer);
// calculate log mels
log_mels = melSpectrogram(resampledMonoAudio, {
    sampleRate: SAMPLE_RATE,
    hopLength: SPEC_HOP_LENGTH,
    nMels: MEL_SPEC_BINS,
    nFft: NUM_FFTS
});
console.log(log_mels)
const zmuv_mean = 0.000016
const zmuv_std = 0.072771
const bias = 1e-7
const channels = 1
const batches = 1
// Apply zmuv & flatten
//flatten_arry = []
//for(i = 0; i < log_mels.length; i++) {
//    for(j = 0; j < log_mels[i].length; j++) {
//        flatten_arry.push((Math.log(log_mels[i][j] + bias) - zmuv_mean) / zmuv_std)
//    }
//}

// compute discrete cosine transform (dct)
dct = [] 
var PI_N = Math.PI / N;
for (var k = 0; k < N; k++) {
    b = []
    for (var n = 0; n < N; n++) {
        b.push(Math.cos(PI_N * (n + 0.5) * k) * 2.0);
    }
    dct.push(b)
}

// compute mfccs
mfccs = []
for (var i =0; i < log_mels.length; i++) {
    coef = []
    for (var k=0; k < dct.length; k++) {
        sum = 0
        for (var j=0; j < log_mels[i].length; j++) {
            sum = sum + (Math.log(log_mels[i][j] + 1e-6) * dct[k][j])
        }
        coef.push(sum)
    }
    mfccs.push(coef)
}

flatten_mfccs = []
for(i = 0; i < MEL_SPEC_BINS; i++) {
    for(j = 0; j < mfccs.length; j++) {
        flatten_mfccs.push((mfccs[j][i] - zmuv_mean) / zmuv_std)
    }
}


flatten_arry = []
for(i = 0; i < MEL_SPEC_BINS; i++) {
    for(j = 0; j < log_mels.length; j++) {
        flatten_arry.push((Math.log(log_mels[j][i] + bias) - zmuv_mean) / zmuv_std)
    }
}


//let nd_mels = ndarray(flatten_arry, [log_mels.length, MEL_SPEC_BINS])
//let dataProcessed = ndarray(new Float32Array(MEL_SPEC_BINS * log_mels.length * channels), [1, channels, MEL_SPEC_BINS, log_mels.length])
// fill last 2 dims - 40 x 61
//ndarray.ops.assign(dataProcessed.pick(0, 0, null, null), nd_mels.transpose(1,0).pick(null,  null));
// create onnx session
let session = new onnx.InferenceSession();
await session.loadModel("onnx_model.onnx");
//inputTensor = new onnx.Tensor(dataProcessed.data, 'float32', dataProcessed.shape);
inputTensor = new onnx.Tensor(flatten_arry, 'float32', dataProcessed.shape);
// Run model with Tensor inputs and get the result.
let outputMap = await session.run([inputTensor]);
let outputData = outputMap.values().next().value.data;


function createLayout(title, xTitle, yTitle, params={}) {
    const logY = (params.logY == true);
    const logX = (params.logX == true);
    return {
      title: title,
      xaxis: {
        title: xTitle,
        type: logX ? 'log' : null,
      },
      yaxis: {
        title: yTitle,
        type: logY ? 'log' : null,
      }
    }
  }
 
  
function plotAudio(y, layout) {
    //let t = y.map((value, index) => (index / sr));
    let t = y.map((value, index) => index);
    return plotXY(t, y, layout);
}

function plotXY(x, y, layout) {
    const out = document.createElement('div');
    out.className = 'plot';
    const xArr = Array.prototype.slice.call(x);
    const yArr = Array.prototype.slice.call(y);
    const data = [{
      x: xArr,
      y: yArr,
    }]
    Plotly.newPlot(out, data, layout);
    return out;
}

function plotSpectrogram(spec, samplesPerSlice, layout) {
    return plotImage(spec, samplesPerSlice, layout);
}

function plotImage(stft, samplesPerSlice, layout) {
    let out = document.createElement('div');
    out.className = 'plot';
    // Transpose the spectrogram we pass in.
    let zArr = [];
    for (let i = 0; i < stft.length; i++) {
      for (let j = 0; j < stft[0].length; j++) {
        if (zArr[j] == undefined) {
          zArr[j] = [];
        }
        // librosa.power_to_db(spec)
        zArr[j][i] = 10 * Math.log10(stft[i][j]) - 10 * Math.log10(1)
      }
    }
    // Calculate the X values (times) from the stft params.
    //const xArr = stft.map((value, index) => index * samplesPerSlice / sr);
    const xArr = stft.map((value, index) => index);
    // Calculate Y values (frequencies) from stft.
    const fft = Array.prototype.slice.call(stft[0]);
    const yArr = fft.map((value, index) => index);
  
    const data = [
      {
        x: xArr,
        y: yArr,
        z: zArr,
        type: 'heatmap'
      }
    ];
    Plotly.newPlot(out, data, layout);
    return out;
  }



plotAudio(resampledMonoAudio, createLayout('Time domain', 'Time (samples)', 'Amplitude'));
plotSpectrogram(log_mels, SPEC_HOP_LENGTH, createLayout('Mel Spectrogram', 'frame', 'mel freq'));