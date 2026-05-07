const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

let queue = [];
let games = [];

const GRID = 16;
const STARVE_TIME = 30000; // 30 seconds

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
    currentApple: null,

    // ⏱️ starvation timer
    appleDeadline: Date.now() + STARVE_TIME
  };
}

function startGame(p1, p2) {
  const apples = [];

  // generate shared sequence
  for (let i = 0; i < 1000; i++) {
    apples.push(randomApple());
  }

  const s1 = createSnake(160, 160);
  const s2 = createSnake(160, 160);

  s1.currentApple = { ...apples[0] };
  s2.currentApple = { ...apples[0] };

  const game = {
    players: [
      { ws: p1, snake: s1, input: null },
      { ws: p2, snake: s2, input: null }
    ],
    apples,
    countdownStart: Date.now(),
    started: false
  };

  games.push(game);
}

function sendGameOver(p1, p2) {
  p1.ws.send(JSON.stringify({
    type: "gameOver",
    winner: p1.snake.alive ? "me" : "opponent"
  }));

  p2.ws.send(JSON.stringify({
    type: "gameOver",
    winner: p2.snake.alive ? "me" : "opponent"
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
    }

    return true;
  }

  game.players.forEach(player => {
    const snake = player.snake;

    // 🍎 ensure apple exists
    if (!snake.currentApple) {
      const next = game.apples[snake.progress];
      snake.currentApple = { x: next.x, y: next.y };
    }

    // 🎮 input
    if (player.input) {
      const key = player.input;

      if (key === 37 && snake.dx === 0) {
        snake.dx = -GRID;
        snake.dy = 0;
      }

      if (key === 38 && snake.dy === 0) {
        snake.dy = -GRID;
        snake.dx = 0;
      }

      if (key === 39 && snake.dx === 0) {
        snake.dx = GRID;
        snake.dy = 0;
      }

      if (key === 40 && snake.dy === 0) {
        snake.dy = GRID;
        snake.dx = 0;
      }

      player.input = null;
    }

    // movement
    snake.x += snake.dx;
    snake.y += snake.dy;

    // wrap
    if (snake.x < 0) snake.x = 384;
    if (snake.x > 384) snake.x = 0;
    if (snake.y < 0) snake.y = 384;
    if (snake.y > 384) snake.y = 0;

    snake.cells.unshift({ x: snake.x, y: snake.y });

    if (snake.cells.length > snake.maxCells) {
      snake.cells.pop();
    }

    // 🍎 eat apple
    if (
      snake.currentApple &&
      snake.x === snake.currentApple.x &&
      snake.y === snake.currentApple.y
    ) {
      snake.maxCells++;
      snake.score++;

      // reset 30 second timer
      snake.appleDeadline = Date.now() + STARVE_TIME;

      snake.progress++;
      snake.currentApple = null;
    }

    // 💀 self collision
    for (let i = 1; i < snake.cells.length; i++) {
      if (
        snake.x === snake.cells[i].x &&
        snake.y === snake.cells[i].y
      ) {
        snake.alive = false;
      }
    }

    // ⏱️ starvation death
    if (Date.now() > snake.appleDeadline) {
      snake.alive = false;
    }
  });

  const [p1, p2] = game.players;

  // 💀 someone died
  if (!p1.snake.alive || !p2.snake.alive) {
    sendGameOver(p1, p2);
    return false;
  }

  // ⏱️ personal timers
  const p1TimeLeft = Math.ceil(
    (p1.snake.appleDeadline - Date.now()) / 1000
  );

  const p2TimeLeft = Math.ceil(
    (p2.snake.appleDeadline - Date.now()) / 1000
  );

  // 📡 send state
  p1.ws.send(JSON.stringify({
    type: "gameState",
    me: p1.snake,
    opponent: p2.snake,
    apple: p1.snake.currentApple,
    myTime: p1TimeLeft,
    opponentTime: p2TimeLeft
  }));

  p2.ws.send(JSON.stringify({
    type: "gameState",
    me: p2.snake,
    opponent: p1.snake,
    apple: p2.snake.currentApple,
    myTime: p2TimeLeft,
    opponentTime: p1TimeLeft
  }));

  return true;
}

setInterval(() => {
  games = games.filter(updateGame);
}, 100);

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    const data = JSON.parse(msg);

    // queue
    if (data.type === "joinQueue") {
      queue.push(ws);

      if (queue.length >= 2) {
        const p1 = queue.shift();
        const p2 = queue.shift();

        startGame(p1, p2);
      }
    }

    // input
    if (data.type === "input") {
      const game = games.find(g =>
        g.players.some(p => p.ws === ws)
      );

      if (!game) return;

      const player = game.players.find(p => p.ws === ws);

      if (player) {
        player.input = data.key;
      }
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

console.log("Server running");
