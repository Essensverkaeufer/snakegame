const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

let queue = [];
let games = [];

const GRID = 16;

function randomApple() {
  return {
    x: Math.floor(Math.random() * 25) * GRID,
    y: Math.floor(Math.random() * 25) * GRID
  };
}

function createSnake(x, y) {
  return {
    x,
    y,
    dx: GRID,
    dy: 0,
    cells: [],
    maxCells: 4,
    score: 0,
    alive: true,

    progress: 0,
    currentApple: null
  };
}

function startGame(p1, p2) {
  const apples = [];

  for (let i = 0; i < 500; i++) {
    apples.push(randomApple());
  }

  const s1 = createSnake(160,160);
  const s2 = createSnake(160,160);

  // 👇 IMPORTANT: initialize apples from sequence
  s1.progress = 0;
  s2.progress = 0;

s1.progress = 0;
s2.progress = 0;

s1.currentApple = { ...apples[0] };
s2.currentApple = { ...apples[0] };

  const game = {
    players: [
      { ws: p1, snake: s1, input: null },
      { ws: p2, snake: s2, input: null }
    ],
    apples,
    countdownStart: Date.now(),
    started: false,
    startTime: null,
    duration: 30000
  };

  games.push(game);
}

function endGame(game) {
  const [p1, p2] = game.players;

  const s1 = p1.snake.score || 0;
  const s2 = p2.snake.score || 0;

  let result;

  if (s1 > s2) result = "p1";
  else if (s2 > s1) result = "p2";
  else result = "tie";

  p1.ws.send(JSON.stringify({
    type: "gameOver",
    winner: result === "tie" ? "tie" : (result === "p1" ? "me" : "opponent"),
    scores: { me: s1, opponent: s2 }
  }));

  p2.ws.send(JSON.stringify({
    type: "gameOver",
    winner: result === "tie" ? "tie" : (result === "p2" ? "me" : "opponent"),
    scores: { me: s2, opponent: s1 }
  }));
}

function updateGame(game) {
  // ⏳ countdown
  if (!game.started) {
    const elapsed = (Date.now() - game.countdownStart) / 1000;
    const remaining = Math.max(0, 3 - elapsed);

    game.players.forEach(p => {
      p.ws.send(JSON.stringify({
        type: "countdown",
        value: Math.ceil(remaining)
      }));
    });

    if (remaining <= 0) {
      game.started = true;
      game.startTime = Date.now();
    }

    return true;
  }

  // ⏱️ timer
  const timeLeft = Math.max(0, 30 - Math.floor((Date.now() - game.startTime) / 1000));

  if (timeLeft <= 0) {
    endGame(game);
    return false;
  }

game.players.forEach(player => {
  const snake = player.snake;

  // ✅ ALWAYS ensure apple exists FIRST
  if (!snake.currentApple) {
    const next = game.apples[snake.progress];
    snake.currentApple = { x: next.x, y: next.y };
  }

  // THEN movement + input

    if (player.input) {
      const key = player.input;

      if (key === 37 && snake.dx === 0) { snake.dx = -GRID; snake.dy = 0; }
      if (key === 38 && snake.dy === 0) { snake.dy = -GRID; snake.dx = 0; }
      if (key === 39 && snake.dx === 0) { snake.dx = GRID; snake.dy = 0; }
      if (key === 40 && snake.dy === 0) { snake.dy = GRID; snake.dx = 0; }

      player.input = null;
    }

    snake.x += snake.dx;
    snake.y += snake.dy;

    if (snake.x < 0) snake.x = 384;
    if (snake.x > 384) snake.x = 0;
    if (snake.y < 0) snake.y = 384;
    if (snake.y > 384) snake.y = 0;

    snake.cells.unshift({ x: snake.x, y: snake.y });

    if (snake.cells.length > snake.maxCells) {
      snake.cells.pop();
    }

// 🍎 spawn if missing
if (!snake.currentApple) {
  const next = game.apples[snake.progress];

  // clone so no shared reference
  snake.currentApple = { x: next.x, y: next.y };
}

// 🍎 eat
if (
  snake.currentApple &&
  snake.x === snake.currentApple.x &&
  snake.y === snake.currentApple.y
) {
  snake.maxCells++;
  snake.score++;

  snake.progress++;      // move forward in SAME sequence
  snake.currentApple = null;
}

    // 💀 self collision
    for (let i = 1; i < snake.cells.length; i++) {
      if (snake.x === snake.cells[i].x && snake.y === snake.cells[i].y) {
        snake.alive = false;
      }
    }
  });

  const [p1, p2] = game.players;

if (!p1.snake.alive || !p2.snake.alive) {
  // 💀 instant death = instant loss
  p1.ws.send(JSON.stringify({
    type: "gameOver",
    winner: p1.snake.alive ? "me" : "opponent"
  }));

  p2.ws.send(JSON.stringify({
    type: "gameOver",
    winner: p2.snake.alive ? "me" : "opponent"
  }));

  return false;
}

  // send state (each player gets THEIR apple)
  p1.ws.send(JSON.stringify({
    type: "gameState",
    me: p1.snake,
    opponent: p2.snake,
    apple: p1.snake.currentApple,
    timeLeft
  }));

p2.ws.send(JSON.stringify({
  type: "gameState",
  me: p2.snake,
  opponent: p1.snake,
  apple: p2.snake.currentApple, // ✅ CORRECT
  timeLeft
}));

  return true;
}

setInterval(() => {
  games = games.filter(updateGame);
}, 100);

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    if (data.type === "joinQueue") {
      queue.push(ws);

      if (queue.length >= 2) {
        const p1 = queue.shift();
        const p2 = queue.shift();
        startGame(p1, p2);
      }
    }

    if (data.type === "input") {
      const game = games.find(g =>
        g.players.some(p => p.ws === ws)
      );

      if (!game) return;

      const player = game.players.find(p => p.ws === ws);
      player.input = data.key;
    }
  });

  ws.on('close', () => {
    queue = queue.filter(p => p !== ws);

    games = games.filter(game => {
      const hasPlayer = game.players.some(p => p.ws === ws);

      if (hasPlayer) {
        game.players.forEach(p => {
          if (p.ws !== ws) {
            p.ws.send(JSON.stringify({
              type: "gameOver",
              winner: "me"
            }));
          }
        });
      }

      return !hasPlayer;
    });
  });
});

console.log("Server running on ws://localhost:3000");