const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

io.on("connection", (socket) => {
  socket.on("join-room", (roomId) => {
    socket.join(roomId);

    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push(socket.id);

    socket.emit(
      "all-users",
      rooms[roomId].filter((id) => id !== socket.id)
    );

    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("signal", ({ to, signal }) => {
    io.to(to).emit("signal", {
      from: socket.id,
      signal,
    });
  });

  socket.on("send-message", ({ roomId, message }) => {
    io.to(roomId).emit("receive-message", {
      user: socket.id,
      text: message,
      time: new Date().toLocaleTimeString(),
    });
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
      socket.to(roomId).emit("user-left", socket.id);
      if (rooms[roomId].length === 0) delete rooms[roomId];
    }
  });
});

server.listen(5000, () => {
  console.log("Backend running on http://localhost:5000");
});
