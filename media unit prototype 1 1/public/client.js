// ==== 1. DOM ============
const form = document.getElementById("connectForm");
const robotInput = document.getElementById("robotId");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const btnCam = document.getElementById("btnCam");
const btnMic = document.getElementById("btnMic");

// ==== 2. Signalling socket =========
const proto = location.protocol === "https:" ? "wss" : "ws";
const wsURL = `${proto}://${location.host}`;
const socket = io(wsURL);

// ==== 3. Media / WebRTC ============
let pc; // RTCPeerConnection
let localStream;
let camEnabled = true;
let micEnabled = true;

const rtcCfg = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// ==== 4. UI actions ================
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const robotId = robotInput.value.trim();
  if (!robotId) return;
  await startLocalMedia();
  socket.emit("join", { robotId, role: "operator" });
});

btnCam.onclick = () => {
  camEnabled = !camEnabled;
  localStream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
  btnCam.textContent = camEnabled ? "Stop Cam" : "Start Cam";
};

btnMic.onclick = () => {
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
  btnMic.textContent = micEnabled ? "Mute" : "Unmute";
};

// ==== 5. Socket event handlers =====
socket.on("ready", makeOffer);
socket.on("offer", async (offer) => {
  await pc.setRemoteDescription(offer);
  await makeAnswer();
});
socket.on("answer", async (ans) => await pc.setRemoteDescription(ans));
socket.on("candidate", (c) => pc.addIceCandidate(c).catch(console.error));

// ==== 6. Helper functions ==========
async function startLocalMedia() {
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  localVideo.srcObject = localStream;
}

function createPeer() {
  pc = new RTCPeerConnection(rtcCfg);

  // forward our ICE to robot
  pc.onicecandidate = (e) =>
    e.candidate && socket.emit("candidate", e.candidate);

  // display remote stream
  pc.ontrack = (e) => {
    if (remoteVideo.srcObject !== e.streams[0])
      remoteVideo.srcObject = e.streams[0];
  };

  // send our tracks
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
}

async function makeOffer() {
  if (!localStream) await startLocalMedia();
  createPeer();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", offer);
}

async function makeAnswer() {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", answer);
}
