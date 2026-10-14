// سيرفر لعبة إكس أو الأونلاين
// Socket.IO بيدينا اتصال مباشر (realtime) بين اللاعبين

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// نقدم ملفات الواجهة من فولدر public
app.use(express.static("public"));

// ============ حالة اللعبة ============
// كل غرفة فيها: اللاعبين، الأسماء، اللوحة، الدور، السكور، الشات
const rooms = {};

// كل الاحتمالات اللي تكسر بها الفوز
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // صفوف
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // أعمدة
  [0, 4, 8], [2, 4, 6],            // قطرين
];

// نولد كود غرفة من 4 حروف إنجليزية كبير
function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
  } while (rooms[code]); // نتجنب الكود المكرر
  return code;
}

// ننشئ غرفة جديدة
function createRoom(nickname) {
  const code = makeRoomCode();
  rooms[code] = {
    code,
    players: {},                                  // socket.id -> "X" أو "O"
    names: { X: nickname, O: "" },                // اسم كل لاعب
    scores: { X: 0, O: 0 },                       // عدد الجولات اللي كسبها كل رمز
    board: Array(9).fill(""),
    turn: "X",
    winner: null,                                 // "X" / "O" / "draw"
    winningLine: null,
    rematchVotes: new Set(),
    messages: [],                                 // شات الغرفة — بيموت مع الغرفة
  };
  return rooms[code];
}

// نمسح الغرف الفاضية
function cleanupEmptyRooms() {
  for (const code of Object.keys(rooms)) {
    if (Object.keys(rooms[code].players).length === 0) {
      delete rooms[code]; // الشات والسكور بيمسحوا معاها
    }
  }
}

io.on("connection", (socket) => {
  console.log("لاعب اتصل:", socket.id);

  // ---- إنشاء غرفة جديدة ----
  socket.on("createRoom", (nickname) => {
    nickname = cleanNickname(nickname);
    if (!nickname) {
      socket.emit("error-msg", "اكتب اسمك الأول");
      return;
    }
    cleanupEmptyRooms();
    const room = createRoom(nickname);
    room.players[socket.id] = "X";
    socket.join(room.code);
    socket.emit("joined", {
      code: room.code,
      symbol: "X",
      board: room.board,
      turn: room.turn,
      names: room.names,
      scores: room.scores,
      messages: room.messages,
    });
  });

  // ---- دخول غرفة بكود ----
  socket.on("joinRoom", (data) => {
    const code = String(data.code || "").trim().toUpperCase();
    const nickname = cleanNickname(data.nickname);
    if (!nickname) {
      socket.emit("error-msg", "اكتب اسمك الأول");
      return;
    }
    const room = rooms[code];
    if (!room) {
      socket.emit("error-msg", "مفيش غرفة بالكود ده، اتأكد من الكود");
      return;
    }
    if (Object.keys(room.players).length >= 2) {
      socket.emit("error-msg", "الغرفة كاملة، جرّب غرفة تانية");
      return;
    }
    room.players[socket.id] = "O";
    room.names.O = nickname;
    socket.join(code);
    socket.emit("joined", {
      code,
      symbol: "O",
      board: room.board,
      turn: room.turn,
      names: room.names,
      scores: room.scores,
      messages: room.messages, // نرجع له شات الغرفة القديم
    });
    broadcast(room);
  });

  // ---- لعب نقلة ----
  socket.on("play", (index) => {
    const room = findRoom(socket.id);
    if (!room) return;

    const symbol = room.players[socket.id];
    index = Number(index);

    // التحقق: دوره، المكان فاضي، ومفيش فايز لسه
    if (room.winner || room.turn !== symbol || room.board[index] !== "") return;

    room.board[index] = symbol;
    checkWinner(room);

    if (!room.winner) {
      room.turn = symbol === "X" ? "O" : "X";
    }
    broadcast(room);
  });

  // ---- رسالة شات ----
  socket.on("chat", (text) => {
    const room = findRoom(socket.id);
    if (!room) return;

    text = String(text || "").trim().slice(0, 200);
    if (!text) return;

    const symbol = room.players[socket.id];
    const msg = { from: symbol, name: room.names[symbol], text };
    room.messages.push(msg);
    if (room.messages.length > 100) room.messages.shift(); // نحفظ آخر 100 رسالة بس
    io.to(room.code).emit("chatMsg", msg);
  });

  // ---- طلب إعادة اللعب ----
  socket.on("rematch", () => {
    const room = findRoom(socket.id);
    if (!room) return;

    room.rematchVotes.add(socket.id);
    // لو الاتنين وافقوا، نبدأ من جديد ونبادل الرموز (والأسماء والسكور بتفضل مع صاحبها)
    if (room.rematchVotes.size === 2) {
      room.board = Array(9).fill("");
      room.turn = "X";
      room.winner = null;
      room.winningLine = null;
      room.rematchVotes.clear();

      const entries = Object.entries(room.players);
      if (entries.length === 2) {
        room.players[entries[0][0]] = "O";
        room.players[entries[1][0]] = "X";
        [room.names.X, room.names.O] = [room.names.O, room.names.X];
        [room.scores.X, room.scores.O] = [room.scores.O, room.scores.X];
      }
    }
    broadcast(room);
  });

  // ---- الخروج / قطع الاتصال ----
  socket.on("disconnect", () => {
    const room = findRoom(socket.id);
    if (room) {
      delete room.players[socket.id];
      broadcast(room);
    }
    console.log("لاعب خرج:", socket.id);
  });

  // ---- دوال مساعدة ----

  // تنظيف الاسم: قص طول، شيل مسافات زيادة — وبدون اسم رجّع فاضي
  function cleanNickname(nickname) {
    return String(nickname || "").trim().slice(0, 15);
  }

  function findRoom(sid) {
    for (const room of Object.values(rooms)) {
      if (room.players[sid]) return room;
    }
    return null;
  }

  function checkWinner(room) {
    for (const line of WIN_LINES) {
      const [a, b, c] = line;
      if (room.board[a] && room.board[a] === room.board[b] && room.board[a] === room.board[c]) {
        room.winner = room.board[a];
        room.winningLine = line;
        room.scores[room.winner]++; // سكور الفايز بيزيد
        return;
      }
    }
    if (room.board.every((cell) => cell !== "")) {
      room.winner = "draw";
    }
  }

  // نرسل لكل لاعب نسخة الحالة الخاصة بيه (عشان mySymbol تختلف من واحد للتاني)
  function broadcast(room) {
    for (const sid of Object.keys(room.players)) {
      io.to(sid).emit("gameUpdate", roomState(room, sid));
    }
  }

  // نبعت حالة الغرفة بشكل مناسب للاعب المحدد
  function roomState(room, sid) {
    return {
      board: room.board,
      turn: room.turn,
      winner: room.winner,
      winningLine: room.winningLine,
      playerCount: Object.keys(room.players).length,
      mySymbol: room.players[sid] || null,
      names: room.names,
      scores: room.scores,
      opponentLeft: room.winner === null && Object.keys(room.players).length < 2,
      rematchVotes: room.rematchVotes.size,
    };
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`اللعبة شغالة على http://localhost:${PORT}`);
});
