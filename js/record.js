//var my_div = document.createElement("DIV");
//var my_p = document.createElement("P");
//var my_btn = document.createElement("BUTTON");
//var t = document.createTextNode("Press to start recording");
//
//my_btn.appendChild(t);
//my_div.appendChild(my_btn);
//const wakeword = document.querySelector('#wakeword-container');
//wakeword.appendChild(my_div);
//
//var base64data = 0;
//var reader;
//var recorder, gumStream;
//var recordButton = my_btn;
//
//var handleSuccess = function (stream) {
//    gumStream = stream;
//    recorder = new MediaRecorder(stream);
//    recorder.ondataavailable = function (e) {
//        var url = URL.createObjectURL(e.data);
//        var preview = document.createElement('audio');
//        preview.controls = true;
//        preview.src = url;
//        document.body.appendChild(preview);
//
//        reader = new FileReader();
//        reader.readAsDataURL(e.data);
//        reader.onloadend = function () {
//            base64data = reader.result;
//            console.log("Inside FileReader:" + base64data);
//        }
//    };
//    recorder.start();
//};
//
//recordButton.innerText = "Recording... press to stop";
//
//navigator.mediaDevices.getUserMedia({ audio: true }).then(handleSuccess);
//
//
//function toggleRecording() {
//    if (recorder && recorder.state == "recording") {
//        recorder.stop();
//        gumStream.getAudioTracks()[0].stop();
//        recordButton.innerText = "Saving the recording... pls wait!"
//    }
//}
//
//// https://stackoverflow.com/a/951057
//function sleep(ms) {
//    return new Promise(resolve => setTimeout(resolve, ms));
//}
//
//var data = new Promise(resolve => {
//    //recordButton.addEventListener("click", toggleRecording);
//    recordButton.onclick = () => {
//        toggleRecording()
//
//        sleep(2000).then(() => {
//            // wait 2000ms for the data to be available...
//            // ideally this should use something like await...
//            //console.log("Inside data:" + base64data)
//            resolve(base64data.toString())
//
//        });
//
//    }
//});

var base64data = 0;

function sendToServer(data) {
    console.log(data)
}
let main_stream;

const record_and_send = () => {
    const recorder = new MediaRecorder(main_stream);
    const chunks = [];
    //recorder.ondataavailable = e => chunks.push(e.data);
    recorder.ondataavailable = function (e) {
        reader = new FileReader();
        reader.readAsDataURL(e.data);
        reader.onloadend = function () {
            base64data = reader.result;
            // console.log("Inside FileReader:" + base64data);
        }
    };
    recorder.onstop = e => sendToServer(base64data);
    setTimeout(()=> recorder.stop(), 750); // we'll have a 5s media file
    recorder.start();
}

const handleSuccess = stream => {
    main_stream = stream
}
setInterval(record_and_send, 750);
 // generate a new file every 5s
navigator.mediaDevices.getUserMedia({ audio: true }).then(handleSuccess);