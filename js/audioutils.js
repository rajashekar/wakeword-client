var SR = 16000;
var INPUT_BUFFER_LENGTH = 16384;
var audioCtx = new AudioContext();

var melFilterbank = null;
var context = null;

function linearSpace(start, end, count) {
    var delta = (end - start) / (count + 1);
    var out = [];
    for (var i = 0; i < count; i++) {
        out[i] = start + delta * i;
    }
    return out;
}

function sum(array) {
    return array.reduce(function (a, b) { return a + b; });
}

// Use a lower minimum value for energy.
var MIN_VAL = -10;
function logGtZero(val) {
    // Ensure that the log argument is nonnegative.
    var offset = Math.exp(MIN_VAL);
    return Math.log(val + offset);
}

const hzToMel = function (hz) {
    return 1125 * Math.log(1 + hz / 700);
};

const melToHz = function (mel) {
    return 700 * (Math.exp(mel / 1125) - 1);
};

const freqToBin = function (freq, fftSize, sr) {
    if (sr === void 0) { sr = SR; }
    return Math.floor((fftSize + 1) * freq / (sr / 2));
};

const applyWindow = function (buffer, win) {
    if (buffer.length != win.length) {
        console.error("Buffer length " + buffer.length + " != window length\n        " + win.length + ".");
        return;
    }
    var out = new Float32Array(buffer.length);
    for (var i = 0; i < buffer.length; i++) {
        out[i] = win[i] * buffer[i];
    }
    return out;
};

const triangleWindow = function (length, startIndex, peakIndex, endIndex) {
    var win = new Float32Array(length);
    var deltaUp = 1.0 / (peakIndex - startIndex);
    for (var i = startIndex; i < peakIndex; i++) {
        // Linear ramp up between start and peak index (values from 0 to 1).
        win[i] = (i - startIndex) * deltaUp;
    }
    var deltaDown = 1.0 / (endIndex - peakIndex);
    for (var i = peakIndex; i < endIndex; i++) {
        // Linear ramp down between peak and end index (values from 1 to 0).
        win[i] = 1 - (i - peakIndex) * deltaDown;
    }
    return win;
};

const createMelFilterbank = function (fftSize, melCount, lowHz, highHz, sr) {
    if (melCount === void 0) { melCount = 20; }
    if (lowHz === void 0) { lowHz = 300; }
    if (highHz === void 0) { highHz = 8000; }
    if (sr === void 0) { sr = SR; }
    var lowMel = hzToMel(lowHz);
    var highMel = hzToMel(highHz);
    // Construct linearly spaced array of melCount intervals, between lowMel and
    // highMel.
    var mels = linearSpace(lowMel, highMel, melCount + 2);
    // Convert from mels to hz.
    var hzs = mels.map(function (mel) { return melToHz(mel); });
    // Go from hz to the corresponding bin in the FFT.
    var bins = hzs.map(function (hz) { return freqToBin(hz, fftSize); });
    // Now that we have the start and end frequencies, create each triangular
    // window (each value in [0, 1]) that we will apply to an FFT later. These
    // are mostly sparse, except for the values of the triangle
    var length = bins.length - 2;
    var filters = [];
    for (var i = 0; i < length; i++) {
        // Now generate the triangles themselves.
        filters[i] = triangleWindow(fftSize, bins[i], bins[i + 1], bins[i + 2]);
    }
    return filters;
};

const lazyCreateMelFilterbank = function (length, melCount, lowHz, highHz, sr) {
    if (melCount === void 0) { melCount = 20; }
    if (lowHz === void 0) { lowHz = 300; }
    if (highHz === void 0) { highHz = 8000; }
    if (sr === void 0) { sr = SR; }
    // Lazy-create a Mel filterbank.
    if (!melFilterbank || melFilterbank.length != length) {
        melFilterbank = createMelFilterbank(length, melCount, lowHz, highHz, sr);
    }
};


const applyFilterbank = function (fftEnergies, filterbank) {
    if (fftEnergies.length != filterbank[0].length) {
        console.error("Each entry in filterbank should have dimensions matching\n FFT. |FFT| = " + fftEnergies.length + ", |filterbank[0]| = " + filterbank[0].length + ".");
        return;
    }
    // Apply each filter to the whole FFT signal to get one value.
    var out = new Float32Array(filterbank.length);
    for (var i = 0; i < filterbank.length; i++) {
        // To calculate filterbank energies we multiply each filterbank with the
        // power spectrum.
        var win = applyWindow(fftEnergies, filterbank[i]);
        // Then add up the coefficents, and take the log.
        out[i] = logGtZero(sum(win));
    }
    return out;
};

/**
 * Given STFT energies, calculates the mel spectrogram.
 */
const melSpectrogram = function (stftEnergies, melCount, lowHz, highHz, sr) {
    if (melCount === void 0) { melCount = 20; }
    if (lowHz === void 0) { lowHz = 300; }
    if (highHz === void 0) { highHz = 8000; }
    if (sr === void 0) { sr = SR; }
    lazyCreateMelFilterbank(stftEnergies[0].length, melCount, lowHz, highHz, sr);
    // For each fft slice, calculate the corresponding mel values.
    var out = [];
    for (var i = 0; i < stftEnergies.length; i++) {
        out[i] = applyFilterbank(stftEnergies[i], melFilterbank);
    }
    return out;
};

/**
 * Generates a Hann window of a given length.
 */
const hannWindow = function (length) {
    var win = new Float32Array(length);
    for (var i = 0; i < length; i++) {
        win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)));
    }
    return win;
};

function range(count) {
    var out = [];
    for (var i = 0; i < count; i++) {
        out.push(i);
    }
    return out;
}

/**
 * Calculates the FFT for an array buffer. Output is an array.
 */
const fft = function (y) {
    var fftr = new KissFFTModule.FFTR(y.length);
    var transform = fftr.forward(y);
    fftr.dispose();
    return transform;
};

/**
 * Calculates the STFT, given a fft size, and a hop size. For example, if fft
 * size is 2048 and hop size is 1024, there will be 50% overlap. Given those
 * params, if the input sample has 4096 values, there would be 3 analysis
 * frames: [0, 2048], [1024, 3072], [2048, 4096].
 */
const stft = function (y, fftSize, hopSize) {
    if (fftSize === void 0) { fftSize = 2048; }
    if (hopSize === void 0) { hopSize = fftSize; }
    // Split the input buffer into sub-buffers of size fftSize.
    var bufferCount = Math.floor((y.length - fftSize) / hopSize) + 1;
    var matrix = range(bufferCount).map(function (x) { return new Float32Array(fftSize); });
    for (var i = 0; i < bufferCount; i++) {
        var ind = i * hopSize;
        var buffer = y.slice(ind, ind + fftSize);
        // In the end, we will likely have an incomplete buffer, which we should
        // just ignore.
        if (buffer.length != fftSize) {
            continue;
        }
        var win = hannWindow(buffer.length);
        var winBuffer = applyWindow(buffer, win);
        var _fft = fft(winBuffer);
        // TODO: Understand why fft output is 2 larger than expected (eg. 1026
        // rather than 1024).
        matrix[i].set(_fft.slice(0, fftSize));
    }
    return matrix;
};

/**
 * Given an interlaced complex array (y_i is real, y_(i+1) is imaginary),
 * calculates the energies. Output is half the size.
 */
const fftEnergies = function (y) {
    var out = new Float32Array(y.length / 2);
    for (var i = 0; i < y.length / 2; i++) {
        out[i] = y[i * 2] * y[i * 2] + y[i * 2 + 1] * y[i * 2 + 1];
    }
    return out;
};

function resampleWebAudio(audioBuffer, targetSr) {
    var sourceSr = audioBuffer.sampleRate;
    var lengthRes = audioBuffer.length * targetSr / sourceSr;
    var offlineCtx = new OfflineAudioContext(1,lengthRes,targetSr);
    return new Promise(function(resolve, reject) {
        var bufferSource = offlineCtx.createBufferSource();
        bufferSource.buffer = audioBuffer;
        offlineCtx.oncomplete = function(event) {
            var bufferRes = event.renderedBuffer;
            var len = bufferRes.length;
            //console.log(`Resampled buffer from ${audioBuffer.length} to ${len}.`);
            resolve(bufferRes);
        }
        ;
        bufferSource.connect(offlineCtx.destination);
        bufferSource.start();
        offlineCtx.startRendering();
    }
    );
}

const playbackArrayBuffer = function (buffer, sampleRate) {
    if (!context) {
        context = new AudioContext();
    }
    if (!sampleRate) {
        sampleRate = context.sampleRate;
    }
    var audioBuffer = context.createBuffer(1, buffer.length, sampleRate);
    var audioBufferData = audioBuffer.getChannelData(0);
    audioBufferData.set(buffer);
    var source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    source.start();
};

var CircularAudioBuffer = /** @class */
(function() {
    function CircularAudioBuffer(maxLength) {
        this.buffer = new Float32Array(maxLength);
        this.currentIndex = 0;
    }
    /**
 * Add a new buffer of data. Called when we get new audio input samples.
 */
    CircularAudioBuffer.prototype.addBuffer = function(newBuffer) {
        // Do we have enough data in this buffer?
        var remaining = this.buffer.length - this.currentIndex;
        if (this.currentIndex + newBuffer.length > this.buffer.length) {
            console.error("Not enough space to write " + newBuffer.length + (" to this circular buffer with " + remaining + " left."));
            return;
        }
        this.buffer.set(newBuffer, this.currentIndex);
        //console.log(`Wrote ${newBuffer.length} entries to index ${this.currentIndex}.`);
        this.currentIndex += newBuffer.length;
    }
    ;
    /**
 * How many samples are stored currently?
 */
    CircularAudioBuffer.prototype.getLength = function() {
        return this.currentIndex;
    }
    ;
    /**
 * How much space remains?
 */
    CircularAudioBuffer.prototype.getRemainingLength = function() {
        return this.buffer.length - this.currentIndex;
    }
    ;
    /**
 * Return the first N samples of the buffer, and remove them. Called when we
 * want to get a buffer of audio data of a fixed size.
 */
    CircularAudioBuffer.prototype.popBuffer = function(length) {
        // Do we have enough data to read back?
        if (this.currentIndex < length) {
            console.error("This circular buffer doesn't have " + length + " entries in it.");
            return;
        }
        if (length == 0) {
            console.warn("Calling popBuffer(0) does nothing.");
            return;
        }
        var popped = this.buffer.slice(0, length);
        var remaining = this.buffer.slice(length, this.buffer.length);
        // Remove the popped entries from the buffer.
        this.buffer.fill(0);
        this.buffer.set(remaining, 0);
        // Send the currentIndex back.
        this.currentIndex -= length;
        return popped;
    }
    ;
    /**
 * Get the the first part of the buffer without mutating it.
 */
    CircularAudioBuffer.prototype.getBuffer = function(length) {
        if (!length) {
            length = this.getLength();
        }
        // Do we have enough data to read back?
        if (this.currentIndex < length) {
            console.error("This circular buffer doesn't have " + length + " entries in it.");
            return;
        }
        return this.buffer.slice(0, length);
    }
    ;
    CircularAudioBuffer.prototype.clear = function() {
        this.currentIndex = 0;
        this.buffer.fill(0);
    }
    ;
    return CircularAudioBuffer;
})()


cosMap = null;

// Builds a cosine map for the given input size. This allows multiple input sizes to be memoized automagically
// if you want to run the DCT over and over.
var memoizeCosines = function(N) {
  cosMap = cosMap || {};
  cosMap[N] = new Array(N*N);

  var PI_N = Math.PI / N;

  for (var k = 0; k < N; k++) {
    for (var n = 0; n < N; n++) {
      cosMap[N][n + (k * N)] = Math.cos(PI_N * (n + 0.5) * k);
    }
  }
};

function dct(signal, scale) {
  var L = signal.length;
  scale = scale || 2;

  if (!cosMap || !cosMap[L]) memoizeCosines(L);

  var coefficients = signal.map(function () {return 0;});

  return coefficients.map(function (__, ix) {
    return scale * signal.reduce(function (prev, cur, ix_, arr) {
      return prev + (cur * cosMap[L][ix_ + (ix * L)]);
    }, 0);
  });
};

const cepstrumFromEnergySpectrum = function (melEnergies) {
    return dct(melEnergies);
};

var StreamingFeatureExtractor = /** @class */
(function() {
    function StreamingFeatureExtractor(params) {
        var _this = this;
        var bufferLength = params.bufferLength
          , duration = params.duration
          , hopLength = params.hopLength
          , isMfccEnabled = params.isMfccEnabled
          , melCount = params.melCount
          , targetSr = params.targetSr
          , inputBufferLength = params.inputBufferLength;
        _this.bufferLength = bufferLength;
        _this.inputBufferLength = inputBufferLength || INPUT_BUFFER_LENGTH;
        _this.hopLength = hopLength;
        _this.melCount = melCount;
        _this.isMfccEnabled = isMfccEnabled;
        _this.targetSr = targetSr;
        _this.duration = duration;
        _this.bufferCount = Math.floor((duration * targetSr - bufferLength) / hopLength) + 1;
        if (hopLength > bufferLength) {
            console.error('Hop length must be smaller than buffer length.');
        }
        // The mel filterbank is actually half of the size of the number of samples,
        // since the FFT array is complex valued.
        _this.melFilterbank = createMelFilterbank(_this.bufferLength / 2 + 1, _this.melCount);
        _this.spectrogram = [];
        _this.isStreaming = false;
        var nativeSr = audioCtx.sampleRate;
        // Allocate the size of the circular analysis buffer.
        var resampledBufferLength = Math.max(bufferLength, _this.inputBufferLength) * (targetSr / nativeSr) * 4;
        _this.circularBuffer = new CircularAudioBuffer(resampledBufferLength);
        // Calculate how many buffers will be enough to keep around to playback.
        var playbackLength = nativeSr * _this.duration * 2;
        _this.playbackBuffer = new CircularAudioBuffer(playbackLength);
        return _this;
    }
    StreamingFeatureExtractor.prototype.getSpectrogram = function() {
        return this.spectrogram;
    }
    ;
    StreamingFeatureExtractor.prototype.start = function() {
        var _this = this;
        // Clear all buffers.
        this.circularBuffer.clear();
        this.playbackBuffer.clear();
        // Reset start time and sample count for ScriptProcessorNode watching.
        this.processStartTime = new Date();
        this.processSampleCount = 0;
        var constraints = {
            audio: {
                "mandatory": {
                    "googEchoCancellation": "false",
                    "googAutoGainControl": "false",
                    "googNoiseSuppression": "false",
                    "googHighpassFilter": "false"
                },
            },
            video: false
        };
        navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
            _this.stream = stream;
            _this.scriptNode = audioCtx.createScriptProcessor(_this.inputBufferLength, 1, 1);
            var source = audioCtx.createMediaStreamSource(stream);
            source.connect(_this.scriptNode);
            _this.scriptNode.connect(audioCtx.destination);
            _this.scriptNode.onaudioprocess = _this.onAudioProcess.bind(_this);
            _this.isStreaming = true;
        });
    }
    ;
    StreamingFeatureExtractor.prototype.stop = function() {
        for (var _i = 0, _a = this.stream.getTracks(); _i < _a.length; _i++) {
            var track = _a[_i];
            track.stop();
        }
        this.scriptNode.disconnect(audioCtx.destination);
        this.stream = null;
        this.isStreaming = false;
    }
    ;
    StreamingFeatureExtractor.prototype.getEnergyLevel = function() {
        return this.lastEnergyLevel;
    }
    ;
    /**
 * Debug only: for listening to what was most recently recorded.
 */
    StreamingFeatureExtractor.prototype.getLastPlaybackBuffer = function() {
        return this.playbackBuffer.getBuffer();
    }
    ;
    StreamingFeatureExtractor.prototype.onAudioProcess = function(audioProcessingEvent) {
        var _this = this;
        if (!_this.isStreaming)
            return;
        var audioBuffer = audioProcessingEvent.inputBuffer;
        // Add to the playback buffers, but make sure we have enough room.
        var remaining = this.playbackBuffer.getRemainingLength();
        var arrayBuffer = audioBuffer.getChannelData(0);
        this.processSampleCount += arrayBuffer.length;
        if (remaining < arrayBuffer.length) {
            this.playbackBuffer.popBuffer(arrayBuffer.length);
            //console.log(`Freed up ${arrayBuffer.length} in the playback buffer.`);
        }
        this.playbackBuffer.addBuffer(arrayBuffer);
        // Resample the buffer into targetSr.
        //console.log(`Resampling from ${audioCtx.sampleRate} to ${this.targetSr}.`);
        resampleWebAudio(audioBuffer, this.targetSr).then(function(audioBufferRes) {
            var bufferRes = audioBufferRes.getChannelData(0);
            // Write in a buffer of ~700 samples.
            _this.circularBuffer.addBuffer(bufferRes);
        });
        // Get buffer(s) out of the circular buffer. Note that there may be multiple
        // available, and if there are, we should get them all.
        var buffers = this.getFullBuffers();
        if (buffers.length > 0) {//console.log(`Got ${buffers.length} buffers of audio input data.`);
        }
        for (var _i = 0, buffers_1 = buffers; _i < buffers_1.length; _i++) {
            var buffer = buffers_1[_i];
            //console.log(`Got buffer of length ${buffer.length}.`);
            // Extract the mel values for this new frame of audio data.
            var _fft = fft(buffer);
            var _fftEnergies = fftEnergies(_fft);
            var melEnergies = applyFilterbank(_fftEnergies, this.melFilterbank);
            var mfccs = cepstrumFromEnergySpectrum(melEnergies);
            if (this.isMfccEnabled) {
                this.spectrogram.push(mfccs);
            } else {
                this.spectrogram.push(melEnergies);
            }
            if (this.spectrogram.length > this.bufferCount) {
                // Remove the first element in the array.
                this.spectrogram.splice(0, 1);
            }
            if (this.spectrogram.length == this.bufferCount) {
                // Notify that we have an updated spectrogram.
                //this.emit('update');
            }
            var totalEnergy = melEnergies.reduce(function(total, num) {
                return total + num;
            });
            this.lastEnergyLevel = totalEnergy / melEnergies.length;
        }
        var elapsed = (new Date().valueOf() - this.processStartTime.valueOf()) / 1000;
        var expectedSampleCount = (audioCtx.sampleRate * elapsed);
        var percentError = Math.abs(expectedSampleCount - this.processSampleCount) / this.processSampleCount;
        if (percentError > 0.1) {
            // console.warn("ScriptProcessorNode may be dropping samples. Percent error is " + percentError + ".");
        }
    }
    ;
    /**
 * Get as many full buffers as are available in the circular buffer.
 */
    StreamingFeatureExtractor.prototype.getFullBuffers = function() {
        var out = [];
        // While we have enough data in the buffer.
        while (this.circularBuffer.getLength() > this.bufferLength) {
            // Get a buffer of desired size.
            var buffer = this.circularBuffer.getBuffer(this.bufferLength);
            // Remove a hop's worth of data from the buffer.
            this.circularBuffer.popBuffer(this.hopLength);
            out.push(buffer);
        }
        return out;
    }
    ;
    return StreamingFeatureExtractor;
})()

