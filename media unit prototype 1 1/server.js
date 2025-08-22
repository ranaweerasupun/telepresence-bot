require("dotenv").config();
const path = require("path");
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: { origin: "*" }, // OK for prototype; tighten later
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

/*  roomState = {
      "ROBOT123": { robot: <socket.id>, operator: <socket.id> }
    }
*/
const roomState = {};

io.on("connection", (socket) => {
  console.log("[socket] connected", socket.id);

  socket.on("join", ({ robotId, role }) => {
    if (!robotId || !role) return;
    socket.join(robotId); // Socket.io room == robotId
    socket.data.role = role; // stash for cleanup
    socket.data.robotId = robotId;

    roomState[robotId] ??= {};
    roomState[robotId][role] = socket.id;
    console.log(`[room ${robotId}] ${role} joined`);

    // If both peers present tell operator to start WebRTC offer
    const peers = roomState[robotId];
    if (peers.operator && peers.robot) {
      io.to(peers.operator).emit("ready"); // operator kicks off offer
    }
  });

  // Generic relay helpers
  socket.on("offer", (msg) => relay(socket, "offer", msg));
  socket.on("answer", (msg) => relay(socket, "answer", msg));
  socket.on("candidate", (msg) => relay(socket, "candidate", msg));

  socket.on("disconnect", () => {
    const { robotId, role } = socket.data;
    if (robotId && roomState[robotId]) {
      delete roomState[robotId][role];
      console.log(`[room ${robotId}] ${role} disconnected`);
      if (Object.keys(roomState[robotId]).length === 0)
        delete roomState[robotId];
    }
  });
});

// helper: forward to everyone else in same room
function relay(sender, type, payload) {
  const room = sender.data.robotId;
  if (!room) return;
  sender.to(room).emit(type, payload);
}

http.listen(PORT, () => {
  console.log(`Signalling server listening on ${PORT}`);
});
