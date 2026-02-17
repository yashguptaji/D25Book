(function () {
  const canvas = document.getElementById('dinoCanvas');
  if (!canvas) return;
  const SPEED_FACTOR = 0.7;
  const JUMP_TO_CEILING_RATIO = 0.9;

  const ctx = canvas.getContext('2d');
  const scoreNowEl = document.getElementById('scoreNow');
  const scoreBestEl = document.getElementById('scoreBest');
  const leaderboardList = document.getElementById('leaderboardList');

  const groundY = canvas.height - 42;
  const gravity = 1.05 * SPEED_FACTOR;

  const ball = {
    x: 70,
    y: 0,
    w: 40,
    h: 40,
    vy: 0,
    onGround: true
  };

  let obstacles = [];
  let score = 0;
  let bestScore = Number(canvas.dataset.myBest || 0) || 0;
  let speed = 7.4 * SPEED_FACTOR;
  let frame = 0;
  let nextSpawnAt = Math.floor(60 / SPEED_FACTOR);
  let gameOver = false;

  const ballImg = new Image();
  ballImg.src = '/tt-ball.svg';
  const racketImg = new Image();
  racketImg.src = '/tt-racket.svg';

  function updateBestUI() {
    scoreBestEl.textContent = String(bestScore);
  }

  function jump() {
    if (!ball.onGround || gameOver) return;
    const startY = groundY - ball.h;
    const desiredApexY = startY * (1 - JUMP_TO_CEILING_RATIO);
    const jumpHeight = Math.max(0, startY - desiredApexY);
    const jumpSpeed = Math.sqrt(2 * gravity * jumpHeight);
    ball.vy = -jumpSpeed;
    ball.onGround = false;
  }

  function resetGame() {
    obstacles = [];
    score = 0;
    speed = 7.4 * SPEED_FACTOR;
    frame = 0;
    nextSpawnAt = Math.floor(60 / SPEED_FACTOR);
    gameOver = false;
    ball.y = groundY - ball.h;
    ball.vy = 0;
    ball.onGround = true;
    scoreNowEl.textContent = '0';
  }

  function spawnObstacle() {
    const h = 78;
    const w = 52;
    obstacles.push({
      x: canvas.width + 15,
      y: groundY - h,
      w,
      h
    });
  }

  function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function drawBackground() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#f4d9b4');
    grad.addColorStop(1, '#d6a16e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#764724';
    ctx.fillRect(0, groundY, canvas.width, 4);
  }

  function drawBall() {
    if (ballImg.complete) {
      ctx.drawImage(ballImg, ball.x, ball.y, ball.w, ball.h);
      return;
    }
    ctx.fillStyle = '#fff7eb';
    ctx.beginPath();
    ctx.arc(ball.x + ball.w / 2, ball.y + ball.h / 2, ball.w / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawObstacles() {
    obstacles.forEach((o) => {
      if (racketImg.complete) {
        ctx.drawImage(racketImg, o.x, o.y, o.w, o.h);
      } else {
        ctx.fillStyle = '#8f2417';
        ctx.fillRect(o.x, o.y, o.w, o.h);
      }
    });
  }

  async function submitScoreIfBest() {
    if (score <= bestScore || score <= 0) return;

    try {
      const res = await fetch('/api/tt/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score })
      });

      if (!res.ok) return;
      const data = await res.json();
      bestScore = data.bestScore || bestScore;
      updateBestUI();
      refreshLeaderboard();
    } catch (_error) {
      // No-op in game loop.
    }
  }

  async function refreshLeaderboard() {
    try {
      const res = await fetch('/api/tt/leaderboard');
      if (!res.ok) return;
      const data = await res.json();
      const rows = Array.isArray(data.leaderboard) ? data.leaderboard : [];
      leaderboardList.innerHTML = '';
      rows.forEach((row) => {
        const li = document.createElement('li');
        const left = document.createElement('span');
        const right = document.createElement('strong');
        left.textContent = row.alias || row.display_name;
        right.textContent = String(row.best_score);
        li.appendChild(left);
        li.appendChild(right);
        leaderboardList.appendChild(li);
      });
      if (Number.isFinite(data.myBest)) {
        bestScore = Math.max(bestScore, Number(data.myBest));
        updateBestUI();
      }
    } catch (_error) {
      // No-op in game loop.
    }
  }

  function tick() {
    frame += 1;
    drawBackground();

    if (!gameOver) {
      ball.vy += gravity;
      ball.y += ball.vy;

      if (ball.y >= groundY - ball.h) {
        ball.y = groundY - ball.h;
        ball.vy = 0;
        ball.onGround = true;
      }

      if (frame >= nextSpawnAt) {
        spawnObstacle();
        nextSpawnAt = frame + Math.floor((64 + Math.random() * 48) / SPEED_FACTOR);
      }

      obstacles.forEach((o) => {
        o.x -= speed;
      });
      obstacles = obstacles.filter((o) => o.x + o.w > -10);

      const hit = obstacles.some((o) => intersects(ball, o));
      if (hit) {
        gameOver = true;
        submitScoreIfBest();
      }

      score += 0.22 * SPEED_FACTOR;
      speed += 0.0012 * SPEED_FACTOR;
      scoreNowEl.textContent = String(Math.floor(score));
    }

    drawBall();
    drawObstacles();

    if (gameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText('Game Over', canvas.width / 2 - 112, canvas.height / 2 - 6);
      ctx.font = '18px sans-serif';
      ctx.fillText('Press Space to restart', canvas.width / 2 - 92, canvas.height / 2 + 28);
    }

    requestAnimationFrame(tick);
  }

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code === 'ArrowUp') {
      event.preventDefault();
      if (gameOver) {
        resetGame();
      }
      jump();
    }
  });

  resetGame();
  refreshLeaderboard();
  updateBestUI();
  tick();
})();
